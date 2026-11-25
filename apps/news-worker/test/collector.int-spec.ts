/**
 * Coletor contra PostgreSQL real (banco de testes) e um "portal" HTTP local.
 */
import { PrismaClient } from '@prisma/client';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { collectSource, sourceBackoffMs } from '../src/collector/collector';
import { HostRateLimiter } from '../src/sources/rate-limit';

const prisma = new PrismaClient();
const tag = `c${Date.now().toString(36)}`;
const logger = { log: () => undefined, warn: () => undefined };
let server: Server;
let base: string;
let mode: 'ok' | 'down' | 'limited' | 'stale' = 'ok';

let batch = "";
const FEED = () => `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <item><title>Chuva alaga avenida e interdita via em Osasco</title><link>https://portal.example/${tag}/${batch}/1?utm_source=rss</link><pubDate>Tue, 24 Nov 2026 10:00:00 -0300</pubDate></item>
  <item><title>Chuva alaga avenida e interdita via em Osasco</title><link>https://www.portal.example/${tag}/${batch}/1</link></item>
  <item><title>Prefeitura inaugura praça no centro</title><link>https://portal.example/${tag}/${batch}/2</link></item>
  <item><title>Enchente atinge bairros de Barueri</title><link>javascript:alert(1)</link></item>
  <item><title>Temporal deixa famílias desalojadas em Carapicuíba</title><link>https://portal.example/${tag}/${batch}/3</link></item>
</channel></rss>`;

async function source(enabled = true) {
  return prisma.newsSource.create({
    data: {
      key: `${tag}-${Math.random().toString(36).slice(2, 8)}`,
      name: 'Portal local',
      type: 'RSS',
      reliability: 'ESTABLISHED_PRESS',
      baseUrl: base,
      feedUrl: `${base}/feed`,
      enabled,
      termsCheckedAt: enabled ? new Date() : null,
      minRequestIntervalMs: 1_000,
    },
  });
}

const deps = () => ({ prisma, limiter: new HostRateLimiter(async () => undefined), logger, allowPrivateNetwork: true, timeoutMs: 2_000 });

beforeAll(async () => {
  server = createServer((_, res) => {
    if (mode === 'down') return res.writeHead(503).end('fora do ar');
    if (mode === 'stale') return res.writeHead(200).end(FEED().split('Tue, 24 Nov 2026').join('Fri, 02 Mar 2018'));
    if (mode === 'limited') return res.writeHead(429, { 'Retry-After': '7200' }).end('devagar');
    res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }).end(FEED());
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await prisma.newsSource.deleteMany({ where: { key: { startsWith: tag } } });
  await prisma.$disconnect();
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  mode = 'ok';
  batch = Math.random().toString(36).slice(2, 8);
});

it('coleta: guarda só itens sobre alagamento, com URL válida, sem duplicar', async () => {
  const s = await source();
  const r = await collectSource(deps(), s.id, 'MANUAL');
  expect(r).toMatchObject({ status: 'SUCCEEDED', itemsFound: 5, itemsNew: 2 });

  const articles = await prisma.newsArticle.findMany({ where: { sourceId: s.id }, orderBy: { canonicalUrl: 'asc' } });
  expect(articles.map((a) => a.canonicalUrl)).toEqual([`https://portal.example/${tag}/${batch}/1`, `https://portal.example/${tag}/${batch}/3`]);
  expect(articles[0]).toMatchObject({ processingStatus: 'COLLECTED', publishedAt: new Date('2026-11-24T13:00:00Z'), collectionJobId: r.jobId });

  const job = await prisma.newsCollectionJob.findUniqueOrThrow({ where: { id: r.jobId! } });
  expect(job).toMatchObject({ status: 'SUCCEEDED', httpStatus: 200, itemsFound: 5, itemsNew: 2 });
  const after = await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } });
  expect(after.consecutiveFailures).toBe(0);
  expect(after.nextAttemptAt!.getTime() - after.lastSuccessfulCollectionAt!.getTime()).toBe(s.collectionIntervalSec * 1000);
});

it('recoleta do mesmo feed é idempotente (0 novos)', async () => {
  const s = await source();
  await collectSource(deps(), s.id, 'MANUAL');
  const again = await collectSource(deps(), s.id, 'MANUAL');
  expect(again).toMatchObject({ status: 'SUCCEEDED', itemsNew: 0 });
});

it('mesma notícia em duas fontes: gravada uma vez só (url_hash global)', async () => {
  const a = await source();
  const b = await source();
  const ra = await collectSource(deps(), a.id, 'MANUAL');
  const rb = await collectSource(deps(), b.id, 'MANUAL');
  expect(ra.itemsNew + rb.itemsNew).toBe(2);
});

it('fonte fora do ar: falha registrada, backoff progressivo, nada gravado', async () => {
  const s = await source();
  mode = 'down';
  const r1 = await collectSource(deps(), s.id, 'SCHEDULE');
  expect(r1).toMatchObject({ status: 'FAILED', transient: true });
  const job = await prisma.newsCollectionJob.findUniqueOrThrow({ where: { id: r1.jobId! } });
  expect(job).toMatchObject({ status: 'FAILED', httpStatus: 503, errorMessage: expect.stringContaining('HTTP 503') });

  let src = await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } });
  expect(src.consecutiveFailures).toBe(1);
  expect(src.nextAttemptAt!.getTime() - src.lastAttemptAt!.getTime()).toBe(sourceBackoffMs(1));

  // Agendador respeita o backoff: não tenta antes da hora (e não cria job à toa).
  expect(await collectSource(deps(), s.id, 'SCHEDULE')).toMatchObject({ status: 'SKIPPED', jobId: null });
  // Reprocessamento manual ignora a espera; segunda falha aumenta o backoff.
  await collectSource(deps(), s.id, 'RETRY');
  src = await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } });
  expect(src.consecutiveFailures).toBe(2);
  expect(src.nextAttemptAt!.getTime() - src.lastAttemptAt!.getTime()).toBe(sourceBackoffMs(2));
  expect(await prisma.newsArticle.count({ where: { sourceId: s.id } })).toBe(0);

  // Fonte volta: sucesso zera as falhas.
  mode = 'ok';
  expect(await collectSource(deps(), s.id, 'RETRY')).toMatchObject({ status: 'SUCCEEDED' });
  expect((await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } })).consecutiveFailures).toBe(0);
});

it('429 com Retry-After maior que o backoff: espera o que a fonte pediu', async () => {
  const s = await source();
  mode = 'limited';
  await collectSource(deps(), s.id, 'SCHEDULE');
  const src = await prisma.newsSource.findUniqueOrThrow({ where: { id: s.id } });
  expect(src.nextAttemptAt!.getTime() - src.lastAttemptAt!.getTime()).toBe(7_200_000);
});

it('feed que responde 200 mas parou no tempo é sinalizado (caso real do g1)', async () => {
  const s = await source();
  mode = 'stale';
  const r = await collectSource(deps(), s.id, 'MANUAL');
  expect(r).toMatchObject({ status: 'SUCCEEDED', reason: 'feed parece parado: item mais recente em 2018-03-02' });
  expect((await prisma.newsCollectionJob.findUniqueOrThrow({ where: { id: r.jobId! } })).errorMessage).toContain('parado');
});

it('fonte desligada nunca é coletada', async () => {
  const s = await source(false);
  expect(await collectSource(deps(), s.id, 'MANUAL')).toMatchObject({ status: 'SKIPPED', reason: 'fonte desligada' });
  expect(await prisma.newsCollectionJob.count({ where: { sourceId: s.id } })).toBe(0);
});

it('backoff: 5, 15, 45 min… limitado a 6 h', () => {
  expect([1, 2, 3, 10].map((n) => sourceBackoffMs(n) / 60_000)).toEqual([5, 15, 45, 360]);
});
