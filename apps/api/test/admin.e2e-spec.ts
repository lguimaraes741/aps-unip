import { INestApplication } from '@nestjs/common';
import { EventEnvelope, SocketMessage } from '@alertacidade/shared-types';
import { AddressInfo } from 'node:net';
import { io, Socket } from 'socket.io-client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { auth, createOccurrence, createTestApp, PASSWORD, registerUser, registerWithRole, TestUser } from './helpers';

describe('Painel administrativo (e2e)', () => {
  let app: INestApplication;
  let url: string;
  let prisma: PrismaService;
  let citizen: TestUser;
  let other: TestUser;
  let moderator: TestUser;
  let moderator2: TestUser;
  let admin: TestUser;
  const sockets: Socket[] = [];

  const http = () => request(app.getHttpServer());
  const changeStatus = (user: TestUser, id: string, body: Record<string, unknown>) =>
    http().post(`/api/v1/admin/occurrences/${id}/status`).set(auth(user)).send(body);

  beforeAll(async () => {
    app = await createTestApp();
    await app.listen(0, '127.0.0.1');
    url = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    prisma = app.get(PrismaService);
    citizen = await registerUser(app, 'cidadao-adm');
    other = await registerUser(app, 'outro-adm');
    moderator = await registerWithRole(app, 'MODERATOR');
    moderator2 = await registerWithRole(app, 'MODERATOR');
    admin = await registerWithRole(app, 'ADMIN');
  });

  afterAll(async () => {
    sockets.forEach((s) => s.disconnect());
    await app.close();
  });

  describe('permissões (a interface não é a barreira de segurança)', () => {
    it('cidadão não acessa nada do painel; sem token → 401', async () => {
      await http().get('/api/v1/admin/dashboard').expect(401);
      for (const path of ['/api/v1/admin/dashboard', '/api/v1/admin/occurrences', '/api/v1/admin/content-reports', '/api/v1/admin/audit']) {
        await http().get(path).set(auth(citizen)).expect(403);
      }
    });

    it('moderador modera, mas não vê auditoria nem gerencia usuários', async () => {
      await http().get('/api/v1/admin/dashboard').set(auth(moderator)).expect(200);
      await http().get('/api/v1/admin/audit').set(auth(moderator)).expect(403);
      await http().patch(`/api/v1/admin/users/${citizen.id}`).set(auth(moderator)).send({ role: 'MODERATOR' }).expect(403);
    });
  });

  describe('moderação', () => {
    it('fluxo completo PENDING → UNDER_REVIEW → VALIDATED → RESOLVED com histórico, eventos e auditoria', async () => {
      const o = await createOccurrence(app, citizen);
      let res = await changeStatus(moderator, o.id, { status: 'UNDER_REVIEW', expectedVersion: 1 }).expect(201);
      expect(res.body).toMatchObject({ status: 'UNDER_REVIEW', version: 2, allowedTransitions: ['VALIDATED', 'REJECTED'] });
      res = await changeStatus(moderator, o.id, { status: 'VALIDATED', expectedVersion: 2, note: 'Confirmado por imagens' }).expect(201);
      res = await changeStatus(moderator, o.id, { status: 'RESOLVED', expectedVersion: 3 }).expect(201);
      expect(res.body).toMatchObject({ status: 'RESOLVED', version: 4, allowedTransitions: [] });

      const row = await prisma.occurrence.findUniqueOrThrow({ where: { id: o.id } });
      expect(row.validatedAt).not.toBeNull();
      expect(row.resolvedAt).not.toBeNull();
      expect(row.moderatedById).toBe(moderator.id);

      const events = await prisma.domainEvent.findMany({ where: { aggregateId: o.id }, orderBy: { sequence: 'asc' } });
      expect(events.map((e) => e.type)).toEqual(['occurrence.created', 'occurrence.updated', 'occurrence.validated', 'occurrence.resolved']);

      const audit = await prisma.auditLog.findMany({ where: { entityId: o.id, action: 'occurrence.status_changed' }, orderBy: { createdAt: 'asc' } });
      expect(audit).toHaveLength(3);
      expect(audit[1]).toMatchObject({
        actorId: moderator.id,
        before: { status: 'UNDER_REVIEW', version: 2, moderationNote: null },
        after: { status: 'VALIDATED', version: 3, moderationNote: 'Confirmado por imagens' },
      });

      // No app, o histórico mostra que foi a moderação (sem expor quem).
      const detail = await http().get(`/api/v1/occurrences/${o.id}`).set(auth(other)).expect(200);
      expect(detail.body.history.map((h: { toStatus: string; actor: string }) => [h.toStatus, h.actor])).toEqual([
        ['PENDING', 'CITIZEN'],
        ['UNDER_REVIEW', 'MODERATION'],
        ['VALIDATED', 'MODERATION'],
        ['RESOLVED', 'MODERATION'],
      ]);

      // Análise no painel: histórico com nomes; e-mail do autor só para ADMIN.
      const forMod = await http().get(`/api/v1/admin/occurrences/${o.id}`).set(auth(moderator)).expect(200);
      expect(forMod.body.author.email).toBeUndefined();
      expect(forMod.body.history[2]).toMatchObject({ toStatus: 'VALIDATED', note: 'Confirmado por imagens', actor: { role: 'MODERATOR' } });
      const forAdmin = await http().get(`/api/v1/admin/occurrences/${o.id}`).set(auth(admin)).expect(200);
      expect(forAdmin.body.author.email).toBe(citizen.email);
    });

    it('dois moderadores ao mesmo tempo: só um vence, o outro recebe 409 (controle otimista)', async () => {
      const o = await createOccurrence(app, citizen);
      const results = await Promise.all([
        changeStatus(moderator, o.id, { status: 'VALIDATED', expectedVersion: 1 }),
        changeStatus(moderator2, o.id, { status: 'REJECTED', expectedVersion: 1, note: 'Duplicada' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      const loser = results.find((r) => r.status === 409)!;
      expect(loser.body.message).toMatch(/alterada por outra pessoa/);
      expect(await prisma.occurrenceStatusHistory.count({ where: { occurrenceId: o.id } })).toBe(2); // criação + 1 moderação
      // Versão desatualizada também é recusada.
      await changeStatus(moderator, o.id, { status: 'RESOLVED', expectedVersion: 1 }).expect(409);
    });

    it('transições inválidas e rejeição sem motivo são recusadas', async () => {
      const o = await createOccurrence(app, citizen);
      await changeStatus(moderator, o.id, { status: 'RESOLVED', expectedVersion: 1 }).expect(422);
      const noNote = await changeStatus(moderator, o.id, { status: 'REJECTED', expectedVersion: 1 }).expect(422);
      expect(noNote.body.message).toMatch(/motivo/);
      await changeStatus(moderator, o.id, { status: 'APROVADA', expectedVersion: 1 }).expect(400);
      await changeStatus(moderator, '00000000-0000-4000-8000-000000000000', { status: 'VALIDATED', expectedVersion: 1 }).expect(404);
    });

    it('rejeitar tira a ocorrência do mapa público e notifica pelo outbox (occurrence.rejected)', async () => {
      const o = await createOccurrence(app, citizen, { title: `Rejeitar ${Date.now()}` });
      await changeStatus(moderator, o.id, { status: 'REJECTED', expectedVersion: 1, note: 'Foto não corresponde ao local' }).expect(201);
      const map = await http().get('/api/v1/occurrences').query({ q: o.title as string }).set(auth(other)).expect(200);
      expect(map.body.items.map((i: { id: string }) => i.id)).not.toContain(o.id);
      expect(await prisma.domainEvent.count({ where: { aggregateId: o.id, type: 'occurrence.rejected' } })).toBe(1);
    });

    it('CRITÉRIO DA FASE 5: moderar no painel chega ao app em tempo real', async () => {
      const socket = await new Promise<Socket>((resolve, reject) => {
        const s = io(url, { auth: { token: other.token }, transports: ['websocket'], forceNew: true, reconnection: false });
        sockets.push(s);
        s.once('connect', () => resolve(s));
        s.once('connect_error', reject);
      });
      const o = await createOccurrence(app, citizen);
      const received = new Promise<EventEnvelope>((resolve) => {
        socket.on(SocketMessage.EVENT, (e: EventEnvelope) => {
          if (e.payload.occurrenceId === o.id && e.type === 'occurrence.validated') resolve(e);
        });
      });
      const started = Date.now();
      await changeStatus(moderator, o.id, { status: 'VALIDATED', expectedVersion: 1 }).expect(201);
      const event = await received;
      expect(event.payload).toMatchObject({ status: 'VALIDATED', version: 2 });
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  });

  describe('denúncias', () => {
    it('cidadão denuncia → fila do painel → encerrar uma vez (auditado)', async () => {
      const o = await createOccurrence(app, citizen);
      await http().post(`/api/v1/occurrences/${o.id}/reports`).set(auth(other)).send({ reason: 'FALSE_INFORMATION', details: 'Não há água no local' }).expect((r) => expect([200, 201, 204]).toContain(r.status));
      const queue = await http().get('/api/v1/admin/content-reports').set(auth(moderator)).expect(200);
      const item = queue.body.items.find((r: { occurrence: { id: string } }) => r.occurrence.id === o.id);
      expect(item).toMatchObject({ status: 'OPEN', reason: 'FALSE_INFORMATION', reporter: expect.any(String) });

      const reported = await http().get('/api/v1/admin/occurrences').query({ reported: 'true', q: String(o.code) }).set(auth(moderator)).expect(200);
      expect(reported.body.items[0]).toMatchObject({ id: o.id, openReports: 1 });

      await http().post(`/api/v1/admin/content-reports/${item.id}/resolve`).set(auth(moderator)).send({ status: 'DISMISSED' }).expect(201);
      await http().post(`/api/v1/admin/content-reports/${item.id}/resolve`).set(auth(moderator)).send({ status: 'REVIEWED' }).expect(409);
      await http().post(`/api/v1/admin/content-reports/${item.id}/resolve`).set(auth(moderator)).send({ status: 'OPEN' }).expect(400);
      expect(await prisma.auditLog.count({ where: { entityId: item.id, action: 'content_report.resolved' } })).toBe(1);
    });
  });

  describe('relatórios batem com consultas SQL independentes', () => {
    const from = new Date(Date.now() - 2 * 24 * 3600_000);
    const to = new Date(Date.now() + 3600_000);

    beforeAll(async () => {
      // Garante variedade no período: bairros e gravidades conhecidos.
      const hood = `Bairro Relatório ${Date.now()}`;
      await createOccurrence(app, citizen, { neighborhood: hood, severity: 'CRITICAL' });
      await createOccurrence(app, citizen, { neighborhood: hood, severity: 'LOW' });
    });

    it('totais, por status, por gravidade e por bairro', async () => {
      const res = await http().get('/api/v1/admin/statistics').query({ from: from.toISOString(), to: to.toISOString() }).set(auth(moderator)).expect(200);
      const s = res.body;

      const [{ total }] = await prisma.$queryRaw<{ total: number }[]>`
        SELECT count(*)::int AS total FROM occurrences WHERE deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to}`;
      expect(s.total).toBe(total);

      const status = await prisma.$queryRaw<{ status: string; n: number }[]>`
        SELECT status::text AS status, count(*)::int AS n FROM occurrences
        WHERE deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to} GROUP BY status`;
      for (const r of status) expect(s.byStatus[r.status]).toBe(r.n);
      expect(Object.values(s.byStatus as Record<string, number>).reduce((a, b) => a + b, 0)).toBe(total);

      const severity = await prisma.$queryRaw<{ severity: string; n: number }[]>`
        SELECT severity::text AS severity, count(*)::int AS n FROM occurrences
        WHERE deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to} GROUP BY severity`;
      for (const r of severity) expect(s.bySeverity[r.severity]).toBe(r.n);

      const hoods = await prisma.$queryRaw<{ neighborhood: string; n: number }[]>`
        SELECT COALESCE(NULLIF(btrim(neighborhood), ''), 'Não informado') AS neighborhood, count(*)::int AS n FROM occurrences
        WHERE deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to} GROUP BY 1`;
      expect(s.byNeighborhood).toHaveLength(hoods.length);
      for (const h of hoods) expect(s.byNeighborhood.find((x: { neighborhood: string }) => x.neighborhood === h.neighborhood).total).toBe(h.n);
      expect((s.byDay as { total: number }[]).reduce((a, d) => a + d.total, 0)).toBe(total);
    });

    it('dashboard: fila de moderação e denúncias abertas iguais ao banco', async () => {
      const d = (await http().get('/api/v1/admin/dashboard').set(auth(moderator)).expect(200)).body;
      const [{ queue }] = await prisma.$queryRaw<{ queue: number }[]>`
        SELECT count(*)::int AS queue FROM occurrences WHERE deleted_at IS NULL AND status IN ('PENDING','UNDER_REVIEW')`;
      expect(d.moderationQueue).toBe(queue);
      const [{ open }] = await prisma.$queryRaw<{ open: number }[]>`
        SELECT count(*)::int AS open FROM content_reports r JOIN occurrences o ON o.id = r.occurrence_id
        WHERE r.status = 'OPEN' AND o.deleted_at IS NULL`;
      expect(d.openReports).toBe(open);
      expect(d.daily).toHaveLength(14);
    });

    it('período inválido ou longo demais → 400', async () => {
      await http().get('/api/v1/admin/statistics').query({ from: to.toISOString(), to: from.toISOString() }).set(auth(moderator)).expect(400);
      await http().get('/api/v1/admin/statistics').query({ from: '2020-01-01', to: '2026-01-01' }).set(auth(moderator)).expect(400);
      await http().get('/api/v1/admin/statistics').query({ from: 'ontem', to: to.toISOString() }).set(auth(moderator)).expect(400);
    });

    it('CSV: cabeçalho, BOM, separador ";" e proteção contra injeção de fórmulas', async () => {
      const evil = await createOccurrence(app, citizen, { title: '=HYPERLINK("http://mal.example","clique")', address: 'Rua "Aspas"; 10' });
      const res = await http()
        .get('/api/v1/admin/exports/occurrences.csv')
        .query({ from: from.toISOString(), to: to.toISOString() })
        .set(auth(moderator))
        .buffer(true)
        .parse((r, cb) => {
          let data = '';
          r.setEncoding('utf8');
          r.on('data', (c: string) => (data += c));
          r.on('end', () => cb(null, data));
        })
        .expect(200);
      expect(res.headers['content-type']).toMatch(/text\/csv/);
      expect(res.headers['content-disposition']).toMatch(/attachment; filename="ocorrencias_/);
      const text = res.body as string;
      expect(text.charCodeAt(0)).toBe(0xfeff);
      const lines = text.slice(1).trim().split('\r\n');
      expect(lines[0]).toBe('codigo;registrado_em;observado_em;titulo;endereco;bairro;latitude;longitude;gravidade;status;confirmacoes;contestacoes;validado_em;resolvido_em;demonstracao');
      const line = lines.find((l) => l.startsWith(`${evil.code};`))!;
      expect(line).toContain(`"'=HYPERLINK(""http://mal.example"",""clique"")"`); // vira texto, não fórmula
      expect(line).toContain('"Rua ""Aspas""; 10"');
      // Coordenadas negativas saem como número, sem apóstrofo.
      expect(line).toMatch(/;-23\.\d{6};-46\.\d{6};/);
      const [{ n }] = await prisma.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM occurrences WHERE deleted_at IS NULL AND NOT is_demo AND created_at >= ${from} AND created_at < ${to}`;
      expect(lines).toHaveLength(n + 1);
    });
  });

  describe('governança (ADMIN)', () => {
    it('promover, suspender (encerra sessões) e reativar — tudo auditado', async () => {
      const target = await registerUser(app, 'alvo-adm');
      let res = await http().patch(`/api/v1/admin/users/${target.id}`).set(auth(admin)).send({ role: 'MODERATOR' }).expect(200);
      expect(res.body).toMatchObject({ role: 'MODERATOR', status: 'ACTIVE' });

      res = await http().patch(`/api/v1/admin/users/${target.id}`).set(auth(admin)).send({ status: 'SUSPENDED' }).expect(200);
      expect(res.body.status).toBe('SUSPENDED');
      await http().post('/api/v1/auth/refresh').send({ refreshToken: target.refreshToken }).expect(401);
      await http().post('/api/v1/auth/login').send({ email: target.email, password: PASSWORD }).expect((r) => expect([401, 403]).toContain(r.status));

      await http().patch(`/api/v1/admin/users/${target.id}`).set(auth(admin)).send({ status: 'ACTIVE' }).expect(200);
      const trail = await http().get('/api/v1/admin/audit').query({ entityId: target.id, action: 'user.updated_by_admin' }).set(auth(admin)).expect(200);
      expect(trail.body.total).toBe(3);
      expect(trail.body.items[2]).toMatchObject({ before: { role: 'CITIZEN' }, after: { role: 'MODERATOR' }, actor: { id: admin.id } });
      // Nada sensível na trilha.
      expect(JSON.stringify(trail.body)).not.toMatch(/passwordHash|tokenHash/);
    });

    it('não altera a própria conta nem aceita estados inválidos', async () => {
      await http().patch(`/api/v1/admin/users/${admin.id}`).set(auth(admin)).send({ role: 'CITIZEN' }).expect(403);
      await http().patch(`/api/v1/admin/users/${citizen.id}`).set(auth(admin)).send({ status: 'DELETED' }).expect(400);
      await http().patch(`/api/v1/admin/users/${citizen.id}`).set(auth(admin)).send({}).expect(422);
    });
  });
});
