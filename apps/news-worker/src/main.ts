import { NewsAnalyzeJob, NewsCollectJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from './config';
import { TX_OPTIONS } from './events/event-builder';
import { MaintenanceJob, NewsWorkerCore, queueOptions } from './news-worker';

/** Logs estruturados (uma linha JSON por evento) — fáceis de filtrar e de agregar. */
const logger = {
  log: (msg: string, fields?: Record<string, unknown>) => console.log(JSON.stringify({ t: new Date().toISOString(), svc: 'news-worker', level: 'info', msg, ...fields })),
  warn: (msg: string, fields?: Record<string, unknown>) => console.warn(JSON.stringify({ t: new Date().toISOString(), svc: 'news-worker', level: 'warn', msg, ...fields })),
};

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({ datasourceUrl: config.databaseUrl, transactionOptions: TX_OPTIONS });
  await prisma.$connect();

  const redisOptions = { maxRetriesPerRequest: null, retryStrategy: (times: number) => Math.min(200 * 2 ** times, 5000) };
  const connection = new Redis(config.redisUrl, { ...redisOptions, connectionName: 'alertacidade-news-worker' });
  let redisDown = false;
  connection.on('error', (e) => {
    if (!redisDown) logger.warn('Redis indisponível, reconectando', { reason: e.message || (e as NodeJS.ErrnoException).code });
    redisDown = true;
  });
  connection.on('ready', () => {
    if (redisDown) logger.log('Redis reconectado');
    redisDown = false;
  });

  const queues = {
    collect: new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, { connection, ...queueOptions(config.redisPrefix, 1) }),
    analyze: new Queue<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, { connection, ...queueOptions(config.redisPrefix, config.analyzeAttempts) }),
    maintenance: new Queue<MaintenanceJob>(QueueName.NEWS_MAINTENANCE, { connection, ...queueOptions(config.redisPrefix, 1) }),
  };
  // Sem ouvinte, cada fila imprime no console cada tentativa de reconexão (visto ao derrubar o Redis).
  for (const q of Object.values(queues)) {
    q.on('error', (error) => {
      if (!redisDown) logger.warn('erro na fila', { queue: q.name, error: error.message || (error as NodeJS.ErrnoException).code });
    });
  }
  const core = new NewsWorkerCore({ prisma, queues, logger, httpTimeoutMs: config.httpTimeoutMs });

  const common = { connection, prefix: config.redisPrefix };
  const workers = [
    new Worker<NewsCollectJob>(QueueName.NEWS_COLLECT, (job) => core.handleCollect(job), { ...common, concurrency: config.collectConcurrency }),
    new Worker<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, (job) => core.handleAnalyze(job), { ...common, concurrency: config.analyzeConcurrency }),
    new Worker<MaintenanceJob>(QueueName.NEWS_MAINTENANCE, (job) => core.handleMaintenance(job), { ...common, concurrency: 1 }),
  ];
  for (const w of workers) {
    w.on('failed', (job, error) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn('job falhou', { queue: w.name, job: job?.id, attempt: job?.attemptsMade, final, error: error.message });
    });
    // Com o Redis fora, cada worker emite um erro por tentativa de reconexão: já avisamos uma vez
    // ("Redis indisponível") e a volta é registrada ("Redis reconectado").
    w.on('error', (error) => {
      if (!redisDown) logger.warn('erro no worker', { queue: w.name, error: error.message || (error as NodeJS.ErrnoException).code });
    });
  }

  await core.syncSchedulers();
  await core.scheduleMaintenance(config.maintenanceEveryMs);
  await core.sweepOrphans(0);
  await core.handleMaintenance({ data: { kind: 'sweep-orphans' } }).catch((e) => logger.warn('reconciliação inicial falhou', { error: (e as Error).message }));
  const syncTimer = setInterval(() => {
    core.syncSchedulers().catch((e) => logger.warn('falha ao sincronizar agendadores', { error: (e as Error).message }));
  }, config.schedulerSyncMs);
  const metricsTimer = setInterval(() => {
    core.queueCounts().then((counts) => logger.log('filas', counts)).catch(() => undefined);
  }, 60_000);

  logger.log('iniciado', { prefix: config.redisPrefix, collect: config.collectConcurrency, analyze: config.analyzeConcurrency, analyzeAttempts: config.analyzeAttempts });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.log('encerrando: terminando jobs em andamento', { signal });
    clearInterval(syncTimer);
    clearInterval(metricsTimer);
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    await connection.quit().catch(() => connection.disconnect());
    logger.log('encerrado');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(JSON.stringify({ svc: 'news-worker', level: 'error', msg: 'falha ao iniciar', error: (error as Error).message }));
  process.exit(1);
});
