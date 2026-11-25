/**
 * Etapa 6: gazetteer com contornos do IBGE + agrupamento de notícias em eventos (PostGIS real).
 */
import { NewsSourceReliability, PrismaClient } from '@prisma/client';
import { expireStaleEvents, processArticle } from '../src/events/event-builder';
import { seedRegions } from '../src/geo/regions';
import { canonicalizeUrl, urlHash } from '../src/text/url';
import { titleFingerprint } from '../src/dedup/similarity';

const prisma = new PrismaClient({ transactionOptions: { maxWait: 10_000, timeout: 20_000 } });
const tag = `e${Date.now().toString(36)}`;
const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let n = 0;
let moderatorId: string;

async function source(domain: string, reliability: NewsSourceReliability = 'ESTABLISHED_PRESS') {
  return prisma.newsSource.create({
    data: { key: `${tag}-${++n}`, name: domain, type: 'RSS', reliability, baseUrl: `https://${domain}`, feedUrl: `https://${domain}/rss` },
  });
}

async function article(domain: string, title: string, opts: { summary?: string; at?: Date; reliability?: NewsSourceReliability } = {}) {
  const s = await source(domain, opts.reliability);
  const url = `https://${domain}/${tag}/${++n}`;
  const canonical = canonicalizeUrl(url)!;
  return prisma.newsArticle.create({
    data: {
      sourceId: s.id, title, summary: opts.summary ?? null, url, canonicalUrl: canonical, urlHash: urlHash(canonical),
      titleFingerprint: titleFingerprint(title), publishedAt: opts.at ?? hoursAgo(1),
    },
  });
}

const run = (id: string) => processArticle(prisma, id, NOW);
const eventOf = async (eventId: string) =>
  prisma.newsEvent.findUniqueOrThrow({ where: { id: eventId }, include: { region: true, articles: { orderBy: { createdAt: 'asc' } } } });

beforeAll(async () => {
  // Banco de TESTES: eventos de execuções anteriores atrapalhariam o agrupamento por cidade/tempo.
  await prisma.newsEvent.deleteMany({});
  await seedRegions(prisma);
  moderatorId = (await prisma.user.create({ data: { name: 'Moderação Eventos', email: `mod-${tag}@teste.example`, passwordHash: 'x', role: 'MODERATOR' } })).id;
});

afterAll(async () => {
  await prisma.newsEvent.deleteMany({});
  await prisma.newsSource.deleteMany({ where: { key: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: moderatorId } });
  await prisma.$disconnect();
});

describe('gazetteer no banco', () => {
  it('16 cidades com contorno oficial; distritos sem contorno (não inventamos polígono)', async () => {
    const [row] = await prisma.$queryRaw<{ cities: number; with_boundary: number; districts: number; districts_with_boundary: number }[]>`
      SELECT count(*) FILTER (WHERE kind = 'CITY')::int AS cities,
             count(*) FILTER (WHERE kind = 'CITY' AND boundary IS NOT NULL)::int AS with_boundary,
             count(*) FILTER (WHERE kind = 'DISTRICT')::int AS districts,
             count(*) FILTER (WHERE kind = 'DISTRICT' AND boundary IS NOT NULL)::int AS districts_with_boundary
      FROM news_regions`;
    expect(row).toEqual({ cities: 16, with_boundary: 16, districts: 96, districts_with_boundary: 0 });
  });

  it('área de Osasco coerente com o IBGE (~65 km²) e o ponto da Prefeitura está dentro do contorno', async () => {
    const [r] = await prisma.$queryRaw<{ km2: number; covers: boolean }[]>`
      SELECT (ST_Area(boundary) / 1e6)::float AS km2,
             ST_Covers(boundary, ST_SetSRID(ST_MakePoint(-46.7917, -23.5329), 4326)::geography) AS covers
      FROM news_regions WHERE ibge_code = '3534401'`;
    expect(r.km2).toBeGreaterThan(55);
    expect(r.km2).toBeLessThan(75);
    expect(r.covers).toBe(true);
  });

  it('região metropolitana = união dos municípios (cobre Osasco e Guarulhos, não cobre Campinas)', async () => {
    const [r] = await prisma.$queryRaw<{ osasco: boolean; guarulhos: boolean; campinas: boolean }[]>`
      SELECT ST_Covers(boundary, ST_SetSRID(ST_MakePoint(-46.7917, -23.5329), 4326)::geography) AS osasco,
             ST_Covers(boundary, ST_SetSRID(ST_MakePoint(-46.5333, -23.4628), 4326)::geography) AS guarulhos,
             ST_Covers(boundary, ST_SetSRID(ST_MakePoint(-47.0626, -22.9056), 4326)::geography) AS campinas
      FROM news_regions WHERE kind = 'METRO'`;
    expect(r).toEqual({ osasco: true, guarulhos: true, campinas: false });
  });

  it('carga é idempotente', async () => {
    await seedRegions(prisma);
    expect(await prisma.newsRegion.count({ where: { kind: 'CITY' } })).toBe(16);
  });
});

describe('agrupamento em eventos', () => {
  it('exemplo do enunciado (Osasco): duas fontes independentes → um evento verificado', async () => {
    const a = await article('portal-a.example', 'Chuva alaga avenida e interdita via em Osasco', { at: hoursAgo(3) });
    // Sozinho, "interdição de via" não diz que é alagamento (pode ser queda de árvore): o resumo diz.
    const b = await article('portal-b.example', 'Temporal causa interdição de via em Osasco', { at: hoursAgo(1.5), summary: 'O trecho ficou alagado e a via foi fechada.' });

    const ra = await run(a.id);
    expect(ra).toMatchObject({ outcome: 'CREATED', status: 'PUBLISHED_PRELIMINARY' });
    const rb = await run(b.id);
    expect(rb).toMatchObject({ outcome: 'LINKED', eventId: ra.eventId, status: 'PUBLISHED_VERIFIED' });

    const e = await eventOf(ra.eventId!);
    expect(e).toMatchObject({ confidence: 'HIGH', independentSources: 2, estimatedSeverity: 'HIGH', locationPrecision: 'CITY', city: 'Osasco', cityIbges: ['3534401'] });
    expect(e.region).toMatchObject({ kind: 'CITY', ibgeCode: '3534401' });
    expect(e.latitude).toBeNull(); // só cidade: nenhum ponto inventado
    expect(e.articles.map((l) => l.isIndependent)).toEqual([true, true]);
  });

  it('republicação em outro portal entra no evento, mas NÃO conta como confirmação', async () => {
    const a = await article('portal-c.example', 'Chuva alaga avenida e interdita via em Barueri', { at: hoursAgo(2) });
    const copy = await article('portal-d.example', 'Chuva alaga avenida e interdita via em Barueri', { at: hoursAgo(1) });
    const ra = await run(a.id);
    const rc = await run(copy.id);
    expect(rc.eventId).toBe(ra.eventId);
    const e = await eventOf(ra.eventId!);
    expect(e).toMatchObject({ confidence: 'MEDIUM', independentSources: 1, status: 'PUBLISHED_PRELIMINARY' });
    expect(e.articles[1]).toMatchObject({ isIndependent: false, derivedFromArticleId: a.id });
  });

  it('distritos diferentes da capital → eventos diferentes, cada um no seu distrito', async () => {
    const lapa = await article('portal-e.example', 'Alagamento interdita passagem na Lapa, zona oeste de São Paulo');
    const jab = await article('portal-f.example', 'Alagamento interdita avenida no Jabaquara, zona sul de São Paulo');
    const r1 = await run(lapa.id);
    const r2 = await run(jab.id);
    expect(r1.eventId).not.toBe(r2.eventId);
    const e1 = await eventOf(r1.eventId!);
    expect(e1).toMatchObject({ locationPrecision: 'NEIGHBORHOOD', city: 'São Paulo' });
    expect(e1.region).toMatchObject({ kind: 'DISTRICT', name: 'Lapa' });
  });

  it('fora da janela de 6 h → eventos diferentes', async () => {
    const early = await article('portal-g.example', 'Chuva alaga ruas e interdita via em Cotia', { at: hoursAgo(20) });
    const late = await article('portal-h.example', 'Temporal interdita avenida em Cotia', { at: hoursAgo(10) });
    expect((await run(early.id)).eventId).not.toBe((await run(late.id)).eventId);
  });

  it('notícia de normalização encerra o evento', async () => {
    const a = await article('portal-i.example', 'Alagamento interdita avenida em Carapicuíba', { at: hoursAgo(3) });
    const ra = await run(a.id);
    const ok = await article('portal-j.example', 'Avenida é liberada após alagamento em Carapicuíba', { at: hoursAgo(1) });
    expect(await run(ok.id)).toMatchObject({ outcome: 'RESOLVED', eventId: ra.eventId, status: 'RESOLVED' });
  });

  it('normalização sem evento aberto não cria nada', async () => {
    const ok = await article('portal-k.example', 'Avenida é liberada após alagamento em Jandira');
    expect(await run(ok.id)).toMatchObject({ outcome: 'NOTHING_TO_RESOLVE' });
  });

  it('prevenção: análise gravada com motivo, sem evento', async () => {
    const p = await article('portal-l.example', 'Prefeitura anuncia obras para prevenir alagamentos em Diadema');
    expect(await run(p.id)).toMatchObject({ outcome: 'IRRELEVANT' });
    const an = await prisma.newsAnalysis.findFirstOrThrow({ where: { articleId: p.id } });
    expect(an).toMatchObject({ isRelevant: true, temporality: 'PREVENTION', modelVersion: 'none', rulesVersion: 'rules-2' });
    expect((await prisma.newsArticle.findUniqueOrThrow({ where: { id: p.id } })).processingStatus).toBe('IRRELEVANT');
  });

  it('reprocessar o mesmo artigo é idempotente', async () => {
    const a = await article('portal-m.example', 'Alagamento interdita avenida em Mauá');
    const r1 = await run(a.id);
    expect(await run(a.id)).toMatchObject({ outcome: 'ALREADY_LINKED', eventId: r1.eventId });
    expect(await prisma.newsEventArticle.count({ where: { articleId: a.id } })).toBe(1);
  });

  it('concorrência: 4 matérias da mesma cidade em paralelo → 1 evento com 4 fontes', async () => {
    const arts = await Promise.all(
      ['n', 'o', 'p', 'q'].map((x, i) => article(`portal-${x}.example`, `Temporal ${['alaga ruas', 'provoca alagamento e interdita avenida', 'deixa vias alagadas', 'causa alagamentos'][i]} em Guarulhos`)),
    );
    const results = await Promise.all(arts.map((a) => run(a.id)));
    expect(new Set(results.map((r) => r.eventId)).size).toBe(1);
    expect(results.filter((r) => r.outcome === 'CREATED')).toHaveLength(1);
    const e = await eventOf(results[0].eventId!);
    expect(e.articles).toHaveLength(4);
  });

  it('crítico com uma fonte: preliminar com revisão urgente; segunda fonte independente libera', async () => {
    const a = await article('portal-r.example', 'Moradores ficam ilhados e bombeiros fazem resgates em Itapevi', { summary: 'Temporal atingiu a cidade.' });
    const r = await run(a.id);
    expect(await eventOf(r.eventId!)).toMatchObject({ status: 'PUBLISHED_PRELIMINARY', estimatedSeverity: 'CRITICAL', urgentReview: true });
    const b = await article('portal-s.example', 'Bombeiros resgatam famílias ilhadas após temporal em Itapevi');
    await run(b.id);
    expect(await eventOf(r.eventId!)).toMatchObject({ status: 'PUBLISHED_VERIFIED', confidence: 'HIGH', urgentReview: false });
  });

  it('sem localização: evento próprio aguardando moderação (nunca agrupado por acaso)', async () => {
    const a = await article('portal-t.example', 'Temporal provoca alagamentos e deixa vias interditadas');
    const b = await article('portal-u.example', 'Chuva forte alaga ruas e interdita avenida');
    const ra = await run(a.id);
    const rb = await run(b.id);
    expect(ra.eventId).not.toBe(rb.eventId);
    expect(await eventOf(ra.eventId!)).toMatchObject({ status: 'AWAITING_VALIDATION', confidence: 'LOW', locationPrecision: 'UNKNOWN', regionId: null });
  });

  it('decisão do moderador prevalece sobre a automação', async () => {
    const a = await article('portal-v.example', 'Alagamento interdita avenida em Santo André', { at: hoursAgo(2) });
    const r = await run(a.id);
    await prisma.newsEvent.update({ where: { id: r.eventId! }, data: { status: 'DISCARDED', moderatedById: moderatorId, moderationNote: 'teste' } });
    const b = await article('portal-w.example', 'Temporal deixa ruas alagadas em Santo André', { at: hoursAgo(1) });
    // Evento descartado não recebe novas fontes: a nova matéria abre outro evento.
    const rb = await run(b.id);
    expect(rb.eventId).not.toBe(r.eventId);
    expect((await eventOf(r.eventId!)).status).toBe('DISCARDED');
  });

  it('real: fonte com local ambíguo entra como contexto, mas não confirma', async () => {
    // Horário isolado dos demais testes da capital.
    const a = await article('portal-y.example', 'Chuva em São Paulo: bombeiros resgatam crianças de escola inundada', { at: hoursAgo(50) });
    const r = await run(a.id);
    // "São Paulo" + Ubatuba no mesmo texto: pode ser o estado → local ambíguo.
    const amb = await article('portal-z.example', 'São Paulo registra mortes em decorrência das chuvas', {
      at: hoursAgo(49),
      summary: 'A vítima mais recente foi arrastada pela enxurrada em Ubatuba nesta segunda-feira.',
    });
    expect(await run(amb.id)).toMatchObject({ outcome: 'LINKED', eventId: r.eventId });
    expect(await eventOf(r.eventId!)).toMatchObject({ confidence: 'MEDIUM', independentSources: 1, status: 'PUBLISHED_PRELIMINARY', urgentReview: true });
  });

  it('real: matéria só com a cidade não confirma o caso específico de um distrito', async () => {
    const d = await article('portal-aa.example', 'Enxurrada arrasta três pessoas para dentro de rio no Grajaú, zona sul de São Paulo', { at: hoursAgo(30) });
    const r = await run(d.id);
    const city = await article('portal-bb.example', 'Após temporal, São Paulo tem imóveis interditados e moradores desalojados', { at: hoursAgo(29) });
    const rc = await run(city.id);
    expect(rc.eventId).toBe(r.eventId); // agrupada como contexto…
    expect(await eventOf(r.eventId!)).toMatchObject({ locationPrecision: 'NEIGHBORHOOD', confidence: 'MEDIUM', independentSources: 1, urgentReview: true }); // …mas não confirma
    const same = await article('portal-cc.example', 'Bombeiros procuram vítimas arrastadas pela enxurrada no Grajaú, zona sul de São Paulo', { at: hoursAgo(28.5) });
    await run(same.id);
    expect(await eventOf(r.eventId!)).toMatchObject({ confidence: 'HIGH', independentSources: 2, status: 'PUBLISHED_VERIFIED' });
  });

  it('matéria só com a cidade e vários eventos de distrito candidatos: abre evento próprio (não chuta)', async () => {
    const lapa = await article('portal-dd.example', 'Alagamento interdita rua na Lapa, zona oeste de São Paulo', { at: hoursAgo(60) });
    const mooca = await article('portal-ee.example', 'Alagamento interdita rua na Mooca, zona leste de São Paulo', { at: hoursAgo(60) });
    const r1 = await run(lapa.id);
    const r2 = await run(mooca.id);
    const city = await article('portal-ff.example', 'Temporal deixa ruas alagadas em São Paulo', { at: hoursAgo(59) });
    const rc = await run(city.id);
    expect(rc.outcome).toBe('CREATED');
    expect([r1.eventId, r2.eventId]).not.toContain(rc.eventId);
  });

  it('evento sem evidência nova há mais de 6 h vira DESATUALIZADO', async () => {
    const a = await article('portal-x.example', 'Bombeiros resgatam moradores ilhados após alagamento em São Caetano do Sul', { at: hoursAgo(8) });
    const r = await run(a.id);
    expect(await expireStaleEvents(prisma, NOW)).toBeGreaterThanOrEqual(1);
    expect(await eventOf(r.eventId!)).toMatchObject({ status: 'OUTDATED', urgentReview: false }); // era crítico de fonte única (urgente)
  });
});
