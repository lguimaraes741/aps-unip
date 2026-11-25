import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createOccurrence, createTestApp, registerUser, TestUser } from './helpers';

describe('Notificações: aparelhos e caixa de alertas (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ana: TestUser;
  let bruno: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
    ana = await registerUser(app, 'ana-notif');
    bruno = await registerUser(app, 'bruno-notif');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PUT /devices', () => {
    const token = `fcm-token-${Date.now()}-abcdefghij`;

    it('registra o token e é idempotente', async () => {
      await request(app.getHttpServer()).put('/api/v1/devices').set(auth(ana)).send({ token, platform: 'ANDROID' }).expect(204);
      await request(app.getHttpServer()).put('/api/v1/devices').set(auth(ana)).send({ token, platform: 'ANDROID' }).expect(204);
      expect(await prisma.deviceToken.count({ where: { token } })).toBe(1);
    });

    it('o mesmo aparelho com outra conta transfere o token', async () => {
      await request(app.getHttpServer()).put('/api/v1/devices').set(auth(bruno)).send({ token, platform: 'ANDROID' }).expect(204);
      const row = await prisma.deviceToken.findUniqueOrThrow({ where: { token } });
      expect(row.userId).toBe(bruno.id);
    });

    it('só o dono remove o token', async () => {
      await request(app.getHttpServer()).delete(`/api/v1/devices/${token}`).set(auth(ana)).expect(204);
      expect(await prisma.deviceToken.count({ where: { token } })).toBe(1);
      await request(app.getHttpServer()).delete(`/api/v1/devices/${token}`).set(auth(bruno)).expect(204);
      expect(await prisma.deviceToken.count({ where: { token } })).toBe(0);
    });

    it('valida plataforma e tamanho do token', async () => {
      await request(app.getHttpServer()).put('/api/v1/devices').set(auth(ana)).send({ token: 'curto', platform: 'ANDROID' }).expect(400);
      await request(app.getHttpServer()).put('/api/v1/devices').set(auth(ana)).send({ token, platform: 'SYMBIAN' }).expect(400);
      await request(app.getHttpServer()).put('/api/v1/devices').send({ token, platform: 'ANDROID' }).expect(401);
    });
  });

  describe('GET /notifications', () => {
    let firstId: string;

    beforeAll(async () => {
      const occurrence = await createOccurrence(app, bruno);
      const created = await Promise.all(
        [1, 2, 3].map((i) =>
          prisma.notification.create({
            data: {
              userId: ana.id,
              occurrenceId: occurrence.id,
              type: 'OCCURRENCE_NEARBY',
              title: `Alerta ${i}`,
              body: 'Alagamento perto da sua área de interesse',
              distanceMeters: 300 * i,
              createdAt: new Date(Date.now() - (3 - i) * 1000),
            },
          }),
        ),
      );
      firstId = created[0].id;
    });

    it('lista do mais recente para o mais antigo, com total e não lidas', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(ana)).expect(200);
      expect(res.body).toMatchObject({ total: 3, unread: 3, page: 1 });
      expect(res.body.items.map((n: { title: string }) => n.title)).toEqual(['Alerta 3', 'Alerta 2', 'Alerta 1']);
      expect(res.body.items[0]).toMatchObject({ type: 'OCCURRENCE_NEARBY', distanceMeters: 900, readAt: null });
    });

    it('traz o estado atual da ocorrência e filtra por críticos, próximos e resolvidos no servidor', async () => {
      const list = (filter: string) => request(app.getHttpServer()).get('/api/v1/notifications').query({ filter }).set(auth(ana)).expect(200);
      const all = await list('all');
      const occurrenceId = all.body.items[0].occurrenceId as string;
      expect(all.body.items[0].occurrence).toMatchObject({ code: expect.any(Number), severity: 'HIGH', status: 'PENDING' });

      expect((await list('nearby')).body.total).toBe(3);
      expect((await list('critical')).body.total).toBe(0);
      expect((await list('resolved')).body.total).toBe(0);

      // A ocorrência mudou depois do alerta: o filtro usa o estado ATUAL.
      await prisma.occurrence.update({ where: { id: occurrenceId }, data: { severity: 'CRITICAL', status: 'RESOLVED', resolvedAt: new Date() } });
      expect((await list('critical')).body.total).toBe(3);
      const resolved = await list('resolved');
      expect(resolved.body.total).toBe(3);
      expect(resolved.body.unread).toBe(3);

      // Removida: o alerta continua na caixa, sem dados da ocorrência.
      await prisma.occurrence.update({ where: { id: occurrenceId }, data: { deletedAt: new Date() } });
      expect((await list('all')).body.items[0].occurrence).toBeNull();

      await request(app.getHttpServer()).get('/api/v1/notifications').query({ filter: 'todos' }).set(auth(ana)).expect(400);
    });

    it('cada usuário só vê e marca os próprios alertas', async () => {
      const other = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(bruno)).expect(200);
      expect(other.body.total).toBe(0);
      await request(app.getHttpServer()).post(`/api/v1/notifications/${firstId}/read`).set(auth(bruno)).expect(404);
    });

    it('marca um e depois todos como lidos', async () => {
      await request(app.getHttpServer()).post(`/api/v1/notifications/${firstId}/read`).set(auth(ana)).expect(204);
      let res = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(ana)).expect(200);
      expect(res.body.unread).toBe(2);
      await request(app.getHttpServer()).post('/api/v1/notifications/read-all').set(auth(ana)).expect(204);
      res = await request(app.getHttpServer()).get('/api/v1/notifications').set(auth(ana)).expect(200);
      expect(res.body.unread).toBe(0);
      await request(app.getHttpServer()).post('/api/v1/notifications/nao-e-uuid/read').set(auth(ana)).expect(400);
    });
  });
});
