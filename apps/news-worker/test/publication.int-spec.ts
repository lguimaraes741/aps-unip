/**
 * Etapa 10: publicação de alertas de notícia — news_alerts + decisão de push + outbox na MESMA
 * transação do evento (PostgreSQL/PostGIS reais).
 */
import { NewsAlertEventPayload } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { titleFingerprint } from '../src/dedup/similarity';
import { expireStaleEvents, processArticle, recompute, reconcilePublications, TX_OPTIONS } from '../src/events/event-builder';
import { syncPublication } from '../src/events/publication';
import { seedRegions } from '../src/geo/regions';
import { canonicalizeUrl, urlHash } from '../src/text/url';

const prisma = new PrismaClient({ transactionOptions: TX_OPTIONS });
const tag = `p${Date.now().toString(36)}`;
const NOW = new Date();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
let n = 0;
let moderatorId: string;

async function article(domain: string, title: string, opts: { at?: Date; summary?: string; official?: boolean } = {}) {
  const s = await prisma.newsSource.create({
    data: { key: `${tag}-${++n}`, name: domain, type: 'RSS', reliability: opts.official ? 'OFFICIAL' : 'ESTABLISHED_PRESS', baseUrl: `https://${domain}`, feedUrl: `https://${domain}/rss` },
  });
  const url = `https://${domain}/${tag}/${++n}`;
  const c = canonicalizeUrl(url)!;
  return prisma.newsArticle.create({
    data: { sourceId: s.id, title, summary: opts.summary ?? null, url, canonicalUrl: c, urlHash: urlHash(c), titleFingerprint: titleFingerprint(title), publishedAt: opts.at ?? hoursAgo(1) },
  });
}

const run = async (domain: string, title: string, opts?: Parameters<typeof article>[2]) => processArticle(prisma, (await article(domain, title, opts)).id, NOW);
const alertOf = (eventId: string) => prisma.newsAlert.findUnique({ where: { eventId } });
async function outbox(eventId: string): Promise<{ type: string; payload: NewsAlertEventPayload }[]> {
  const rows = await prisma.domainEvent.findMany({ where: { aggregateType: 'news_alert', payload: { path: ['eventId'], equals: eventId } }, orderBy: { sequence: 'asc' } });
  return rows.map((r) => ({ type: r.type, payload: r.payload as unknown as NewsAlertEventPayload }));
}

beforeAll(async () => {
  await prisma.newsEvent.deleteMany({});
  await seedRegions(prisma);
  moderatorId = (await prisma.user.create({ data: { name: 'Moderação Publicação', email: `mod-${tag}@teste.example`, passwordHash: 'x', role: 'MODERATOR' } })).id;
});

afterAll(async () => {
  await prisma.newsEvent.deleteMany({});
  await prisma.newsSource.deleteMany({ where: { key: { startsWith: tag } } });
  await prisma.user.deleteMany({ where: { id: moderatorId } });
  await prisma.$disconnect();
});

describe('publicação de alertas de notícia', () => {
  it('preliminar ALTO: publica e decide push na mesma transação; 2ª fonte confirma (upgraded); 3ª fonte igual não repete', async () => {
    const r1 = await run('pub-a.example', 'Chuva alaga avenida e interdita via em Osasco', { at: hoursAgo(3) });
    expect(await alertOf(r1.eventId!)).toMatchObject({ status: 'ACTIVE', level: 'PRELIMINARY', publishedSeverity: 'HIGH', notifiedSeverity: 'HIGH', revision: 1 });
    let ev = await outbox(r1.eventId!);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ type: 'news.alert.published', payload: { change: 'new', notify: true, severity: 'HIGH', level: 'PRELIMINARY', city: 'Osasco', headline: 'via interditada' } });

    await run('pub-b.example', 'Temporal deixa avenida interditada após alagamento em Osasco', { at: hoursAgo(2) });
    ev = await outbox(r1.eventId!);
    expect(ev).toHaveLength(2);
    expect(ev[1]).toMatchObject({ type: 'news.alert.updated', payload: { change: 'upgraded', notify: true, level: 'VERIFIED' } });

    await run('pub-c.example', 'Alagamento interdita avenida em Osasco nesta tarde', { at: hoursAgo(1) });
    expect(await outbox(r1.eventId!)).toHaveLength(2); // nada relevante mudou: nem evento, nem push
  });

  it('CRÍTICO de fonte única: publica preliminar SEM push; aprovação do moderador libera o push crítico', async () => {
    const r = await run('pub-d.example', 'Moradores ficam ilhados e bombeiros fazem resgates em Itapevi', { summary: 'Temporal atingiu a cidade.' });
    expect(await alertOf(r.eventId!)).toMatchObject({ level: 'PRELIMINARY', publishedSeverity: 'CRITICAL', notifiedSeverity: null, lastNotifiedAt: null });
    expect((await outbox(r.eventId!))[0].payload).toMatchObject({ notify: false, severity: 'CRITICAL' });

    // Moderador valida (como a API faz) e o news-worker recalcula.
    await prisma.newsEvent.update({ where: { id: r.eventId! }, data: { status: 'PUBLISHED_VERIFIED', moderatedById: moderatorId } });
    await prisma.$transaction((tx) => recompute(tx, r.eventId!), TX_OPTIONS);
    expect(await alertOf(r.eventId!)).toMatchObject({ level: 'VERIFIED', notifiedSeverity: 'CRITICAL', reviewedById: moderatorId, revision: 2 });
    expect((await outbox(r.eventId!))[1]).toMatchObject({ type: 'news.alert.updated', payload: { change: 'upgraded', notify: true, severity: 'CRITICAL' } });
  });

  it('revisão urgente: avisa a equipe pelo outbox UMA vez, na transição; recálculo e aprovação não repetem; caso comum não avisa', async () => {
    const reviews = (eventId: string) =>
      prisma.domainEvent.findMany({ where: { type: 'news.review.urgent', aggregateId: eventId }, orderBy: { sequence: 'asc' } });

    const r = await run('pub-u.example', 'Moradores ficam ilhados e bombeiros fazem resgates em Carapicuíba', { summary: 'Temporal atingiu a cidade.' });
    expect(await prisma.newsEvent.findUnique({ where: { id: r.eventId! } })).toMatchObject({ urgentReview: true, status: 'PUBLISHED_PRELIMINARY' });
    let rows = await reviews(r.eventId!);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aggregateType: 'news_event' });
    expect(rows[0].payload).toMatchObject({ eventId: r.eventId, severity: 'CRITICAL', status: 'PUBLISHED_PRELIMINARY', city: 'Carapicuíba' });

    // Recalcular de novo (ex.: reconciliação) não repete o aviso.
    await prisma.$transaction((tx) => recompute(tx, r.eventId!), TX_OPTIONS);
    expect(await reviews(r.eventId!)).toHaveLength(1);

    // Moderador decidiu: deixa de ser urgente, e nada novo vai para a equipe.
    await prisma.newsEvent.update({ where: { id: r.eventId! }, data: { status: 'PUBLISHED_VERIFIED', moderatedById: moderatorId } });
    await prisma.$transaction((tx) => recompute(tx, r.eventId!), TX_OPTIONS);
    expect(await prisma.newsEvent.findUnique({ where: { id: r.eventId! } })).toMatchObject({ urgentReview: false });
    rows = await reviews(r.eventId!);
    expect(rows).toHaveLength(1);

    // Alto de fonte única (publicado com push) não precisa de moderação urgente.
    const common = await run('pub-v.example', 'Chuva alaga avenida e interdita via em Barueri');
    expect(await reviews(common.eventId!)).toHaveLength(0);
  });

  it('MODERADO preliminar: publicado sem push; normalização encerra sem avisar ninguém (ninguém foi avisado)', async () => {
    const r = await run('pub-e.example', 'Alagamento deixa trânsito lento em Jandira', { at: hoursAgo(2) });
    expect(await alertOf(r.eventId!)).toMatchObject({ publishedSeverity: 'MODERATE', notifiedSeverity: null });
    await run('pub-f.example', 'Avenida é liberada após alagamento em Jandira', { at: hoursAgo(1) });
    expect(await alertOf(r.eventId!)).toMatchObject({ status: 'RESOLVED' });
    expect((await outbox(r.eventId!)).map((e) => [e.type, e.payload.notify])).toEqual([
      ['news.alert.published', false],
      ['news.alert.resolved', false],
    ]);
  });

  it('alerta notificado e depois descartado pelo moderador: retirado com motivo, e quem recebeu é avisado', async () => {
    const r = await run('pub-g.example', 'Alagamento interdita avenida em Cotia');
    await prisma.newsEvent.update({ where: { id: r.eventId! }, data: { status: 'DISCARDED', moderatedById: moderatorId, moderationNote: 'Notícia corrigida pelo portal' } });
    await prisma.$transaction((tx) => recompute(tx, r.eventId!), TX_OPTIONS);
    expect(await alertOf(r.eventId!)).toMatchObject({ status: 'RETRACTED', retractionReason: 'Notícia corrigida pelo portal' });
    expect((await outbox(r.eventId!)).at(-1)).toMatchObject({ type: 'news.alert.retracted', payload: { change: 'retracted', notify: true } });
  });

  it('expiração (sem notícia nova há > 6 h): alerta EXPIRED, sem push', async () => {
    const r = await run('pub-h.example', 'Alagamento interdita avenida em Mauá', { at: hoursAgo(8) });
    await expireStaleEvents(prisma, NOW);
    expect(await alertOf(r.eventId!)).toMatchObject({ status: 'EXPIRED' });
    expect((await outbox(r.eventId!)).at(-1)).toMatchObject({ type: 'news.alert.expired', payload: { notify: false } });
  });

  it('fonte oficial verificada vira nível OFICIAL', async () => {
    const r = await run('osasco-oficial.example', 'Defesa Civil informa famílias desalojadas após transbordamento de córrego em Barueri', { official: true, summary: 'Equipes acompanham a situação nesta madrugada.' });
    expect(await alertOf(r.eventId!)).toMatchObject({ level: 'OFFICIAL', notifiedSeverity: 'HIGH' });
  });

  it('confiança baixa nunca cria alerta; sincronizar de novo sem mudança não grava nada', async () => {
    const low = await run('pub-i.example', 'Temporal provoca alagamentos e deixa vias interditadas'); // sem local
    expect(await alertOf(low.eventId!)).toBeNull();
    const r = await run('pub-j.example', 'Alagamento interdita avenida em Diadema');
    const before = (await outbox(r.eventId!)).length;
    expect(await prisma.$transaction((tx) => syncPublication(tx, r.eventId!))).toMatchObject({ change: null, notify: false });
    expect(await outbox(r.eventId!)).toHaveLength(before);
  });

  it('sincronizações concorrentes do mesmo evento (reconciliação × notícia nova): um alerta, um evento no outbox', async () => {
    const r = await run('pub-l.example', 'Alagamento interdita avenida em Embu das Artes');
    await prisma.newsAlert.delete({ where: { eventId: r.eventId! } });
    const before = (await outbox(r.eventId!)).length;
    // O pool abre conexões sob demanda (vários segundos cada aqui): sem aquecê-lo, B só começaria
    // depois de A terminar e a corrida nunca aconteceria (foi o que uma primeira versão deste teste fez).
    await Promise.all(Array.from({ length: 4 }, () => prisma.$transaction((tx) => tx.$executeRaw`SELECT pg_sleep(0.2)`)));
    // Corrida forçada: A cria o alerta e segura a transação aberta; B tenta sincronizar no meio.
    let releaseA!: () => void;
    const gate = new Promise<void>((resolve) => (releaseA = resolve));
    const a = prisma.$transaction(async (tx) => {
      const res = await syncPublication(tx, r.eventId!);
      await gate;
      return res;
    }, TX_OPTIONS);
    await new Promise((res) => setTimeout(res, 300));
    let bStartedBeforeRelease = false;
    let released = false;
    const b = prisma.$transaction((tx) => {
      bStartedBeforeRelease = !released;
      return syncPublication(tx, r.eventId!);
    }, TX_OPTIONS);
    await new Promise((res) => setTimeout(res, 300));
    released = true;
    releaseA();
    const [ra, rb] = await Promise.all([a, b]); // sem a trava, B falha com "Unique constraint failed"
    expect(bStartedBeforeRelease).toBe(true); // a corrida aconteceu de fato
    expect(ra.change).toBe('new');
    expect(rb.change).toBeNull(); // B esperou A e viu o alerta pronto
    expect(await prisma.newsAlert.count({ where: { eventId: r.eventId! } })).toBe(1);
    expect(await outbox(r.eventId!)).toHaveLength(before + 1);
  });

  it('reconciliação publica evento cuja sincronização se perdeu (ex.: fila fora do ar)', async () => {
    const r = await run('pub-k.example', 'Alagamento interdita avenida em Guarulhos');
    await prisma.newsAlert.delete({ where: { eventId: r.eventId! } }); // simula a perda
    expect(await reconcilePublications(prisma)).toBeGreaterThanOrEqual(1);
    expect(await alertOf(r.eventId!)).toMatchObject({ status: 'ACTIVE' });
  });
});
