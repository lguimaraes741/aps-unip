import { INestApplication } from '@nestjs/common';
import { EventEnvelope, QueueName, SocketMessage } from '@alertacidade/shared-types';
import { Queue } from 'bullmq';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { OutboxPublisherService } from '../src/events/outbox-publisher.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { OCCURRENCE_EVENTS_QUEUE, OccurrenceEventsQueue } from '../src/redis/redis.module';
import { randomUUID } from 'node:crypto';
import { auth, createOccurrence, createTestApp, registerUser, registerWithRole, TestUser } from './helpers';

/**
 * Tempo real distribuído: duas instâncias da API (A e B) no mesmo PostgreSQL e Redis,
 * como em produção com balanceador. Um cliente conectado em B precisa receber o que
 * foi registrado por A.
 */
describe('Tempo real e outbox (e2e, 2 instâncias)', () => {
  let a: INestApplication;
  let b: INestApplication;
  let urlA: string;
  let urlB: string;
  let prisma: PrismaService;
  let author: TestUser;
  let watcher: TestUser;
  const sockets: Socket[] = [];

  const listen = async (app: INestApplication) => {
    await app.listen(0, '127.0.0.1');
    return `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  };

  const connect = (url: string, token?: string) =>
    new Promise<Socket>((resolve, reject) => {
      const socket = io(url, { auth: token ? { token } : {}, transports: ['websocket'], reconnection: false, forceNew: true });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', (err) => reject(err));
    });

  /**
   * Coleta eventos até `predicate` ser verdadeiro (ou falha após `ms`). A condição é
   * reavaliada a cada evento e também periodicamente, pois ela pode depender de dados
   * (ex.: ids criados) que só ficam conhecidos depois que os eventos já chegaram.
   */
  const collectUntil = (socket: Socket, predicate: (events: EventEnvelope[]) => boolean, ms = 10_000) =>
    new Promise<EventEnvelope[]>((resolve, reject) => {
      const events: EventEnvelope[] = [];
      const finish = (error?: Error) => {
        clearTimeout(timer);
        clearInterval(poll);
        socket.off(SocketMessage.EVENT, onEvent);
        if (error) reject(error);
        else resolve(events);
      };
      const check = () => {
        if (predicate(events)) finish();
      };
      const onEvent = (e: EventEnvelope) => {
        events.push(e);
        check();
      };
      const timer = setTimeout(() => finish(new Error(`timeout: ${events.length} eventos recebidos`)), ms);
      const poll = setInterval(check, 100);
      socket.on(SocketMessage.EVENT, onEvent);
    });

  beforeAll(async () => {
    a = await createTestApp();
    b = await createTestApp();
    urlA = await listen(a);
    urlB = await listen(b);
    prisma = a.get(PrismaService);
    author = await registerUser(a, 'autor-rt');
    watcher = await registerUser(a, 'observador-rt');
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await a.close();
    await b.close();
  });

  describe('autenticação do socket', () => {
    it('recusa conexão sem token', async () => {
      await expect(connect(urlA)).rejects.toThrow('unauthorized');
    });

    it('recusa token inválido e refresh token no lugar do access token', async () => {
      await expect(connect(urlA, 'abc.def.ghi')).rejects.toThrow('unauthorized');
      await expect(connect(urlA, author.refreshToken)).rejects.toThrow('unauthorized');
    });

    it('aceita JWT de acesso válido', async () => {
      const socket = await connect(urlA, author.token);
      expect(socket.connected).toBe(true);
    });
  });

  it('A registra → cliente conectado em B recebe o evento (Socket.IO + Redis)', async () => {
    const socket = await connect(urlB, watcher.token);
    let id = '';
    const received = collectUntil(socket, (events) => events.some((e) => e.payload.occurrenceId === id));
    const created = await createOccurrence(a, author, { severity: 'CRITICAL' });
    id = created.id;
    const events = await received;
    const event = events.find((e) => e.payload.occurrenceId === id)!;
    expect(event).toMatchObject({
      type: 'occurrence.created',
      payload: { occurrenceId: id, code: created.code, severity: 'CRITICAL', status: 'PENDING' },
    });
    expect(event.sequence).toMatch(/^\d+$/);
    // O payload não expõe dados do autor.
    expect(JSON.stringify(event)).not.toContain(author.id);
  });

  it('evento "só equipe" (news.review.urgent): moderador recebe; cidadão não recebe nem pelo socket nem pelo /sync, e o cursor dele avança', async () => {
    const moderator = await registerWithRole(a, 'MODERATOR');
    const before = await request(a.getHttpServer()).get('/api/v1/sync').set(auth(watcher)).expect(200);
    const citizenSocket = await connect(urlB, watcher.token);
    const staffSocket = await connect(urlB, moderator.token);
    const newsEventId = randomUUID();
    const secret = `Notícia ainda não publicada ${newsEventId}`;

    const staffGot = collectUntil(staffSocket, (ev) => ev.some((e) => e.type === 'news.review.urgent' && (e.payload as unknown as { eventId: string }).eventId === newsEventId));
    let markerId = '';
    const citizenGot = collectUntil(citizenSocket, (ev) => markerId !== '' && ev.some((e) => e.payload.occurrenceId === markerId));
    // Gravado pela A (como o news-worker grava no outbox); depois, um evento público como marcador.
    await prisma.domainEvent.create({
      data: { type: 'news.review.urgent', aggregateType: 'news_event', aggregateId: newsEventId, payload: { eventId: newsEventId, code: 1, title: secret, city: null, severity: 'CRITICAL', status: 'PUBLISHED_PRELIMINARY', reasons: [] } },
    });
    await new Promise((r) => setTimeout(r, 300)); // o publicador entrega na ordem de inserção
    markerId = (await createOccurrence(a, author)).id;

    expect((await staffGot).some((e) => e.type === 'news.review.urgent')).toBe(true);
    const citizenEvents = await citizenGot;
    expect(citizenEvents.some((e) => e.type.startsWith('news.review.'))).toBe(false);
    expect(JSON.stringify(citizenEvents)).not.toContain(secret);

    const citizenSync = await request(a.getHttpServer()).get('/api/v1/sync').query({ since: before.body.cursor, limit: 500 }).set(auth(watcher)).expect(200);
    expect(JSON.stringify(citizenSync.body.events)).not.toContain(secret);
    expect(citizenSync.body.events.some((e: EventEnvelope) => e.payload.occurrenceId === markerId)).toBe(true);
    // O cursor do cidadão passa por cima do evento que ele não vê (sem ficar preso na lacuna).
    const staffEvent = await prisma.domainEvent.findFirstOrThrow({ where: { aggregateId: newsEventId } });
    expect(BigInt(citizenSync.body.cursor)).toBeGreaterThan(staffEvent.publishedSequence!);

    const staffSync = await request(a.getHttpServer()).get('/api/v1/sync').query({ since: before.body.cursor, limit: 500 }).set(auth(moderator)).expect(200);
    expect(JSON.stringify(staffSync.body.events)).toContain(secret);
  });

  it('remoção gera occurrence.removed', async () => {
    const socket = await connect(urlA, watcher.token);
    const created = await createOccurrence(a, author);
    const received = collectUntil(socket, (events) => events.some((e) => e.type === 'occurrence.removed' && e.payload.occurrenceId === created.id));
    await request(a.getHttpServer()).delete(`/api/v1/occurrences/${created.id}`).set(auth(author)).expect(204);
    await expect(received).resolves.toBeDefined();
  });

  it('com 15 registros simultâneos, o cursor de entrega cresce sem repetir e /sync devolve todos', async () => {
    const before = await request(a.getHttpServer()).get('/api/v1/sync').set(auth(watcher)).expect(200);
    const socket = await connect(urlB, watcher.token);
    const ids = new Set<string>();
    const received = collectUntil(socket, (events) => events.filter((e) => ids.has(e.payload.occurrenceId)).length === 15, 20_000);
    const created = await Promise.all(Array.from({ length: 15 }, () => createOccurrence(a, author)));
    created.forEach((o) => ids.add(o.id));

    const live = (await received).filter((e) => ids.has(e.payload.occurrenceId));
    const sequences = live.map((e) => BigInt(e.sequence));
    for (let i = 1; i < sequences.length; i++) expect(sequences[i] > sequences[i - 1]).toBe(true);

    // Um cliente que estava offline recupera exatamente os mesmos eventos pelo cursor.
    const sync = await request(a.getHttpServer()).get('/api/v1/sync').query({ since: before.body.cursor, limit: 500 }).set(auth(watcher)).expect(200);
    const recovered = (sync.body.events as EventEnvelope[]).filter((e) => ids.has(e.payload.occurrenceId));
    expect(recovered.map((e) => e.eventId).sort()).toEqual(live.map((e) => e.eventId).sort());
    expect(sync.body.reset).toBe(false);
  });

  describe('GET /sync', () => {
    it('sem since devolve só o cursor atual; since maior que o servidor pede reset', async () => {
      const head = await request(a.getHttpServer()).get('/api/v1/sync').set(auth(watcher)).expect(200);
      expect(head.body).toMatchObject({ events: [], hasMore: false, reset: false });
      const ahead = (BigInt(head.body.cursor) + 1000n).toString();
      const res = await request(a.getHttpServer()).get('/api/v1/sync').query({ since: ahead }).set(auth(watcher)).expect(200);
      expect(res.body).toMatchObject({ events: [], reset: true, cursor: head.body.cursor });
    });

    it('pagina com hasMore e valida parâmetros', async () => {
      const res = await request(a.getHttpServer()).get('/api/v1/sync').query({ since: '0', limit: 2 }).set(auth(watcher)).expect(200);
      expect(res.body.events).toHaveLength(2);
      expect(res.body.hasMore).toBe(true);
      expect(res.body.cursor).toBe(res.body.events[1].sequence);
      await request(a.getHttpServer()).get('/api/v1/sync').query({ since: 'abc' }).set(auth(watcher)).expect(400);
      await request(a.getHttpServer()).get('/api/v1/sync').expect(401);
    });
  });

  it('cada evento vira um job no BullMQ com jobId = id do evento', async () => {
    const created = await createOccurrence(a, author);
    const event = await waitFor(async () => {
      const e = await prisma.domainEvent.findFirst({ where: { aggregateId: created.id } });
      return e?.publishedAt ? e : undefined;
    });
    const queue = a.get<OccurrenceEventsQueue>(OCCURRENCE_EVENTS_QUEUE);
    const job = await queue.getJob(event.id);
    expect(job?.data).toMatchObject({ eventId: event.id, type: 'occurrence.created', aggregateId: created.id });
    expect(queue.name).toBe(QueueName.OCCURRENCE_EVENTS);
  });

  it('Redis indisponível: o evento fica pendente com o erro registrado e é publicado quando volta', async () => {
    // Pausa o publicador de B para que só A (com a fila "quebrada") tente publicar.
    const publisherB = b.get(OutboxPublisherService);
    await publisherB.onModuleDestroy();
    const queueA = a.get<Queue>(OCCURRENCE_EVENTS_QUEUE);
    const spy = jest.spyOn(queueA, 'addBulk').mockRejectedValue(new Error('Connection is closed.'));

    const created = await createOccurrence(a, author);
    const failed = await waitFor(async () => {
      const e = await prisma.domainEvent.findFirst({ where: { aggregateId: created.id } });
      return e && e.attempts > 0 ? e : undefined;
    });
    expect(failed).toMatchObject({ publishedAt: null, publishedSequence: null, lastError: 'Connection is closed.' });

    spy.mockRestore();
    const published = await waitFor(async () => {
      const e = await prisma.domainEvent.findFirst({ where: { aggregateId: created.id } });
      return e?.publishedAt ? e : undefined;
    }, 20_000);
    expect(published.lastError).toBeNull();
    expect(published.publishedSequence).not.toBeNull();
  });
});

async function waitFor<T>(fn: () => Promise<T | undefined>, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await fn();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error('condição não atingida a tempo');
    await new Promise((r) => setTimeout(r, 100));
  }
}
