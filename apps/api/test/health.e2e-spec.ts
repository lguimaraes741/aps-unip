import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { OutboxPublisherService } from '../src/events/outbox-publisher.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { REDIS_CLIENT } from '../src/redis/redis.module';

describe('GET /api/v1/health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    // O publicador do outbox também usa $queryRaw em segundo plano e consumiria o mock
    // de falha do banco abaixo; ele não participa destes testes.
    await app.get(OutboxPublisherService).onModuleDestroy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('responde 200 com banco e PostGIS disponíveis', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks.database).toBe('up');
    expect(res.body.checks.postgis).toMatch(/^3\.\d+/);
    expect(res.body.checks.redis).toBe('up');
  });

  it('Redis fora: continua 200, mas com status degraded (REST segue funcionando)', async () => {
    const redis = app.get<{ ping: () => Promise<string> }>(REDIS_CLIENT);
    const spy = jest.spyOn(redis, 'ping').mockRejectedValueOnce(new Error('Connection is closed.'));
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body).toMatchObject({ status: 'degraded', checks: { database: 'up', redis: 'down' } });
    spy.mockRestore();
  });

  it('responde 503 sem expor detalhes quando o banco falha', async () => {
    const prisma = app.get(PrismaService);
    const spy = jest.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('connection refused at 10.0.0.1'));
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(503);
    expect(JSON.stringify(res.body)).not.toMatch(/10\.0\.0\.1/);
    expect(res.body.checks.database).toBe('down');
    spy.mockRestore();
  });

  it('publica a documentação Swagger', async () => {
    await request(app.getHttpServer()).get('/api/docs-json').expect(200);
  });
});
