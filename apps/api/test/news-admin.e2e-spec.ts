import { NewsCollectJob, NewsMaintenanceJob, QueueName } from '@alertacidade/shared-types';
import { INestApplication } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { createHash, randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, registerUser, registerWithRole, TestUser } from './helpers';

/**
 * Moderação do News Intelligence (Fase 7, Etapa 7). Os eventos são criados direto no banco
 * (o agrupamento automático é testado no news-worker); aqui vale o que a API permite e registra.
 */
describe('Monitoramento de notícias — API administrativa (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let citizen: TestUser;
  let moderator: TestUser;
  let moderator2: TestUser;
  let admin: TestUser;
  let sourceId: string;
  let osascoRegionId: string;
  const tag = `n${Date.now().toString(36)}`;
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const prefix = process.env.REDIS_PREFIX!;
  const collectQueue = new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, { connection: redis, prefix });
  const maintenanceQueue = new Queue<NewsMaintenanceJob>(QueueName.NEWS_MAINTENANCE, { connection: redis, prefix });

  const http = () => request(app.getHttpServer());
  const api = (path: string) => `/api/v1/admin/news${path}`;

  let n = 0;
  async function newsEvent(data: Partial<Prisma.NewsEventUncheckedCreateInput> = {}, articles = 1) {
    const now = new Date();
    const event = await prisma.newsEvent.create({
      data: {
        eventType: 'FLOODING',
        title: `Alagamento de teste ${tag} ${++n}`,
        locationPrecision: 'CITY',
        city: 'Osasco',
        state: 'SP',
        cityIbges: ['3534401'],
        regionId: osascoRegionId,
        confidence: 'MEDIUM',
        status: 'PUBLISHED_PRELIMINARY',
        estimatedSeverity: 'HIGH',
        rulesVersion: 'rules-2',
        firstEvidenceAt: now,
        lastEvidenceAt: now,
        ...data,
      },
    });
    for (let i = 0; i < articles; i++) {
      const url = `https://portal.example/${tag}/${randomUUID()}`;
      const article = await prisma.newsArticle.create({
        data: {
          sourceId, title: `Chuva alaga avenida em Osasco ${i}`, url, canonicalUrl: url,
          urlHash: createHash('sha256').update(url).digest('hex'), titleFingerprint: 'alaga avenida chuva osasco',
          publishedAt: now, processingStatus: 'ANALYZED', summary: 'Trecho interditado.',
        },
      });
      await prisma.newsAnalysis.create({
        data: {
          articleId: article.id, rulesVersion: 'rules-2', isRelevant: true, temporality: 'CURRENT', estimatedSeverity: 'HIGH', confidence: 'MEDIUM',
          locationPrecision: 'CITY', reasoningSummary: 'relata ocorrência',
          extractedData: { severityEvidence: [{ label: 'via interditada', excerpt: 'interditado', severity: 'HIGH' }], discardedEvidence: [], missing: [] },
        },
      });
      await prisma.newsEventArticle.create({ data: { eventId: event.id, articleId: article.id, isIndependent: true } });
    }
    return event;
  }

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    citizen = await registerUser(app, 'cidadao-news');
    moderator = await registerWithRole(app, 'MODERATOR');
    moderator2 = await registerWithRole(app, 'MODERATOR');
    admin = await registerWithRole(app, 'ADMIN');
    const osasco = await prisma.newsRegion.upsert({
      where: { ibgeCode: '3534401' },
      create: { kind: 'CITY', state: 'SP', name: 'Osasco', ibgeCode: '3534401', monitored: true },
      update: {},
    });
    osascoRegionId = osasco.id;
    const sp = await prisma.newsRegion.upsert({
      where: { ibgeCode: '3550308' },
      create: { kind: 'CITY', state: 'SP', name: 'São Paulo', ibgeCode: '3550308', monitored: true },
      update: {},
    });
    await prisma.newsRegion.upsert({
      where: { ibgeCode: '355030848' },
      create: { kind: 'DISTRICT', state: 'SP', name: 'Lapa', ibgeCode: '355030848', parentId: sp.id, monitored: true },
      update: {},
    });
    const source = await prisma.newsSource.create({
      data: { key: `${tag}-src`, name: 'Portal de teste', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: 'https://portal.example', feedUrl: 'https://portal.example/rss', enabled: true, termsCheckedAt: new Date() },
    });
    sourceId = source.id;
  });

  afterAll(async () => {
    await collectQueue.obliterate({ force: true }).catch(() => undefined);
    await maintenanceQueue.obliterate({ force: true }).catch(() => undefined);
    await collectQueue.close();
    await maintenanceQueue.close();
    await redis.quit();
    await app.close();
  });

  describe('permissões', () => {
    it('sem token → 401; cidadão → 403 em tudo', async () => {
      await http().get(api('/metrics')).expect(401);
      for (const path of ['/metrics', '/review', '/sources', '/collections']) await http().get(api(path)).set(auth(citizen)).expect(403);
      await http().post(api('/collect')).set(auth(citizen)).send({}).expect(403);
    });

    it('moderador modera mas não liga/desliga fontes; admin pode', async () => {
      await http().get(api('/review')).set(auth(moderator)).expect(200);
      await http().patch(api(`/sources/${sourceId}`)).set(auth(moderator)).send({ enabled: false }).expect(403);
      await http().patch(api(`/sources/${sourceId}`)).set(auth(admin)).send({ enabled: true }).expect(200);
    });
  });

  describe('fila de moderação', () => {
    it('padrão: só não finais, urgentes primeiro; filtros por gravidade "não informada", cidade e número', async () => {
      const normal = await newsEvent();
      const urgent = await newsEvent({ urgentReview: true, estimatedSeverity: 'CRITICAL' });
      const none = await newsEvent({ estimatedSeverity: null, status: 'AWAITING_VALIDATION', confidence: 'LOW' });
      const discarded = await newsEvent({ status: 'DISCARDED' });

      const res = await http().get(api('/review?limit=100')).set(auth(moderator)).expect(200);
      const ids = res.body.items.map((i: { id: string }) => i.id);
      expect(ids[0]).toBe(urgent.id);
      expect(ids).toEqual(expect.arrayContaining([normal.id, none.id]));
      expect(ids).not.toContain(discarded.id);
      expect(res.body.items.find((i: { id: string }) => i.id === normal.id)).toMatchObject({ sourceCount: 1, firstSource: 'Portal de teste', region: { name: 'Osasco' } });

      const sev = await http().get(api('/review?severity=NONE&limit=100')).set(auth(moderator)).expect(200);
      expect(sev.body.items.map((i: { id: string }) => i.id)).toContain(none.id);
      expect(sev.body.items.every((i: { estimatedSeverity: string | null }) => i.estimatedSeverity === null)).toBe(true);

      const byCode = await http().get(api(`/review?q=N-${normal.code}`)).set(auth(moderator)).expect(200);
      expect(byCode.body.items.map((i: { id: string }) => i.id)).toEqual([normal.id]);
      expect((await http().get(api('/review?city=3534401&limit=100')).set(auth(moderator)).expect(200)).body.total).toBeGreaterThanOrEqual(3);
      await http().get(api('/review?status=QUALQUER')).set(auth(moderator)).expect(400);
    });

    it('regiões monitoradas para correção de local (cidades e distritos)', async () => {
      const r = await http().get(api('/regions')).set(auth(moderator)).expect(200);
      expect(r.body).toEqual(expect.arrayContaining([
        { ibgeCode: '3534401', name: 'Osasco', kind: 'CITY', city: 'Osasco' },
        { ibgeCode: '355030848', name: 'Lapa', kind: 'DISTRICT', city: 'São Paulo' },
      ]));
    });

    it('detalhe traz fontes com evidências literais e as ações permitidas', async () => {
      const e = await newsEvent({}, 2);
      const res = await http().get(api(`/events/${e.id}`)).set(auth(moderator)).expect(200);
      expect(res.body).toMatchObject({ statusLabel: 'Publicado (preliminar)', allowedTransitions: ['PUBLISHED_VERIFIED', 'DISCARDED', 'RESOLVED'] });
      expect(res.body.sources).toHaveLength(2);
      expect(res.body.sources[0]).toMatchObject({
        source: { name: 'Portal de teste', reliability: 'ESTABLISHED_PRESS' },
        analysis: { rulesVersion: 'rules-2', modelVersion: 'none', severityEvidence: [{ label: 'via interditada', excerpt: 'interditado' }] },
      });
      await http().get(api(`/events/${randomUUID()}`)).set(auth(moderator)).expect(404);
    });
  });

  describe('decisões do moderador', () => {
    it('sem local não valida; corrige o local (distrito) e então valida — tudo auditado', async () => {
      const e = await newsEvent({ status: 'AWAITING_VALIDATION', confidence: 'LOW', locationPrecision: 'UNKNOWN', city: null, regionId: null, cityIbges: [] });
      const blocked = await http().post(api(`/events/${e.id}/approve`)).set(auth(moderator)).send({ expectedVersion: 1 }).expect(422);
      expect(blocked.body.message).toMatch(/localização/);

      const fixed = await http().patch(api(`/events/${e.id}`)).set(auth(moderator)).send({ expectedVersion: 1, regionIbge: '355030848', severity: 'MODERATE' }).expect(200);
      expect(fixed.body).toMatchObject({ version: 2, city: 'São Paulo', locationPrecision: 'NEIGHBORHOOD', estimatedSeverity: 'MODERATE', region: { name: 'Lapa', kind: 'DISTRICT' } });

      const ok = await http().post(api(`/events/${e.id}/approve`)).set(auth(moderator)).send({ expectedVersion: 2, note: 'Confirmado com a CET' }).expect(201);
      expect(ok.body).toMatchObject({ status: 'PUBLISHED_VERIFIED', version: 3, allowedTransitions: ['DISCARDED', 'RESOLVED'] });
      // A decisão já está gravada; a publicação (alerta + outbox) é pedida ao news-worker pela fila.
      expect(ok.body.publicationQueued).toBe(true);
      const recompute = await maintenanceQueue.getJobs(['waiting', 'delayed']);
      expect(recompute.some((j) => j.data.kind === 'recompute-event' && j.data.eventId === e.id)).toBe(true);

      const row = await prisma.newsEvent.findUniqueOrThrow({ where: { id: e.id } });
      expect(row).toMatchObject({ moderatedById: moderator.id, moderationNote: 'Confirmado com a CET', cityIbges: ['3550308'], districtIbges: ['355030848'] });
      const audit = await prisma.auditLog.findMany({ where: { entityType: 'news_event', entityId: e.id }, orderBy: { createdAt: 'asc' } });
      expect(audit.map((a) => a.action)).toEqual(['news_event.updated', 'news_event.approved']);
      expect(audit[0].before).toMatchObject({ locationPrecision: 'UNKNOWN', estimatedSeverity: 'HIGH' });
      expect(audit[0].after).toMatchObject({ locationPrecision: 'NEIGHBORHOOD', estimatedSeverity: 'MODERATE' });
      expect(audit[1].ipAddress).toBeTruthy();
    });

    it('local fora das regiões monitoradas é recusado; "NONE" limpa a gravidade', async () => {
      const e = await newsEvent();
      await http().patch(api(`/events/${e.id}`)).set(auth(moderator)).send({ expectedVersion: 1, regionIbge: '3304557' }).expect(422);
      const r = await http().patch(api(`/events/${e.id}`)).set(auth(moderator)).send({ expectedVersion: 1, severity: 'NONE' }).expect(200);
      expect(r.body.estimatedSeverity).toBeNull();
      await http().patch(api(`/events/${e.id}`)).set(auth(moderator)).send({ expectedVersion: 2 }).expect(422);
    });

    it('dois moderadores ao mesmo tempo: um vence, o outro recebe 409', async () => {
      const e = await newsEvent();
      const results = await Promise.all([
        http().post(api(`/events/${e.id}/approve`)).set(auth(moderator)).send({ expectedVersion: 1 }),
        http().post(api(`/events/${e.id}/reject`)).set(auth(moderator2)).send({ expectedVersion: 1, note: 'não é alagamento' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma.auditLog.count({ where: { entityType: 'news_event', entityId: e.id } })).toBe(1);
    });

    it('descarte exige motivo; evento descartado não pode ser validado depois', async () => {
      const e = await newsEvent();
      await http().post(api(`/events/${e.id}/reject`)).set(auth(moderator)).send({ expectedVersion: 1 }).expect(422);
      await http().post(api(`/events/${e.id}/reject`)).set(auth(moderator)).send({ expectedVersion: 1, note: 'Notícia sobre obras' }).expect(201);
      const again = await http().post(api(`/events/${e.id}/approve`)).set(auth(moderator)).send({ expectedVersion: 2 }).expect(422);
      expect(again.body.message).toMatch(/Descartado/);
    });

    it('encerrar alerta', async () => {
      const e = await newsEvent({ status: 'PUBLISHED_VERIFIED', confidence: 'HIGH' });
      const r = await http().post(api(`/events/${e.id}/resolve`)).set(auth(moderator)).send({ expectedVersion: 1, note: 'Via liberada' }).expect(201);
      expect(r.body).toMatchObject({ status: 'RESOLVED', allowedTransitions: [] });
    });

    it('duplicidade: fontes passam para o outro evento, este é descartado e o recálculo vai para a fila', async () => {
      const keep = await newsEvent({}, 1);
      const dup = await newsEvent({}, 2);
      const r = await http().post(api(`/events/${dup.id}/merge`)).set(auth(moderator)).send({ expectedVersion: 1, intoEventId: keep.id }).expect(201);
      expect(r.body).toMatchObject({ status: 'DISCARDED', mergedInto: keep.id, movedSources: 2, recomputeQueued: true });
      expect(await prisma.newsEventArticle.count({ where: { eventId: keep.id } })).toBe(3);
      expect(await prisma.newsEvent.findUniqueOrThrow({ where: { id: dup.id } })).toMatchObject({ status: 'DISCARDED', moderationNote: `Duplicado de N-${keep.code}` });
      const jobs = await maintenanceQueue.getJobs(['waiting', 'delayed']);
      expect(jobs.some((j) => j.data.kind === 'recompute-event' && j.data.eventId === keep.id)).toBe(true);
      await http().post(api(`/events/${keep.id}/merge`)).set(auth(moderator)).send({ expectedVersion: 1, intoEventId: keep.id }).expect(422);
    });
  });

  describe('fontes e coletas', () => {
    it('lista fontes com saúde; ligar sem termos conferidos é recusado; tudo auditado', async () => {
      const unchecked = await prisma.newsSource.create({
        data: { key: `${tag}-nova`, name: 'Fonte nova', type: 'RSS', reliability: 'UNKNOWN', baseUrl: 'https://nova.example', feedUrl: 'https://nova.example/rss' },
      });
      const list = await http().get(api('/sources')).set(auth(moderator)).expect(200);
      expect(list.body.find((s: { id: string }) => s.id === sourceId)).toMatchObject({ enabled: true, articleCount: expect.any(Number), lastJob: null });
      const denied = await http().patch(api(`/sources/${unchecked.id}`)).set(auth(admin)).send({ enabled: true }).expect(422);
      expect(denied.body.message).toMatch(/termos de uso/);
      await http().patch(api(`/sources/${unchecked.id}`)).set(auth(admin)).send({ enabled: false }).expect(200);
      expect(await prisma.auditLog.count({ where: { entityType: 'news_source', entityId: unchecked.id, action: 'news_source.disabled' } })).toBe(1);
    });

    it('coleta manual vai para a fila do news-worker, sem empilhar pedidos repetidos', async () => {
      const r1 = await http().post(api('/collect')).set(auth(moderator)).send({ sourceId }).expect(201);
      await http().post(api('/collect')).set(auth(moderator)).send({ sourceId }).expect(201);
      expect(r1.body.queued).toEqual([{ sourceId, key: `${tag}-src`, jobId: expect.any(String) }]);
      const waiting = (await collectQueue.getJobs(['waiting'])).filter((j) => j.data.sourceId === sourceId);
      expect(waiting).toHaveLength(1);
      expect(waiting[0].data).toMatchObject({ trigger: 'MANUAL', requestedById: moderator.id });
      await http().post(api('/collect')).set(auth(moderator)).send({ sourceId: randomUUID() }).expect(422);
    });

    it('indicadores refletem eventos, fontes e falhas de coleta', async () => {
      await prisma.newsCollectionJob.create({ data: { sourceId, trigger: 'SCHEDULE', status: 'FAILED', finishedAt: new Date(), errorMessage: 'HTTP 503' } });
      const m = await http().get(api('/metrics')).set(auth(moderator)).expect(200);
      expect(m.body.events.urgent).toBeGreaterThanOrEqual(1);
      expect(m.body.collectionFailures24h).toBeGreaterThanOrEqual(1);
      expect(m.body.sources.enabled).toBeGreaterThanOrEqual(1);
      expect(m.body.activeBySeverity).toEqual(expect.objectContaining({ HIGH: expect.any(Number) }));
      const failed = await http().get(api(`/collections?status=FAILED&sourceId=${sourceId}`)).set(auth(moderator)).expect(200);
      expect(failed.body.items[0]).toMatchObject({ status: 'FAILED', errorMessage: 'HTTP 503', source: { name: 'Portal de teste' } });
    });
  });
});
