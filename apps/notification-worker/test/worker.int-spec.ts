import { NotificationItem, OccurrenceEventJob, QueueName, Severity, SocketMessage } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { createAdapter } from '@socket.io/redis-adapter';
import { Emitter } from '@socket.io/redis-emitter';
import { Queue, QueueEvents, Worker } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { AddressInfo } from 'node:net';
import { Server } from 'socket.io';
import { io as connectClient } from 'socket.io-client';
import { CONSUMER, NotificationWorker, prismaTransactionOptions, PushDeliveryJob, pushQueueOptions } from '../src/notification-worker';
import { LogPushProvider } from '../src/push/log-provider';
import { PushMessage, PushProvider, PushResult } from '../src/push/push-provider';

const prefix = `${process.env.REDIS_PREFIX}-${Date.now()}`;
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
/**
 * Cada teste usa um ponto aleatório (interior do país): áreas de interesse criadas por execuções
 * anteriores no mesmo banco de testes nunca ficam dentro do raio e não interferem na contagem.
 */
const randomArea = () => ({ lat: -8 - Math.random() * 6, lng: -45 - Math.random() * 6 });
let area = randomArea();
const silent = { log: () => undefined, warn: () => undefined };

/** Provedor falso controlável: registra envios e devolve o resultado programado por token. */
class FakeProvider implements PushProvider {
  readonly name = 'fake';
  readonly delivers = true;
  sent: PushMessage[] = [];
  results = new Map<string, PushResult>();
  async send(message: PushMessage): Promise<PushResult> {
    this.sent.push(message);
    return this.results.get(message.token) ?? { ok: true };
  }
}

describe('Worker de notificações (integração: PostGIS + Redis reais)', () => {
  const prisma = new PrismaClient({ transactionOptions: prismaTransactionOptions });
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const pushQueue = new Queue<PushDeliveryJob>(QueueName.PUSH_DELIVERIES, { connection: redis, ...pushQueueOptions(prefix, 3) });
  const provider = new FakeProvider();
  const core = new NotificationWorker(prisma, pushQueue, provider, undefined, silent, 3);

  const user = async (label: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') =>
    prisma.user.create({
      data: { name: `Worker ${label}`, email: `${label}-${randomUUID().slice(0, 8)}@worker.test`, passwordHash: 'x', status },
    });

  /** Área de interesse a `meters` metros ao norte do ponto do teste. */
  const preference = (userId: string, meters: number, radius: number, minSeverity: Severity = 'MODERATE', pushEnabled = true) =>
    prisma.notificationPreference.create({
      data: { userId, latitude: area.lat + meters / 111_320, longitude: area.lng, radiusMeters: radius, minSeverity, pushEnabled },
    });

  const occurrence = (createdById: string, severity: Severity = 'HIGH') =>
    prisma.occurrence.create({
      data: {
        title: 'Alagamento (teste do worker)',
        description: 'Teste automatizado do worker.',
        address: 'Praça da Sé',
        neighborhood: 'Sé',
        latitude: area.lat,
        longitude: area.lng,
        severity,
        occurredAt: new Date(),
        createdById,
      },
    });

  const eventFor = (o: { id: string; code: number; severity: Severity }, type: OccurrenceEventJob['type'] = 'occurrence.created'): OccurrenceEventJob => ({
    eventId: randomUUID(),
    type,
    aggregateId: o.id,
    occurredAt: new Date().toISOString(),
    payload: { occurrenceId: o.id, code: o.code, severity: o.severity, status: 'PENDING', latitude: area.lat, longitude: area.lng, neighborhood: 'Sé', version: 1 },
  });

  beforeEach(() => {
    area = randomArea();
  });

  afterAll(async () => {
    await pushQueue.obliterate({ force: true }).catch(() => undefined);
    await pushQueue.close();
    redis.disconnect();
    await prisma.$disconnect();
  });

  describe('destinatários de occurrence.created', () => {
    it('notifica só quem tem a ocorrência na área, com gravidade suficiente, alertas ligados e conta ativa', async () => {
      const author = await user('autor');
      const perto = await user('perto');
      const longe = await user('longe');
      const exigente = await user('exigente');
      const silenciado = await user('silenciado');
      const suspenso = await user('suspenso', 'SUSPENDED');
      const semArea = await user('sem-area');
      await Promise.all([
        preference(perto.id, 600, 2000), // 600 m, raio 2 km → recebe
        preference(longe.id, 8000, 2000), // 8 km, raio 2 km → não
        preference(exigente.id, 300, 5000, 'CRITICAL'), // gravidade HIGH < CRITICAL → não
        preference(silenciado.id, 300, 5000, 'LOW', false), // alertas desligados → não
        preference(suspenso.id, 300, 5000), // conta suspensa → não
        preference(author.id, 0, 5000), // o próprio autor → não
        prisma.notificationPreference.create({ data: { userId: semArea.id } }), // sem área → não
      ]);
      const o = await occurrence(author.id, 'HIGH');

      const result = await core.processOccurrenceEvent(eventFor(o));
      expect(result).toEqual({ duplicate: false, notifications: 1 });

      const notifications = await prisma.notification.findMany({ where: { occurrenceId: o.id } });
      expect(notifications).toHaveLength(1);
      expect(notifications[0]).toMatchObject({ userId: perto.id, type: 'OCCURRENCE_NEARBY', pushStatus: 'PENDING' });
      expect(notifications[0].distanceMeters).toBeGreaterThan(550);
      expect(notifications[0].distanceMeters).toBeLessThan(650);
      expect(notifications[0].title).toBe(`Alagamento de gravidade alta a ${notifications[0].distanceMeters} m (Sé)`);
      // O push foi enfileirado com jobId = id da notificação.
      expect(await pushQueue.getJob(notifications[0].id)).toBeDefined();
    });

    it('ocorrência removida antes do processamento não notifica ninguém', async () => {
      const author = await user('autor-removida');
      const vizinho = await user('vizinho-removida');
      await preference(vizinho.id, 100, 1000);
      const o = await occurrence(author.id);
      await prisma.occurrence.update({ where: { id: o.id }, data: { deletedAt: new Date() } });
      await expect(core.processOccurrenceEvent(eventFor(o))).resolves.toEqual({ duplicate: false, notifications: 0 });
    });
  });

  describe('idempotência', () => {
    it('o mesmo evento reprocessado (em sequência ou em paralelo) gera uma notificação por pessoa', async () => {
      const author = await user('autor-idem');
      const vizinho = await user('vizinho-idem');
      await preference(vizinho.id, 200, 1000);
      const o = await occurrence(author.id);
      const event = eventFor(o);

      const results = await Promise.all(Array.from({ length: 5 }, () => core.processOccurrenceEvent(event)));
      expect(results.filter((r) => !r.duplicate)).toHaveLength(1);
      expect(await core.processOccurrenceEvent(event)).toEqual({ duplicate: true, notifications: 0 });
      expect(await prisma.notification.count({ where: { occurrenceId: o.id } })).toBe(1);
      expect(await prisma.processedMessage.count({ where: { consumer: CONSUMER, messageId: event.eventId } })).toBe(1);
    });
  });

  describe('mudança de status', () => {
    it('validação avisa o autor; atualização comum não gera aviso', async () => {
      const author = await user('autor-status');
      const o = await occurrence(author.id);
      await core.processOccurrenceEvent(eventFor(o, 'occurrence.validated'));
      await core.processOccurrenceEvent(eventFor(o, 'occurrence.updated'));
      const rows = await prisma.notification.findMany({ where: { occurrenceId: o.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ userId: author.id, type: 'OCCURRENCE_STATUS_CHANGED', title: `Sua ocorrência #${o.code} foi validada` });
    });
  });

  describe('entrega do push', () => {
    const notificationFor = async (label: string, tokens: string[]) => {
      const u = await user(label);
      await Promise.all(tokens.map((token) => prisma.deviceToken.create({ data: { userId: u.id, token, platform: 'ANDROID' } })));
      return prisma.notification.create({ data: { userId: u.id, type: 'OCCURRENCE_NEARBY', title: 'Teste', body: 'Corpo' } });
    };
    const job = (id: string, attemptsMade = 0) => ({ data: { notificationId: id }, attemptsMade });

    it('enviado com sucesso → SENT, com deep link nos dados', async () => {
      const token = `ok-${randomUUID()}`;
      const n = await notificationFor('push-ok', [token]);
      await expect(core.processPushDelivery(job(n.id))).resolves.toBe('SENT');
      expect(provider.sent.find((m) => m.token === token)?.data).toMatchObject({ notificationId: n.id, type: 'OCCURRENCE_NEARBY' });
      // Repetir o job não reenvia.
      const before = provider.sent.length;
      await expect(core.processPushDelivery(job(n.id))).resolves.toBe('SENT');
      expect(provider.sent.length).toBe(before);
    });

    it('sem aparelho registrado → SKIPPED', async () => {
      const n = await notificationFor('push-sem-aparelho', []);
      await expect(core.processPushDelivery(job(n.id))).resolves.toBe('SKIPPED');
    });

    it('token desinstalado é removido; erro na mensagem não apaga o token', async () => {
      const dead = `dead-${randomUUID()}`;
      const badMsg = `bad-${randomUUID()}`;
      provider.results.set(dead, { ok: false, permanent: true, removeToken: true, reason: 'not-registered' });
      provider.results.set(badMsg, { ok: false, permanent: true, removeToken: false, reason: 'invalid-argument' });
      const n = await notificationFor('push-permanente', [dead, badMsg]);
      await expect(core.processPushDelivery(job(n.id))).resolves.toBe('FAILED');
      expect(await prisma.deviceToken.count({ where: { token: dead } })).toBe(0);
      expect(await prisma.deviceToken.count({ where: { token: badMsg } })).toBe(1);
    });

    it('falha temporária: lança para o BullMQ repetir e vira FAILED na última tentativa', async () => {
      const flaky = `flaky-${randomUUID()}`;
      provider.results.set(flaky, { ok: false, permanent: false, reason: 'messaging/unavailable' });
      const n = await notificationFor('push-temporario', [flaky]);
      await expect(core.processPushDelivery(job(n.id, 0))).rejects.toThrow(/temporária/);
      await expect(core.processPushDelivery(job(n.id, 1))).rejects.toThrow(/temporária/);
      await expect(core.processPushDelivery(job(n.id, 2))).resolves.toBe('FAILED'); // 3ª de 3
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: n.id } });
      expect(row).toMatchObject({ pushStatus: 'FAILED', pushAttempts: 3 });
      expect(row.lastError).toContain('messaging/unavailable');
    });

    it('provedor de desenvolvimento nunca marca SENT', async () => {
      const lines: string[] = [];
      const devCore = new NotificationWorker(prisma, pushQueue, new LogPushProvider((l) => lines.push(l)), undefined, silent, 3);
      const n = await notificationFor('push-log', [`log-${randomUUID()}`]);
      await expect(devCore.processPushDelivery(job(n.id))).resolves.toBe('SKIPPED');
      expect(lines[0]).toContain('[push de desenvolvimento]');
      expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).lastError).toContain('FCM não configurado');
    });
  });

  it('fluxo completo pelas filas reais: evento → notificação → push SENT, e aviso em tempo real no socket do usuário', async () => {
    // Servidor Socket.IO com o MESMO adaptador Redis da API, para provar que o emitter do worker chega ao app.
    const pub = new Redis(redisUrl);
    const sub = pub.duplicate();
    const http = createServer();
    const ioServer = new Server(http, { adapter: createAdapter(pub, sub, { key: `${prefix}#socket.io` }) });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));

    const author = await user('autor-fluxo');
    const vizinho = await user('vizinho-fluxo');
    await preference(vizinho.id, 300, 1000);
    const token = `fluxo-${randomUUID()}`;
    await prisma.deviceToken.create({ data: { userId: vizinho.id, token, platform: 'ANDROID' } });

    ioServer.on('connection', (s) => void s.join(`user:${vizinho.id}`));
    const client = connectClient(`http://127.0.0.1:${(http.address() as AddressInfo).port}`, { transports: ['websocket'], forceNew: true });
    await new Promise<void>((r) => client.once('connect', () => r()));
    const realtime = new Promise<NotificationItem>((r) => client.once(SocketMessage.NOTIFICATION, r));

    const emitterRedis = new Redis(redisUrl);
    const emitter = new Emitter(emitterRedis, { key: `${prefix}#socket.io` });
    const fullCore = new NotificationWorker(prisma, pushQueue, provider, emitter, silent, 3);
    const events = new Queue<OccurrenceEventJob>(QueueName.OCCURRENCE_EVENTS, { connection: redis, prefix });
    const workerConn = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const eventsWorker = new Worker<OccurrenceEventJob>(QueueName.OCCURRENCE_EVENTS, (j) => fullCore.processOccurrenceEvent(j.data), { connection: workerConn, prefix });
    const pushWorker = new Worker<PushDeliveryJob>(QueueName.PUSH_DELIVERIES, (j) => fullCore.processPushDelivery(j), { connection: workerConn, prefix });
    const eventsConn = new Redis(redisUrl, { maxRetriesPerRequest: null });
    const pushEvents = new QueueEvents(QueueName.PUSH_DELIVERIES, { connection: eventsConn, prefix });

    try {
      const o = await occurrence(author.id, 'CRITICAL');
      const event = eventFor(o);
      await events.add(event.type, event, { jobId: event.eventId });
      await events.add(event.type, event, { jobId: event.eventId }); // reenvio do publicador: ignorado pela fila

      const item = await realtime;
      expect(item).toMatchObject({ occurrenceId: o.id, type: 'OCCURRENCE_NEARBY', readAt: null });
      const pushJob = await pushQueue.getJob(item.id);
      await pushJob!.waitUntilFinished(pushEvents, 15_000);
      const row = await prisma.notification.findUniqueOrThrow({ where: { id: item.id } });
      expect(row.pushStatus).toBe('SENT');
      expect(provider.sent.filter((m) => m.token === token)).toHaveLength(1);
      expect(await prisma.notification.count({ where: { occurrenceId: o.id } })).toBe(1);
    } finally {
      client.disconnect();
      await Promise.all([eventsWorker.close(), pushWorker.close(), pushEvents.close()]);
      await events.obliterate({ force: true }).catch(() => undefined);
      await events.close();
      ioServer.close();
      // Conexões passadas de fora são "compartilhadas" para o BullMQ: ele não as fecha.
      for (const c of [pub, sub, emitterRedis, workerConn, eventsConn]) c.disconnect();
    }
  });
});
