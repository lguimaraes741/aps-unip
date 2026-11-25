import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createOccurrence, createTestApp, registerUser, TestUser } from './helpers';

describe('Confirmações colaborativas (e2e)', () => {
  let app: INestApplication;
  let http: ReturnType<INestApplication['getHttpServer']>;
  let prisma: PrismaService;
  let author: TestUser;

  beforeAll(async () => {
    app = await createTestApp();
    http = app.getHttpServer();
    prisma = app.get(PrismaService);
    author = await registerUser(app, 'autor-conf');
  });
  afterAll(() => app.close());

  const put = (u: TestUser, id: string, type: string) =>
    request(http).put(`/api/v1/occurrences/${id}/confirmation`).set(auth(u)).send({ type });

  it('confirmar, trocar para contestar e retirar ajustam os contadores', async () => {
    const o = await createOccurrence(app, author);
    const voter = await registerUser(app, 'voter');

    let res = await put(voter, o.id, 'CONFIRM').expect(200);
    expect(res.body).toEqual({ confirmCount: 1, contestCount: 0, myConfirmation: 'CONFIRM' });

    res = await put(voter, o.id, 'CONFIRM').expect(200); // repetição idempotente
    expect(res.body).toEqual({ confirmCount: 1, contestCount: 0, myConfirmation: 'CONFIRM' });

    res = await put(voter, o.id, 'CONTEST').expect(200);
    expect(res.body).toEqual({ confirmCount: 0, contestCount: 1, myConfirmation: 'CONTEST' });

    res = await request(http).delete(`/api/v1/occurrences/${o.id}/confirmation`).set(auth(voter)).expect(200);
    expect(res.body).toEqual({ confirmCount: 0, contestCount: 0, myConfirmation: null });

    const detail = await request(http).get(`/api/v1/occurrences/${o.id}`).set(auth(voter)).expect(200);
    expect(detail.body.myConfirmation).toBeNull();
  });

  it('o autor não pode confirmar a própria ocorrência', async () => {
    const o = await createOccurrence(app, author);
    await put(author, o.id, 'CONFIRM').expect(403);
  });

  it('ocorrência resolvida não aceita novas confirmações', async () => {
    const o = await createOccurrence(app, author);
    await prisma.occurrence.update({ where: { id: o.id }, data: { status: 'RESOLVED', resolvedAt: new Date() } });
    const voter = await registerUser(app, 'voter-resolvida');
    await put(voter, o.id, 'CONFIRM').expect(422);
  });

  it('concorrência: 15 usuários confirmando ao mesmo tempo → contadores exatos', async () => {
    const o = await createOccurrence(app, author);
    const voters = await Promise.all(Array.from({ length: 15 }, (_, i) => registerUser(app, `massa${i}`)));
    const results = await Promise.all(voters.map((v, i) => put(v, o.id, i % 3 === 0 ? 'CONTEST' : 'CONFIRM')));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const stored = await prisma.occurrence.findUniqueOrThrow({ where: { id: o.id } });
    expect(stored.confirmCount).toBe(10);
    expect(stored.contestCount).toBe(5);
    expect(await prisma.confirmation.count({ where: { occurrenceId: o.id } })).toBe(15);
  });

  it('concorrência: o mesmo usuário alternando 20 vezes → uma manifestação e contadores coerentes', async () => {
    const o = await createOccurrence(app, author);
    const voter = await registerUser(app, 'indeciso');
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => put(voter, o.id, i % 2 ? 'CONTEST' : 'CONFIRM')));
    expect(results.every((r) => r.status === 200)).toBe(true);

    const stored = await prisma.occurrence.findUniqueOrThrow({ where: { id: o.id } });
    const rows = await prisma.confirmation.findMany({ where: { occurrenceId: o.id } });
    expect(rows).toHaveLength(1);
    expect(stored.confirmCount + stored.contestCount).toBe(1);
    expect(rows[0].type === 'CONFIRM' ? stored.confirmCount : stored.contestCount).toBe(1);
  });
});
