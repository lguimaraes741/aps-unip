import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  auth,
  createOccurrence,
  createTestApp,
  occurrencePayload,
  registerUser,
  registerWithRole,
  SE,
  TestUser,
} from './helpers';

describe('Ocorrências (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let author: TestUser;
  let reader: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    author = await registerUser(app, 'autor');
    reader = await registerUser(app, 'leitor');
  });
  afterAll(() => app.close());

  describe('criação', () => {
    it('cria com status PENDING, linha do tempo e evento no outbox (mesma transação)', async () => {
      const o = await createOccurrence(app, author);
      expect(o).toMatchObject({ status: 'PENDING', isMine: true, confirmCount: 0, isDemo: false });
      expect(o.code).toEqual(expect.any(Number));
      expect(o.history).toEqual([expect.objectContaining({ fromStatus: null, toStatus: 'PENDING', actor: 'CITIZEN' })]);

      const events = await prisma.domainEvent.findMany({ where: { aggregateId: o.id } });
      expect(events).toHaveLength(1);
      // Gravado na mesma transação; publicado de forma assíncrona pelo publicador do outbox.
      expect(events[0]).toMatchObject({ type: 'occurrence.created', aggregateType: 'occurrence' });
      expect(events[0].payload).toMatchObject({ occurrenceId: o.id, severity: 'HIGH', status: 'PENDING' });
    });

    it('é idempotente com clientRequestId (reenvio após falha de rede)', async () => {
      const clientRequestId = randomUUID();
      const body = occurrencePayload({ clientRequestId });
      const first = await request(http).post('/api/v1/occurrences').set(auth(author)).send(body).expect(201);
      const retry = await request(http).post('/api/v1/occurrences').set(auth(author)).send(body).expect(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect(retry.body.id).toBe(first.body.id);
      expect(await prisma.occurrence.count({ where: { clientRequestId } })).toBe(1);
      expect(await prisma.domainEvent.count({ where: { aggregateId: first.body.id } })).toBe(1);
    });

    it('reenvios simultâneos idênticos geram um único registro', async () => {
      const body = occurrencePayload({ clientRequestId: randomUUID() });
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(http).post('/api/v1/occurrences').set(auth(author)).send(body)),
      );
      expect(results.every((r) => [200, 201].includes(r.status))).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
    });

    it('valida campos obrigatórios, coordenadas, gravidade e data', async () => {
      const res = await request(http)
        .post('/api/v1/occurrences')
        .set(auth(author))
        .send({ title: 'a', description: 'curta', latitude: 120, longitude: -46, severity: 'EXTREMA', occurredAt: '2099-01-01T00:00:00Z' })
        .expect(400);
      const msg = (res.body.message as string[]).join(' | ');
      for (const field of ['title', 'description', 'address', 'latitude', 'severity']) expect(msg).toContain(field);
      expect(msg).toMatch(/futuro/);
    });

    it('rejeita data muito antiga e exige autenticação', async () => {
      await request(http)
        .post('/api/v1/occurrences')
        .set(auth(author))
        .send(occurrencePayload({ occurredAt: new Date(Date.now() - 10 * 86_400_000).toISOString() }))
        .expect(400);
      await request(http).post('/api/v1/occurrences').send(occurrencePayload()).expect(401);
    });

    it('ignora tentativa de injetar status ou autor (campos não permitidos)', async () => {
      await request(http)
        .post('/api/v1/occurrences')
        .set(auth(author))
        .send(occurrencePayload({ status: 'VALIDATED', createdById: reader.id }))
        .expect(400);
    });
  });

  describe('consulta geográfica e filtros', () => {
    const tag = `geo-${randomUUID().slice(0, 6)}`;
    let near: string, mid: string, far: string, low: string;

    beforeAll(async () => {
      near = (await createOccurrence(app, author, { title: `Perto ${tag}` })).id;
      mid = (await createOccurrence(app, author, { title: `Médio ${tag}`, latitude: SE.lat + 0.01 })).id; // ~1,1 km
      far = (await createOccurrence(app, author, { title: `Longe ${tag}`, latitude: SE.lat + 0.08 })).id; // ~8,9 km
      low = (await createOccurrence(app, author, { title: `Baixa ${tag}`, severity: 'LOW', latitude: SE.lat + 0.002 })).id;
    });

    it('retorna apenas o que está no raio, do mais próximo ao mais distante, com distância', async () => {
      const res = await request(http)
        .get('/api/v1/occurrences')
        .query({ lat: SE.lat, lng: SE.lng, radius: 2000, q: tag })
        .set(auth(reader))
        .expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([near, low, mid]);
      expect(res.body.total).toBe(3);
      expect(res.body.items[2].distanceMeters).toBeGreaterThan(1000);
      expect(res.body.items[2].distanceMeters).toBeLessThan(1200);
    });

    it('filtra por gravidade (lista separada por vírgula)', async () => {
      const res = await request(http)
        .get('/api/v1/occurrences')
        .query({ lat: SE.lat, lng: SE.lng, radius: 20000, q: tag, severity: 'LOW' })
        .set(auth(reader))
        .expect(200);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual([low]);
    });

    it('raio maior inclui o registro distante; paginação funciona', async () => {
      const page1 = await request(http)
        .get('/api/v1/occurrences')
        .query({ lat: SE.lat, lng: SE.lng, radius: 20000, q: tag, limit: 2, page: 1 })
        .set(auth(reader))
        .expect(200);
      const page2 = await request(http)
        .get('/api/v1/occurrences')
        .query({ lat: SE.lat, lng: SE.lng, radius: 20000, q: tag, limit: 2, page: 2 })
        .set(auth(reader))
        .expect(200);
      expect(page1.body.total).toBe(4);
      expect([...page1.body.items, ...page2.body.items].map((i: { id: string }) => i.id)).toEqual([near, low, mid, far]);
    });

    it('busca textual trata curingas literalmente', async () => {
      const res = await request(http).get('/api/v1/occurrences').query({ q: '%' }).set(auth(reader)).expect(200);
      expect(res.body.items).toEqual([]);
    });

    it('valida parâmetros (lat sem lng, raio fora da faixa, status inexistente)', async () => {
      await request(http).get('/api/v1/occurrences').query({ lat: SE.lat }).set(auth(reader)).expect(400);
      await request(http).get('/api/v1/occurrences').query({ lat: SE.lat, lng: SE.lng, radius: 10 }).set(auth(reader)).expect(400);
      await request(http).get('/api/v1/occurrences').query({ status: 'QUALQUER' }).set(auth(reader)).expect(400);
    });
  });

  describe('visibilidade, detalhes e meus registros', () => {
    it('registros rejeitados ficam ocultos para outros cidadãos, mas não para o autor e a moderação', async () => {
      const o = await createOccurrence(app, author);
      await prisma.occurrence.update({ where: { id: o.id }, data: { status: 'REJECTED' } });
      const moderator = await registerWithRole(app, 'MODERATOR');

      await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(reader)).expect(404);
      await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(author)).expect(200);
      await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(moderator)).expect(200);

      const asCitizen = await request(http).get('/api/v1/occurrences').query({ status: 'REJECTED' }).set(auth(reader)).expect(200);
      expect(asCitizen.body.items).toEqual([]);
    });

    it('detalhes expõem apenas o primeiro nome do autor e calculam a distância', async () => {
      const o = await createOccurrence(app, author);
      const res = await request(http)
        .get(`/api/v1/occurrences/${o.id}`)
        .query({ lat: SE.lat + 0.01, lng: SE.lng })
        .set(auth(reader))
        .expect(200);
      expect(res.body.reporter).toEqual({ firstName: 'Teste' });
      expect(res.body.isMine).toBe(false);
      expect(res.body.distanceMeters).toBeGreaterThan(1000);
      expect(JSON.stringify(res.body)).not.toContain(author.email);
    });

    it('id inválido retorna 400 e inexistente 404', async () => {
      await request(http).get('/api/v1/occurrences/nao-e-uuid').set(auth(reader)).expect(400);
      await request(http).get(`/api/v1/occurrences/${randomUUID()}`).set(auth(reader)).expect(404);
    });

    it('meus registros: lista, filtros e totais apenas do próprio usuário', async () => {
      const me = await registerUser(app, 'meus');
      const a = await createOccurrence(app, me);
      const b = await createOccurrence(app, me);
      await createOccurrence(app, reader);
      await prisma.occurrence.update({ where: { id: b.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });

      const all = await request(http).get('/api/v1/occurrences/mine').set(auth(me)).expect(200);
      expect(all.body.total).toBe(2);
      const pending = await request(http).get('/api/v1/occurrences/mine?filter=pending').set(auth(me)).expect(200);
      expect(pending.body.items.map((i: { id: string }) => i.id)).toEqual([a.id]);

      const summary = await request(http).get('/api/v1/occurrences/mine/summary').set(auth(me)).expect(200);
      expect(summary.body).toEqual({ total: 2, active: 1, pending: 1, resolved: 1 });
    });

    it('autor remove ocorrência pendente; outro usuário não', async () => {
      const o = await createOccurrence(app, author);
      await request(http).delete(`/api/v1/occurrences/${o.id}`).set(auth(reader)).expect(403);
      await request(http).delete(`/api/v1/occurrences/${o.id}`).set(auth(author)).expect(204);
      await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(author)).expect(404);
    });

    it('salvar e denunciar são idempotentes', async () => {
      const o = await createOccurrence(app, author);
      await request(http).put(`/api/v1/occurrences/${o.id}/save`).set(auth(reader)).expect(200);
      await request(http).put(`/api/v1/occurrences/${o.id}/save`).set(auth(reader)).expect(200);
      const detail = await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(reader)).expect(200);
      expect(detail.body.isSaved).toBe(true);

      for (let i = 0; i < 2; i++) {
        await request(http).post(`/api/v1/occurrences/${o.id}/reports`).set(auth(reader)).send({ reason: 'SPAM' }).expect(204);
      }
      expect(await prisma.contentReport.count({ where: { occurrenceId: o.id } })).toBe(1);
    });
  });
});
