import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers';

describe('Rate limiting (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    // Lido a cada requisição pelo @Throttle das rotas de autenticação.
    process.env.AUTH_THROTTLE_LIMIT = '3';
    app = await createTestApp();
  });
  afterAll(async () => {
    process.env.AUTH_THROTTLE_LIMIT = '100000';
    await app.close();
  });

  it('bloqueia tentativas excessivas de login com 429', async () => {
    const attempt = () =>
      request(app.getHttpServer()).post('/api/v1/auth/login').send({ email: 'alvo@test.local', password: 'Tentativa@1' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
  });
});
