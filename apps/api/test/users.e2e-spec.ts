import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createOccurrence, createTestApp, PASSWORD, registerUser } from './helpers';

describe('Usuários, preferências e LGPD (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  it('consulta e atualiza o perfil', async () => {
    const user = await registerUser(app, 'perfil');
    await request(http).patch('/api/v1/users/me').set(auth(user)).send({ name: 'Nome Novo' }).expect(200);
    const me = await request(http).get('/api/v1/users/me').set(auth(user)).expect(200);
    expect(me.body).toMatchObject({ id: user.id, name: 'Nome Novo', role: 'CITIZEN' });
  });

  it('troca de senha exige a senha atual e encerra as sessões', async () => {
    const user = await registerUser(app, 'troca');
    await request(http).patch('/api/v1/users/me/password').set(auth(user)).send({ currentPassword: 'Errada@1', newPassword: 'Nova@Senha1' }).expect(401);
    await request(http).patch('/api/v1/users/me/password').set(auth(user)).send({ currentPassword: PASSWORD, newPassword: 'Nova@Senha1' }).expect(204);
    await request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
  });

  it('preferências de notificação: padrão, atualização e validação', async () => {
    const user = await registerUser(app, 'prefs');
    const initial = await request(http).get('/api/v1/users/me/notification-preferences').set(auth(user)).expect(200);
    expect(initial.body).toMatchObject({ pushEnabled: true, radiusMeters: 2000, minSeverity: 'MODERATE', latitude: null });

    const body = { pushEnabled: true, radiusMeters: 3000, minSeverity: 'HIGH', latitude: -23.55, longitude: -46.63 };
    const updated = await request(http).put('/api/v1/users/me/notification-preferences').set(auth(user)).send(body).expect(200);
    expect(updated.body).toMatchObject(body);

    // A coluna geográfica foi preenchida pelo trigger.
    const [row] = await app.get(PrismaService).$queryRaw<{ ok: boolean }[]>`
      SELECT location IS NOT NULL AS ok FROM notification_preferences WHERE user_id = ${user.id}::uuid`;
    expect(row.ok).toBe(true);

    await request(http)
      .put('/api/v1/users/me/notification-preferences')
      .set(auth(user))
      .send({ ...body, radiusMeters: 999999 })
      .expect(400);
  });

  it('exporta os dados pessoais (portabilidade)', async () => {
    const user = await registerUser(app, 'export');
    await createOccurrence(app, user);
    const res = await request(http).get('/api/v1/users/me/export').set(auth(user)).expect(200);
    expect(res.body.profile.email).toBe(user.email);
    expect(res.body.occurrences).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
  });

  it('exclusão de conta anonimiza dados e mantém os relatos sem autoria', async () => {
    const user = await registerUser(app, 'excluir');
    const occurrence = await createOccurrence(app, user);
    await request(http).delete('/api/v1/users/me').set(auth(user)).send({ password: 'Errada@1' }).expect(401);
    await request(http).delete('/api/v1/users/me').set(auth(user)).send({ password: PASSWORD }).expect(204);

    const prisma = app.get(PrismaService);
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.status).toBe('DELETED');
    expect(stored.email).not.toBe(user.email);
    expect(stored.name).toBe('Usuário removido');
    await request(http).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);

    const other = await registerUser(app, 'leitor');
    const detail = await request(http).get(`/api/v1/occurrences/${occurrence.id}`).set(auth(other)).expect(200);
    expect(detail.body.reporter.firstName).toBeNull();

    const audit = await prisma.auditLog.findFirst({ where: { entityId: user.id, action: 'user.deleted_self' } });
    expect(audit).not.toBeNull();
  });
});
