/**
 * Alertas de notícia no worker de notificações (Fase 7, Etapa 10) — PostGIS e Redis reais.
 * A região é um quadrado de ~4 km num ponto aleatório do interior do país, para não cruzar com
 * dados de outros testes no mesmo banco.
 */
import { NewsAlertEventPayload, NewsReviewEventPayload, OccurrenceEventJob, QueueName, Severity } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { NotificationWorker, prismaTransactionOptions, PushDeliveryJob, pushQueueOptions } from '../src/notification-worker';
import { PushMessage, PushProvider, PushResult } from '../src/push/push-provider';

const prefix = `${process.env.REDIS_PREFIX}-news-${Date.now()}`;
const silent = { log: () => undefined, warn: () => undefined };
const KM = 1 / 111.32; // graus por km (aprox., suficiente para montar o teste)

class FakeProvider implements PushProvider {
  readonly name = 'fake';
  readonly delivers = true;
  sent: PushMessage[] = [];
  async send(m: PushMessage): Promise<PushResult> {
    this.sent.push(m);
    return { ok: true };
  }
}

describe('Worker de notificações — alertas de notícia', () => {
  const prisma = new PrismaClient({ transactionOptions: prismaTransactionOptions });
  const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: null });
  const pushQueue = new Queue<PushDeliveryJob>(QueueName.PUSH_DELIVERIES, { connection: redis, ...pushQueueOptions(prefix, 3) });
  const provider = new FakeProvider();
  const core = new NotificationWorker(prisma, pushQueue, provider, undefined, silent, 3);
  const center = { lat: -10 - Math.random() * 4, lng: -48 - Math.random() * 4 };
  const tag = randomUUID().slice(0, 8);
  let cityId: string;
  let districtId: string;

  const user = async (label: string) =>
    prisma.user.create({ data: { name: `Notícia ${label}`, email: `${label}-${randomUUID().slice(0, 8)}@news.test`, passwordHash: 'x' } });
  /** Preferência a `km` quilômetros a leste do centro da cidade de teste. */
  const pref = (userId: string, km: number, radius = 1000, minSeverity: Severity = 'MODERATE', pushEnabled = true) =>
    prisma.notificationPreference.create({ data: { userId, latitude: center.lat, longitude: center.lng + km * KM, radiusMeters: radius, minSeverity, pushEnabled } });

  const event = (regionId: string) =>
    prisma.newsEvent.create({
      data: {
        eventType: 'FLOODING', title: `Alagamento ${tag}`, status: 'PUBLISHED_PRELIMINARY', regionId, city: 'Cidade Teste', state: 'SP',
        locationPrecision: 'CITY', confidence: 'MEDIUM', estimatedSeverity: 'HIGH', rulesVersion: 'rules-2', firstEvidenceAt: new Date(), lastEvidenceAt: new Date(),
      },
    });

  const job = (eventId: string, over: Partial<NewsAlertEventPayload> = {}): OccurrenceEventJob => {
    const payload: NewsAlertEventPayload = {
      alertId: randomUUID(), eventId, code: 1, title: 'Chuva alaga avenida', status: 'ACTIVE', level: 'PRELIMINARY', severity: 'HIGH',
      city: 'Cidade Teste', regionId: null, regionName: 'Cidade Teste', locationPrecision: 'CITY', latitude: null, longitude: null,
      headline: 'via interditada', revision: 1, notify: true, change: 'new', ...over,
    };
    return { eventId: randomUUID(), type: 'news.alert.published', aggregateId: payload.alertId, occurredAt: new Date().toISOString(), payload: payload as never };
  };

  beforeAll(async () => {
    // Cidade de teste: quadrado de 4 km × 4 km; distrito sem contorno (como os distritos reais).
    const city = await prisma.newsRegion.create({ data: { kind: 'CITY', state: 'SP', name: `Cidade Teste ${tag}`, monitored: true } });
    const h = 2 * KM;
    await prisma.$executeRaw`
      UPDATE news_regions SET boundary = ST_Multi(ST_MakeEnvelope(${center.lng - h}, ${center.lat - h}, ${center.lng + h}, ${center.lat + h}, 4326))::geography
      WHERE id = ${city.id}::uuid`;
    cityId = city.id;
    districtId = (await prisma.newsRegion.create({ data: { kind: 'DISTRICT', state: 'SP', name: `Distrito Teste ${tag}`, parentId: city.id, monitored: true } })).id;
  });

  afterAll(async () => {
    await prisma.newsEvent.deleteMany({ where: { title: `Alagamento ${tag}` } });
    await prisma.newsRegion.deleteMany({ where: { id: { in: [districtId, cityId] } } });
    await pushQueue.obliterate({ force: true });
    await pushQueue.close();
    await redis.quit();
    await prisma.$disconnect();
  });

  it('notifica só quem tem a área de interesse cruzando a cidade, com gravidade suficiente e push ligado', async () => {
    const inside = await user('dentro');
    const edge = await user('borda'); // a 2,5 km do centro (0,5 km fora do quadrado) com raio de 1 km → cruza
    const far = await user('longe');
    const picky = await user('exigente');
    const off = await user('desligado');
    await pref(inside.id, 0);
    await pref(edge.id, 2.5, 1000);
    await pref(far.id, 8, 1000);
    await pref(picky.id, 0, 1000, 'CRITICAL');
    await pref(off.id, 0, 1000, 'LOW', false);
    const e = await event(cityId);

    const r = await core.processOccurrenceEvent(job(e.id));
    expect(r).toEqual({ duplicate: false, notifications: 2 });
    const rows = await prisma.notification.findMany({ where: { newsEventId: e.id }, orderBy: { distanceMeters: 'asc' } });
    expect(rows.map((n) => n.userId)).toEqual([inside.id, edge.id]);
    expect(rows[0]).toMatchObject({ type: 'NEWS_ALERT', occurrenceId: null, distanceMeters: 0, title: 'Alerta de alagamento — Cidade Teste' });
    expect(rows[0].body).toContain('Notícia ainda não confirmada');
    expect(rows[1].distanceMeters).toBeGreaterThan(400);

    // Reprocessar o mesmo evento do outbox não duplica.
    const same = job(e.id);
    await core.processOccurrenceEvent(same);
    expect(await core.processOccurrenceEvent(same)).toEqual({ duplicate: true, notifications: 0 });
  });

  it('distrito sem contorno usa o contorno da cidade (nunca "todo mundo")', async () => {
    const u = await user('distrito');
    await pref(u.id, 1);
    const e = await event(districtId);
    expect((await core.processOccurrenceEvent(job(e.id, { regionName: 'Distrito Teste' }))).notifications).toBeGreaterThanOrEqual(1);
    expect(await prisma.notification.count({ where: { newsEventId: e.id, userId: u.id } })).toBe(1);
  });

  it('evento sem área conhecida não notifica ninguém', async () => {
    const e = await prisma.newsEvent.create({
      data: { eventType: 'FLOODING', title: `Alagamento ${tag}`, status: 'PUBLISHED_PRELIMINARY', locationPrecision: 'UNKNOWN', confidence: 'MEDIUM', estimatedSeverity: 'HIGH', rulesVersion: 'rules-2', firstEvidenceAt: new Date(), lastEvidenceAt: new Date(), moderatedById: null },
    });
    expect(await core.processOccurrenceEvent(job(e.id))).toEqual({ duplicate: false, notifications: 0 });
  });

  it('decisão "notify: false" (ex.: crítico sem confirmação) é respeitada', async () => {
    const u = await user('critico');
    await pref(u.id, 0);
    const e = await event(cityId);
    expect(await core.processOccurrenceEvent(job(e.id, { notify: false, severity: 'CRITICAL' }))).toEqual({ duplicate: false, notifications: 0 });
  });

  it('correção/desmentido vai só para quem recebeu o alerta original, com tipo de atualização', async () => {
    const a = await user('recebeu');
    await pref(a.id, 0);
    const e = await event(cityId);
    await core.processOccurrenceEvent(job(e.id));
    const later = await user('chegou-depois'); // passou a acompanhar a área depois do alerta
    await pref(later.id, 0);

    const retracted = { ...job(e.id, { change: 'retracted', status: 'RETRACTED' }), type: 'news.alert.retracted' as const };
    const r = await core.processOccurrenceEvent(retracted as OccurrenceEventJob);
    const updates = await prisma.notification.findMany({ where: { newsEventId: e.id, type: 'NEWS_ALERT_UPDATE' } });
    expect(updates.map((n) => n.userId)).toContain(a.id);
    expect(updates.map((n) => n.userId)).not.toContain(later.id);
    expect(r.notifications).toBe(updates.length);
    expect(updates[0]).toMatchObject({ title: 'Alerta corrigido — Cidade Teste' });
  });

  it('push leva o id do evento de notícia (deep link) e nunca o de ocorrência', async () => {
    const u = await user('push');
    await prisma.deviceToken.create({ data: { userId: u.id, token: `fid-${randomUUID()}`, platform: 'ANDROID' } });
    await pref(u.id, 0);
    const e = await event(cityId);
    await core.processOccurrenceEvent(job(e.id));
    const n = await prisma.notification.findFirstOrThrow({ where: { newsEventId: e.id, userId: u.id } });
    expect(await core.processPushDelivery({ data: { notificationId: n.id }, attemptsMade: 0 })).toBe('SENT');
    expect(provider.sent.at(-1)!.data).toMatchObject({ newsEventId: e.id, occurrenceId: '', type: 'NEWS_ALERT' });
  });

  it('revisão urgente: só MODERATOR/ADMIN ativos, sem filtro de área; push respeita alertas desligados; sem duplicar', async () => {
    const e = await event(cityId);
    const mod = await prisma.user.create({ data: { name: 'Mod urgente', email: `mod-${randomUUID().slice(0, 8)}@news.test`, passwordHash: 'x', role: 'MODERATOR' } });
    const admin = await prisma.user.create({ data: { name: 'Admin urgente', email: `adm-${randomUUID().slice(0, 8)}@news.test`, passwordHash: 'x', role: 'ADMIN' } });
    const suspended = await prisma.user.create({ data: { name: 'Mod suspenso', email: `sus-${randomUUID().slice(0, 8)}@news.test`, passwordHash: 'x', role: 'MODERATOR', status: 'SUSPENDED' } });
    const citizen = await user('cidadao-urgente');
    await pref(citizen.id, 0, 5000, 'LOW'); // área cobrindo a cidade: mesmo assim não recebe aviso de moderação
    await prisma.notificationPreference.create({ data: { userId: admin.id, pushEnabled: false } });
    await prisma.deviceToken.create({ data: { userId: mod.id, token: `fid-mod-${randomUUID()}`, platform: 'ANDROID' } });

    const payload: NewsReviewEventPayload = {
      eventId: e.id, code: e.code, title: 'Moradores ilhados após alagamento', city: 'Cidade Teste', severity: 'CRITICAL', status: 'PUBLISHED_PRELIMINARY', reasons: ['crítico sem corroboração'],
    };
    const reviewJob: OccurrenceEventJob = { eventId: randomUUID(), type: 'news.review.urgent' as never, aggregateId: e.id, occurredAt: new Date().toISOString(), payload: payload as never };

    const first = await core.processOccurrenceEvent(reviewJob);
    expect(first.duplicate).toBe(false);
    const mine = await prisma.notification.findMany({ where: { sourceEventId: reviewJob.eventId } });
    const byUser = new Map(mine.map((n) => [n.userId, n]));
    expect(byUser.get(mod.id)).toMatchObject({ type: 'NEWS_REVIEW_URGENT', newsEventId: e.id, pushStatus: 'PENDING' });
    expect(byUser.get(mod.id)!.title).toBe('Revisão urgente: notícia de gravidade crítica — Cidade Teste');
    expect(byUser.get(mod.id)!.body).toContain('SEM push até a moderação conferir');
    expect(byUser.get(admin.id)).toMatchObject({ type: 'NEWS_REVIEW_URGENT', pushStatus: 'SKIPPED' });
    expect(byUser.has(citizen.id)).toBe(false);
    expect(byUser.has(suspended.id)).toBe(false);
    expect(mine.every((n) => n.type === 'NEWS_REVIEW_URGENT')).toBe(true);

    // Reentrega do mesmo evento ("pelo menos uma vez"): nada novo.
    expect(await core.processOccurrenceEvent(reviewJob)).toEqual({ duplicate: true, notifications: 0 });
    expect(await prisma.notification.count({ where: { sourceEventId: reviewJob.eventId } })).toBe(mine.length);

    // Push do moderador: o app usa o `type` para abrir a central (a notícia pode não estar publicada).
    expect(await core.processPushDelivery({ data: { notificationId: byUser.get(mod.id)!.id }, attemptsMade: 0 })).toBe('SENT');
    expect(provider.sent.at(-1)!.data).toMatchObject({ type: 'NEWS_REVIEW_URGENT', newsEventId: e.id });

    await prisma.user.deleteMany({ where: { id: { in: [mod.id, admin.id, suspended.id] } } });
  });
});
