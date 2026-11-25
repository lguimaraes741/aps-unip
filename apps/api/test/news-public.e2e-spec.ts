import { INestApplication } from '@nestjs/common';
import { NewsAlertLevel, NewsAlertStatus, Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, registerUser, TestUser } from './helpers';

/**
 * Leitura pública dos alertas de notícia (Fase 7, Etapa 8). Eventos e alertas são criados direto no
 * banco (a publicação é testada no news-worker). As regiões ficam num lugar fictício longe da Grande SP
 * (lat -10, lng -50) com códigos IBGE próprios, para não cruzar com dados de outros testes.
 */
describe('Notícias — API pública (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citizen: TestUser;
  let sourceId: string;
  let sourceKey: string;
  let officialSourceId: string;
  let cityId: string;
  let districtId: string;
  let noBoundaryCityId: string;
  const tag = `p${Date.now().toString(36)}`;
  const cityIbge = String(9000000 + Math.floor(Math.random() * 999999)).slice(0, 7);
  // Quadrado de ~11 km de lado em volta de (-10, -50).
  const SQUARE = 'MULTIPOLYGON(((-50.05 -10.05, -49.95 -10.05, -49.95 -9.95, -50.05 -9.95, -50.05 -10.05)))';

  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1/news${path}`;
  const list = async (qs: string) => (await http().get(api(`/events?${qs}`)).set(auth(citizen)).expect(200)).body;
  const ids = (body: { items: { id: string }[] }) => body.items.map((i) => i.id);
  const near = `lat=-10&lng=-50&radius=20000&cityIbge=${cityIbge}`;

  let n = 0;
  async function published(
    event: Partial<Prisma.NewsEventUncheckedCreateInput> = {},
    alert: { level?: NewsAlertLevel; status?: NewsAlertStatus; retractionReason?: string; publishedAt?: Date; expiresAt?: Date } | null = {},
    articles: { sourceId?: string; title?: string; publishedAt?: Date }[] = [{}],
  ) {
    const now = new Date();
    const e = await prisma.newsEvent.create({
      data: {
        eventType: 'FLOODING',
        title: `Alagamento público ${tag} ${++n}`,
        locationPrecision: 'CITY',
        city: 'Cidade Teste',
        state: 'SP',
        cityIbges: [cityIbge],
        regionId: cityId,
        confidence: 'MEDIUM',
        status: 'PUBLISHED_PRELIMINARY',
        estimatedSeverity: 'HIGH',
        rulesVersion: 'rules-2',
        firstEvidenceAt: now,
        lastEvidenceAt: now,
        moderationNote: 'nota interna do moderador',
        decisionReasons: ['motivo interno'],
        ...event,
      },
    });
    for (const [i, a] of articles.entries()) {
      const url = `https://portal.example/${tag}/${randomUUID()}`;
      const article = await prisma.newsArticle.create({
        data: {
          sourceId: a.sourceId ?? sourceId, title: a.title ?? `Chuva interdita via ${i}`, url, canonicalUrl: url,
          urlHash: createHash('sha256').update(url).digest('hex'), titleFingerprint: 'chuva interdita via',
          publishedAt: a.publishedAt ?? now, processingStatus: 'ANALYZED', summary: 'Trecho interditado pela água.',
        },
      });
      await prisma.newsAnalysis.create({
        data: {
          articleId: article.id, rulesVersion: 'rules-2', isRelevant: true, temporality: 'CURRENT', estimatedSeverity: 'HIGH', confidence: 'MEDIUM',
          locationPrecision: 'CITY', reasoningSummary: 'relata ocorrência',
          extractedData: { severityEvidence: [{ label: 'via interditada', excerpt: 'interditado', severity: 'HIGH' }], discardedEvidence: [], missing: [] },
        },
      });
      await prisma.newsEventArticle.create({ data: { eventId: e.id, articleId: article.id, isIndependent: i === 0 } });
    }
    if (alert) {
      await prisma.newsAlert.create({
        data: {
          eventId: e.id,
          level: alert.level ?? 'PRELIMINARY',
          status: alert.status ?? 'ACTIVE',
          publishedSeverity: e.estimatedSeverity,
          retractionReason: alert.retractionReason,
          publishedAt: alert.publishedAt ?? now,
          expiresAt: alert.expiresAt ?? new Date(now.getTime() + 6 * 3_600_000),
        },
      });
    }
    return e;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    citizen = await registerUser(app, 'cidadao-news-pub');
    const city = await prisma.newsRegion.create({ data: { kind: 'CITY', state: 'SP', name: `Cidade ${tag}`, ibgeCode: cityIbge } });
    await prisma.$executeRaw`UPDATE news_regions SET boundary = ST_GeogFromText(${SQUARE}) WHERE id = ${city.id}::uuid`;
    cityId = city.id;
    districtId = (await prisma.newsRegion.create({ data: { kind: 'DISTRICT', state: 'SP', name: `Distrito ${tag}`, parentId: city.id } })).id;
    noBoundaryCityId = (await prisma.newsRegion.create({ data: { kind: 'CITY', state: 'SP', name: `Sem contorno ${tag}` } })).id;
    sourceKey = `${tag}-pub`;
    sourceId = (await prisma.newsSource.create({
      data: { key: sourceKey, name: 'Portal público de teste', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: 'https://portal.example', feedUrl: 'https://portal.example/rss' },
    })).id;
    officialSourceId = (await prisma.newsSource.create({
      data: { key: `${tag}-ofc`, name: 'Defesa Civil de teste', type: 'RSS', reliability: 'OFFICIAL', baseUrl: 'https://oficial.example', feedUrl: 'https://oficial.example/rss' },
    })).id;
  });

  afterAll(async () => {
    // O banco de testes é compartilhado (sem reset no modo deploy): o gazetteer do news-worker conta as regiões.
    await prisma.newsEvent.deleteMany({ where: { title: { contains: tag } } });
    await prisma.newsRegion.deleteMany({ where: { id: { in: [districtId, noBoundaryCityId] } } });
    await prisma.newsRegion.deleteMany({ where: { id: cityId } });
    await prisma.newsSource.deleteMany({ where: { key: { startsWith: tag } } });
    await app.close();
  });

  it('sem token → 401', async () => {
    await http().get(api('/events')).expect(401);
    await http().get(api(`/regions/${cityId}/boundary`)).expect(401);
  });

  it('alerta regional: contorno da cidade, ponto interno para o rótulo, fonte principal e consequência', async () => {
    const e = await published({}, {}, [{}, { title: 'Republicação' }]);
    const body = await list(near);
    const item = body.items.find((i: { id: string }) => i.id === e.id);
    expect(item).toMatchObject({
      code: e.code,
      title: e.title,
      headline: 'via interditada',
      level: 'PRELIMINARY',
      isOfficial: false,
      status: 'ACTIVE',
      severity: 'HIGH',
      locationPrecision: 'CITY',
      latitude: null,
      longitude: null,
      areaRegionId: cityId,
      articleCount: 2,
      sourceCount: 1,
      primarySource: { name: 'Portal público de teste', reliability: 'ESTABLISHED_PRESS', summary: 'Trecho interditado pela água.' },
      reviewedByModerator: false,
      distanceMeters: 0,
    });
    expect(item.primarySource.url).toMatch(/^https:\/\/portal\.example\//);
    expect(item.center.latitude).toBeGreaterThan(-10.05);
    expect(item.center.latitude).toBeLessThan(-9.95);
    expect(item.center.longitude).toBeGreaterThan(-50.05);
    expect(item.center.longitude).toBeLessThan(-49.95);
    // Nada da moderação sai pela rota pública.
    expect(JSON.stringify(body)).not.toMatch(/nota interna|motivo interno|moderationNote|decisionReasons|confidence/);
  });

  it('raio: alerta regional entra quando o contorno está no raio; ponto longe fica de fora', async () => {
    const e = await published();
    // (-10, -50.2) fica ~16 km a oeste da borda do quadrado.
    expect(ids(await list(`lat=-10&lng=-50.2&radius=20000&cityIbge=${cityIbge}`))).toContain(e.id);
    expect(ids(await list(`lat=-10&lng=-50.2&radius=5000&cityIbge=${cityIbge}`))).not.toContain(e.id);
  });

  it('alerta com ponto (precisão de rua) não usa contorno; distância e ordenação pelo ponto', async () => {
    const far = await published({ locationPrecision: 'STREET', latitude: -9.96, longitude: -49.96, placeText: 'Av. Teste' });
    const close = await published({ locationPrecision: 'STREET', latitude: -10.001, longitude: -50.001, placeText: 'Rua Perto' });
    const body = await list(`lat=-10&lng=-50&radius=20000&cityIbge=${cityIbge}&sort=distance`);
    const mine = body.items.filter((i: { id: string }) => i.id === far.id || i.id === close.id);
    expect(mine.map((i: { id: string }) => i.id)).toEqual([close.id, far.id]);
    expect(mine[0]).toMatchObject({ latitude: -10.001, longitude: -50.001, areaRegionId: null, center: null, placeText: 'Rua Perto' });
    expect(mine[0].distanceMeters).toBeLessThan(200);
  });

  it('distrito sem contorno usa o contorno da cidade; região sem contorno fica sem área', async () => {
    const district = await published({ regionId: districtId, locationPrecision: 'NEIGHBORHOOD' });
    const none = await published({ regionId: noBoundaryCityId });
    const body = await list(`cityIbge=${cityIbge}`);
    expect(body.items.find((i: { id: string }) => i.id === district.id)).toMatchObject({ areaRegionId: cityId, regionName: `Distrito ${tag}` });
    expect(body.items.find((i: { id: string }) => i.id === none.id)).toMatchObject({ areaRegionId: null, center: null });
    // Sem área conhecida não há como cruzar com o raio.
    expect(ids(await list(near))).not.toContain(none.id);
  });

  it('só alerta em vigor no mapa; histórico inclui encerrado e expirado, nunca retirado nem não publicado', async () => {
    const active = await published();
    const awaiting = await published({ status: 'AWAITING_VALIDATION', confidence: 'LOW' }, null);
    const resolved = await published({ status: 'RESOLVED' }, { status: 'RESOLVED' });
    const expired = await published({ status: 'OUTDATED' }, { status: 'EXPIRED' });
    const retracted = await published({ status: 'DISCARDED' }, { status: 'RETRACTED', retractionReason: 'Notícia desmentida pela prefeitura' });
    const past = new Date(Date.now() - 10 * 3_600_000);
    // Venceu, mas a manutenção ainda não marcou EXPIRED (news-worker parado): não pode parecer ativo.
    const stale = await published({}, { publishedAt: past, expiresAt: new Date(past.getTime() + 6 * 3_600_000) });

    const current = ids(await list(`cityIbge=${cityIbge}`));
    expect(current).toContain(active.id);
    for (const e of [awaiting, resolved, expired, retracted, stale]) expect(current).not.toContain(e.id);

    const history = ids(await list(`cityIbge=${cityIbge}&scope=all&limit=100`));
    expect(history).toEqual(expect.arrayContaining([active.id, resolved.id, expired.id]));
    expect(history).not.toContain(retracted.id);
    expect(history).not.toContain(awaiting.id);
  });

  it('filtros: gravidade (sem gravidade fica de fora), verificação, fonte e período', async () => {
    const critical = await published({ estimatedSeverity: 'CRITICAL', confidence: 'HIGH', status: 'PUBLISHED_VERIFIED' }, { level: 'VERIFIED' });
    const unknown = await published({ estimatedSeverity: null });
    const official = await published({ confidence: 'HIGH', status: 'PUBLISHED_VERIFIED' }, { level: 'OFFICIAL' }, [{ sourceId: officialSourceId }]);
    const old = await published({ firstEvidenceAt: new Date(Date.now() - 5 * 3_600_000), lastEvidenceAt: new Date(Date.now() - 5 * 3_600_000) });

    const bySeverity = ids(await list(`cityIbge=${cityIbge}&severity=CRITICAL`));
    expect(bySeverity).toContain(critical.id);
    expect(bySeverity).not.toContain(unknown.id);
    const unknownItem = (await list(`cityIbge=${cityIbge}&limit=100`)).items.find((i: { id: string }) => i.id === unknown.id);
    expect(unknownItem).toMatchObject({ severity: null, headline: null });

    const byLevel = await list(`cityIbge=${cityIbge}&level=VERIFIED,OFFICIAL`);
    expect(ids(byLevel)).toEqual(expect.arrayContaining([critical.id, official.id]));
    expect(byLevel.items.every((i: { level: string }) => i.level !== 'PRELIMINARY')).toBe(true);
    expect(byLevel.items.find((i: { id: string }) => i.id === official.id)).toMatchObject({ isOfficial: true, primarySource: { name: 'Defesa Civil de teste', reliability: 'OFFICIAL' } });

    const bySource = ids(await list(`cityIbge=${cityIbge}&source=${tag}-ofc`));
    expect(bySource).toEqual([official.id]);

    const recent = ids(await list(`cityIbge=${cityIbge}&periodHours=2&limit=100`));
    expect(recent).toContain(critical.id);
    expect(recent).not.toContain(old.id);
  });

  it('validação: lat sem lng, distância sem ponto, filtro inválido → 400', async () => {
    await http().get(api('/events?lat=-10')).set(auth(citizen)).expect(400);
    await http().get(api('/events?sort=distance')).set(auth(citizen)).expect(400);
    await http().get(api('/events?severity=ALTA')).set(auth(citizen)).expect(400);
    await http().get(api('/events?cityIbge=12')).set(auth(citizen)).expect(400);
    await http().get(api('/events?source=X%27%3B--')).set(auth(citizen)).expect(400);
  });

  it('detalhes: todas as fontes, mais recente primeiro, com independência; sem dados de moderação', async () => {
    const older = new Date(Date.now() - 3_600_000);
    const e = await published({}, {}, [{ title: 'Primeira matéria', publishedAt: older }, { title: 'Segunda matéria' }]);
    const res = await http().get(api(`/events/${e.id}`)).set(auth(citizen)).expect(200);
    expect(res.body).toMatchObject({ id: e.id, status: 'ACTIVE', headline: 'via interditada', retractionReason: null, articleCount: 2 });
    expect(res.body.sources.map((s: { title: string }) => s.title)).toEqual(['Segunda matéria', 'Primeira matéria']);
    expect(res.body.sources[1]).toMatchObject({ sourceName: 'Portal público de teste', independent: true, summary: 'Trecho interditado pela água.' });
    expect(res.body.sources[0].independent).toBe(false);
    expect(JSON.stringify(res.body)).not.toMatch(/nota interna|motivo interno/);
  });

  it('detalhes de alerta retirado mostram o motivo (quem recebeu a correção abre o aviso); não publicado → 404', async () => {
    const retracted = await published({ status: 'DISCARDED' }, { status: 'RETRACTED', retractionReason: 'Notícia desmentida pela prefeitura' });
    const res = await http().get(api(`/events/${retracted.id}`)).set(auth(citizen)).expect(200);
    expect(res.body).toMatchObject({ status: 'RETRACTED', retractionReason: 'Notícia desmentida pela prefeitura' });

    const awaiting = await published({ status: 'AWAITING_VALIDATION', confidence: 'LOW' }, null);
    await http().get(api(`/events/${awaiting.id}`)).set(auth(citizen)).expect(404);
    await http().get(api(`/events/${randomUUID()}`)).set(auth(citizen)).expect(404);
    await http().get(api('/events/nao-e-uuid')).set(auth(citizen)).expect(400);
  });

  it('filtros: cidades monitoradas e só fontes ligadas, sem dados da operação', async () => {
    await prisma.newsRegion.update({ where: { id: cityId }, data: { monitored: true } });
    await prisma.newsSource.update({ where: { id: sourceId }, data: { enabled: true, termsCheckedAt: new Date() } });
    const res = await http().get(api('/filters')).set(auth(citizen)).expect(200);
    expect(res.body.cities).toEqual(expect.arrayContaining([{ ibge: cityIbge, name: `Cidade ${tag}` }]));
    expect(res.body.cities.some((c: { name: string }) => c.name === `Distrito ${tag}`)).toBe(false); // só cidades
    expect(res.body.sources).toEqual(expect.arrayContaining([{ key: sourceKey, name: 'Portal público de teste', official: false }]));
    expect(res.body.sources.some((s: { key: string }) => s.key === `${tag}-ofc`)).toBe(false); // desligada
    expect(JSON.stringify(res.body)).not.toMatch(/feedUrl|feed_url|portal\.example\/rss|consecutive/);
    await http().get(api('/filters')).expect(401);
  });

  it('contorno: GeoJSON simplificado com cache; região sem contorno → 404', async () => {
    const res = await http().get(api(`/regions/${cityId}/boundary`)).set(auth(citizen)).expect(200);
    expect(res.headers['cache-control']).toBe('private, max-age=86400');
    expect(res.body).toMatchObject({ regionId: cityId, kind: 'CITY', geometry: { type: 'MultiPolygon' } });
    expect(res.body.geometry.coordinates[0][0]).toHaveLength(5);
    await http().get(api(`/regions/${districtId}/boundary`)).set(auth(citizen)).expect(404);
  });
});
