import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MailService } from '../src/mail/mail.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createTestApp, PASSWORD, registerUser, registerWithRole } from './helpers';

describe('Autenticação e autorização (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
  });
  afterAll(() => app.close());

  describe('cadastro', () => {
    it('cria cidadão, retorna tokens e nunca expõe o hash da senha', async () => {
      const email = `nova-${randomUUID().slice(0, 8)}@Test.Local`;
      const res = await request(http)
        .post('/api/v1/auth/register')
        .send({ name: '  Maria Souza ', email, password: PASSWORD, acceptTerms: true })
        .expect(201);
      expect(res.body.user).toMatchObject({ name: 'Maria Souza', email: email.toLowerCase(), role: 'CITIZEN' });
      expect(res.body.accessToken).toBeTruthy();
      expect(res.body.refreshToken).toBeTruthy();
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|argon2/);

      const stored = await app.get(PrismaService).user.findUniqueOrThrow({ where: { id: res.body.user.id } });
      expect(stored.passwordHash).toMatch(/^\$argon2id\$/);
    });

    it('não permite escolher o próprio perfil (campo extra é rejeitado)', async () => {
      await request(http)
        .post('/api/v1/auth/register')
        .send({ name: 'Hacker', email: `h-${randomUUID()}@test.local`, password: PASSWORD, acceptTerms: true, role: 'ADMIN' })
        .expect(400);
    });

    it('valida senha fraca, e-mail inválido e aceite dos termos', async () => {
      const res = await request(http)
        .post('/api/v1/auth/register')
        .send({ name: 'X', email: 'invalido', password: '123', acceptTerms: false })
        .expect(400);
      const messages = (res.body.message as string[]).join(' | ');
      expect(messages).toMatch(/E-mail inválido/);
      expect(messages).toMatch(/A senha deve ter/);
      expect(messages).toMatch(/aceitar os termos/);
    });

    it('recusa e-mail duplicado sem diferenciar maiúsculas', async () => {
      const user = await registerUser(app, 'dup');
      await request(http)
        .post('/api/v1/auth/register')
        .send({ name: 'Outro', email: user.email.toUpperCase(), password: PASSWORD, acceptTerms: true })
        .expect(400);
    });
  });

  describe('login', () => {
    it('autentica com credenciais corretas', async () => {
      const user = await registerUser(app, 'login');
      const res = await request(http).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(200);
      expect(res.body.user.id).toBe(user.id);
    });

    it('responde a mesma mensagem para senha errada e e-mail inexistente', async () => {
      const user = await registerUser(app, 'login2');
      const wrong = await request(http).post('/api/v1/auth/login').send({ email: user.email, password: 'Errada@123' }).expect(401);
      const missing = await request(http)
        .post('/api/v1/auth/login')
        .send({ email: `naoexiste-${randomUUID()}@test.local`, password: 'Errada@123' })
        .expect(401);
      expect(wrong.body.message).toBe(missing.body.message);
    });

    it('bloqueia conta suspensa', async () => {
      const user = await registerUser(app, 'suspenso');
      await app.get(PrismaService).user.update({ where: { id: user.id }, data: { status: 'SUSPENDED' } });
      await request(http).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(403);
    });
  });

  describe('tokens', () => {
    it('rotas protegidas exigem token válido', async () => {
      await request(http).get('/api/v1/users/me').expect(401);
      await request(http).get('/api/v1/users/me').set('Authorization', 'Bearer abc.def.ghi').expect(401);
    });

    it('refresh rotaciona o token; reutilizar o antigo revoga toda a sessão', async () => {
      const user = await registerUser(app, 'refresh');
      const first = await request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(200);
      expect(first.body.refreshToken).not.toBe(user.refreshToken);

      // Reuso do token já trocado: tratado como roubo.
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
      // O token novo, da mesma família, também foi revogado.
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: first.body.refreshToken }).expect(401);
    });

    it('renovações concorrentes com o mesmo token: no máximo uma vence', async () => {
      const user = await registerUser(app, 'refresh-race');
      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken })),
      );
      expect(results.filter((r) => r.status === 200).length).toBeLessThanOrEqual(1);
    });

    it('logout invalida o refresh token', async () => {
      const user = await registerUser(app, 'logout');
      await request(http).post('/api/v1/auth/logout').send({ refreshToken: user.refreshToken }).expect(204);
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
    });
  });

  describe('recuperação de senha', () => {
    it('fluxo completo: código por e-mail → nova senha → sessões antigas encerradas', async () => {
      const user = await registerUser(app, 'reset');
      await request(http).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
      const mail = app.get(MailService).lastTo(user.email);
      const code = /(\d{6})/.exec(mail!.text)![1];

      await request(http)
        .post('/api/v1/auth/reset-password')
        .send({ email: user.email, code, newPassword: 'NovaSenha@9' })
        .expect(204);
      await request(http).post('/api/v1/auth/login').send({ email: user.email, password: 'NovaSenha@9' }).expect(200);
      await request(http).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
      await request(http).post('/api/v1/auth/refresh').send({ refreshToken: user.refreshToken }).expect(401);
      // Código de uso único.
      await request(http)
        .post('/api/v1/auth/reset-password')
        .send({ email: user.email, code, newPassword: 'Outra@Senha9' })
        .expect(400);
    });

    it('responde igual para e-mail inexistente (não revela contas)', async () => {
      const res = await request(http)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `ninguem-${randomUUID()}@test.local` })
        .expect(202);
      expect(res.body.message).toMatch(/Se o e-mail estiver cadastrado/);
    });

    it('bloqueia o código após 5 tentativas erradas', async () => {
      const user = await registerUser(app, 'reset-brute');
      await request(http).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(202);
      const code = /(\d{6})/.exec(app.get(MailService).lastTo(user.email)!.text)![1];
      const wrong = code === '000000' ? '111111' : '000000';
      for (let i = 0; i < 5; i++) {
        await request(http).post('/api/v1/auth/reset-password').send({ email: user.email, code: wrong, newPassword: 'NovaSenha@9' }).expect(400);
      }
      // Mesmo o código correto deixa de funcionar.
      await request(http).post('/api/v1/auth/reset-password').send({ email: user.email, code, newPassword: 'NovaSenha@9' }).expect(400);
    });
  });

  describe('autorização por perfil (RBAC)', () => {
    it('somente ADMIN lista usuários', async () => {
      const citizen = await registerUser(app, 'rbac-cidadao');
      const moderator = await registerWithRole(app, 'MODERATOR');
      const admin = await registerWithRole(app, 'ADMIN');

      await request(http).get('/api/v1/users').set(auth(citizen)).expect(403);
      await request(http).get('/api/v1/users').set(auth(moderator)).expect(403);
      const res = await request(http).get('/api/v1/users?limit=5').set(auth(admin)).expect(200);
      expect(res.body.items.length).toBeGreaterThan(0);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash/);
    });
  });
});
