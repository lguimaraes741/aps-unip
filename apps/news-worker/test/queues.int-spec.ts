/**
 * Etapa 4: filas BullMQ do News Intelligence com Redis e PostgreSQL reais.
 */
import { NewsAnalyzeJob, NewsCollectJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { createServer, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { BuildResult, processArticle, TX_OPTIONS } from '../src/events/event-builder';
import { seedRegions } from '../src/geo/regions';
import { MaintenanceJob, NewsQueues, NewsWorkerCore, queueOptions, SCHEDULER_PREFIX } from '../src/news-worker';
import { titleFingerprint } from '../src/dedup/similarity';
import { canonicalizeUrl, urlHash } from '../src/text/url';

const prisma = new PrismaClient({ transactionOptions: TX_OPTIONS });
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const tag = `q${Date.now().toString(36)}`;
const silent = { log: () => undefined, warn: () => undefined };
let server: Server;
let base: string;

const rfc = (d: Date) => d.toUTCString();
const FEED = () => `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
  <item><title>Chuva alaga avenida e interdita via em Osasco</title><link>https://portal-q.example/${tag}/1</link><pubDate>${rfc(new Date(Date.now() - 3_600_000))}</pubDate></item>
  <item><title>Temporal deixa ruas alagadas em Osasco</title><link>https://portal-q.example/${tag}/2</link><pubDate>${rfc(new Date(Date.now() - 1_800_000))}</pubDate></item>
  <item><title>Prefeitura inaugura praça</title><link>https://portal-q.example/${tag}/3</link></item>
</channel></rss>`;

async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 20_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error('tempo esgotado esperando a condição');
    await new Promise((r) => setTimeout(r, 100));
  }
}

function makeQueues(connection: Redis, prefix: string, analyzeAttempts: number): NewsQueues {
  const q = {
    collect: new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, { connection, ...queueOptions(prefix, 1) }),
    // Backoff curto nos testes (o padrão é 10 s exponencial).
    analyze: new Queue<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, { connection, ...queueOptions(prefix, analyzeAttempts, 50) }),
    maintenance: new Queue<MaintenanceJob>(QueueName.NEWS_MAINTENANCE, { connection, ...queueOptions(prefix, 1) }),
  };
  return q;
}

function startWorkers(core: NewsWorkerCore, connection: Redis, prefix: string): Worker[] {
  return [
    new Worker<NewsCollectJob>(QueueName.NEWS_COLLECT, (j) => core.handleCollect(j), { connection, prefix, concurrency: 2 }),
    new Worker<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, (j) => core.handleAnalyze(j), { connection, prefix, concurrency: 4 }),
  ];
}

async function article(title: string, collectedAgoMs = 0) {
  const url = `https://portal-r.example/${tag}/${Math.random().toString(36).slice(2)}`;
  const canonical = canonicalizeUrl(url)!;
  const src = await prisma.newsSource.findFirstOrThrow({ where: { key: `${tag}-src` } });
  return prisma.newsArticle.create({
    data: {
      sourceId: src.id, title, url, canonicalUrl: canonical, urlHash: urlHash(canonical), titleFingerprint: titleFingerprint(title),
      publishedAt: new Date(Date.now() - 3_600_000), collectedAt: new Date(Date.now() - collectedAgoMs),
    },
  });
}

describe('filas do News Intelligence (Redis + PostgreSQL reais)', () => {
  const prefix = `${process.env.REDIS_PREFIX}-${tag}`;
  const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const queues = makeQueues(connection, prefix, 3);
  const core = new NewsWorkerCore({ prisma, queues, logger: silent, allowPrivateNetwork: true, httpTimeoutMs: 3_000 });
  let workers: Worker[] = [];
  let sourceId: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      if (req.url === '/down') return res.writeHead(503).end('fora do ar');
      if (req.url?.split('?')[0] === '/limited') return res.writeHead(429).end('Please limit requests to one every 5 seconds');
      res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8' }).end(FEED());
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    await prisma.newsEvent.deleteMany({});
    // Nenhuma outra fonte ligada no banco de testes deve ganhar agendador neste teste.
    await prisma.newsSource.updateMany({ where: { enabled: true }, data: { enabled: false } });
    await seedRegions(prisma);
    const src = await prisma.newsSource.create({
      data: {
        key: `${tag}-src`, name: 'Portal local', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: base, feedUrl: `${base}/feed`,
        enabled: true, termsCheckedAt: new Date(), minRequestIntervalMs: 1_000, collectionIntervalSec: 3_600,
      },
    });
    sourceId = src.id;
    workers = startWorkers(core, connection, prefix);
  });

  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close()));
    for (const q of Object.values(queues)) {
      await q.obliterate({ force: true });
      await q.close();
    }
    await prisma.newsEvent.deleteMany({});
    await prisma.newsSource.deleteMany({ where: { key: { startsWith: tag } } });
    await prisma.$disconnect();
    await connection.quit();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it('agendador: um job scheduler por fonte ligada, com o intervalo da fonte; fonte desligada perde o seu', async () => {
    const other = await prisma.newsSource.create({
      data: { key: `${tag}-other`, name: 'Outra', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: base, feedUrl: `${base}/down`, enabled: true, termsCheckedAt: new Date(), collectionIntervalSec: 900 },
    });
    expect(await core.syncSchedulers()).toEqual({ active: 2, removed: 0 });
    const byKey = new Map((await queues.collect.getJobSchedulers(0, -1)).map((s) => [s.key, s]));
    expect(byKey.get(`${SCHEDULER_PREFIX}${sourceId}`)?.every).toBe(3_600_000);
    expect(byKey.get(`${SCHEDULER_PREFIX}${other.id}`)?.every).toBe(900_000);

    await prisma.newsSource.update({ where: { id: other.id }, data: { enabled: false } });
    expect(await core.syncSchedulers()).toEqual({ active: 1, removed: 1 });
    expect((await queues.collect.getJobSchedulers(0, -1)).map((s) => s.key)).toEqual([`${SCHEDULER_PREFIX}${sourceId}`]);
    expect(await core.syncSchedulers()).toEqual({ active: 1, removed: 0 }); // idempotente
  });

  it('fluxo completo pelas filas: coleta → análise → evento', async () => {
    await core.requestCollection(sourceId);
    const event = await waitFor(async () => {
      const e = await prisma.newsEvent.findFirst({ where: { cityIbges: { has: '3534401' } }, include: { articles: true } });
      return e && e.articles.length === 2 ? e : null;
    });
    expect(event).toMatchObject({ city: 'Osasco', status: 'PUBLISHED_PRELIMINARY' });
    const arts = await prisma.newsArticle.findMany({ where: { canonicalUrl: { startsWith: `https://portal-q.example/${tag}` } } });
    expect(arts).toHaveLength(2); // o item fora do tema não foi guardado
    expect(arts.every((a) => a.processingStatus === 'ANALYZED')).toBe(true);
  });

  it('coleta agendada com falha não é repetida pela fila (o backoff fica na fonte); a manual é', async () => {
    const down = await prisma.newsSource.create({
      data: { key: `${tag}-down`, name: 'Fora do ar', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: base, feedUrl: `${base}/down`, enabled: true, termsCheckedAt: new Date() },
    });
    const job = (trigger: NewsCollectJob['trigger']) => ({ data: { sourceId: down.id, trigger }, attemptsMade: 0, opts: {} });
    await expect(core.handleCollect(job('SCHEDULE'))).resolves.toMatchObject({ status: 'FAILED', transient: true });
    await expect(core.handleCollect(job('MANUAL'))).rejects.toThrow(/temporária/);
    await prisma.newsSource.update({ where: { id: down.id }, data: { enabled: false } });
  });

  it('429 não é repetido pela fila nem em coleta manual (a fonte pediu para esperar)', async () => {
    const limited = await prisma.newsSource.create({
      data: { key: `${tag}-limited`, name: 'Limitada', type: 'GDELT', reliability: 'AGGREGATOR', baseUrl: base, feedUrl: `${base}/limited`, enabled: true, termsCheckedAt: new Date(), config: { query: 'alagamento' } },
    });
    await expect(core.handleCollect({ data: { sourceId: limited.id, trigger: 'MANUAL' }, attemptsMade: 0, opts: {} })).resolves.toMatchObject({ status: 'FAILED', rateLimited: true });
    await prisma.newsSource.update({ where: { id: limited.id }, data: { enabled: false } });
  });

  it('mesmo artigo enfileirado duas vezes (jobId = id) é processado uma vez', async () => {
    const a = await article('Alagamento interdita avenida em Barueri');
    const first = await queues.analyze.add('analyze', { articleId: a.id }, { jobId: a.id });
    const second = await queues.analyze.add('analyze', { articleId: a.id }, { jobId: a.id });
    expect(second.id).toBe(first.id);
    await waitFor(async () => (await prisma.newsArticle.findUniqueOrThrow({ where: { id: a.id } })).processingStatus === 'ANALYZED');
    expect(await prisma.newsEventArticle.count({ where: { articleId: a.id } })).toBe(1);
  });

  it('recuperação: artigo gravado sem job (processo caiu antes de enfileirar) é reenfileirado pela manutenção', async () => {
    const orphan = await article('Temporal deixa ruas alagadas em Jandira', 120_000);
    expect(await core.sweepOrphans()).toBeGreaterThanOrEqual(1);
    await waitFor(async () => (await prisma.newsArticle.findUniqueOrThrow({ where: { id: orphan.id } })).processingStatus === 'ANALYZED');
  });

  it('falha persistente na análise: N tentativas → FAILED com o erro; reprocessamento recupera', async () => {
    const failPrefix = `${prefix}-fail`;
    const failQueues = makeQueues(connection, failPrefix, 3);
    let calls = 0;
    const broken = new NewsWorkerCore({
      prisma, queues: failQueues, logger: silent,
      analyze: async () => {
        calls++;
        throw new Error('banco de regras indisponível (simulado)');
      },
    });
    const failWorkers = startWorkers(broken, connection, failPrefix);
    try {
      const a = await article('Alagamento interdita avenida em Cotia');
      await failQueues.analyze.add('analyze', { articleId: a.id }, { jobId: a.id });
      const failed = await waitFor(async () => {
        const x = await prisma.newsArticle.findUniqueOrThrow({ where: { id: a.id } });
        return x.processingStatus === 'FAILED' ? x : null;
      });
      expect(calls).toBe(3);
      expect(failed).toMatchObject({ attempts: 3, lastError: 'banco de regras indisponível (simulado)' });
      expect(await failQueues.analyze.getJobCounts('failed')).toEqual({ failed: 1 }); // retido para diagnóstico

      // Corrigido o problema: reprocessa pela fila normal (análise real).
      const fixed = new NewsWorkerCore({ prisma, queues, logger: silent });
      expect(await fixed.reprocessFailed()).toBeGreaterThanOrEqual(1);
      await waitFor(async () => (await prisma.newsArticle.findUniqueOrThrow({ where: { id: a.id } })).processingStatus === 'ANALYZED');
    } finally {
      await Promise.all(failWorkers.map((w) => w.close()));
      for (const q of Object.values(failQueues)) {
        await q.obliterate({ force: true });
        await q.close();
      }
    }
  });

  it('falha temporária na análise: a tentativa seguinte resolve e o artigo não fica FAILED', async () => {
    const flakyPrefix = `${prefix}-flaky`;
    const flakyQueues = makeQueues(connection, flakyPrefix, 3);
    let calls = 0;
    const flaky = new NewsWorkerCore({
      prisma, queues: flakyQueues, logger: silent,
      analyze: async (p, id): Promise<BuildResult> => {
        if (++calls === 1) throw new Error('timeout de transação (simulado)');
        return processArticle(p, id);
      },
    });
    const ws = startWorkers(flaky, connection, flakyPrefix);
    try {
      const a = await article('Alagamento interdita avenida em Itapevi');
      await flakyQueues.analyze.add('analyze', { articleId: a.id }, { jobId: a.id });
      const done = await waitFor(async () => {
        const x = await prisma.newsArticle.findUniqueOrThrow({ where: { id: a.id } });
        return x.processingStatus === 'ANALYZED' ? x : null;
      });
      expect(calls).toBe(2);
      expect(done.lastError).toBeNull();
    } finally {
      await Promise.all(ws.map((w) => w.close()));
      for (const q of Object.values(flakyQueues)) {
        await q.obliterate({ force: true });
        await q.close();
      }
    }
  });
});
