/**
 * `npm run news:reprocess-failed` — devolve à fila de análise os artigos que esgotaram as tentativas
 * (processing_status = FAILED). O news-worker precisa estar rodando para processá-los.
 */
import { NewsAnalyzeJob, NewsCollectJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from '../config';
import { MaintenanceJob, NewsWorkerCore, queueOptions } from '../news-worker';

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient();
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queues = {
    collect: new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, { connection, ...queueOptions(config.redisPrefix, 1) }),
    analyze: new Queue<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, { connection, ...queueOptions(config.redisPrefix, config.analyzeAttempts) }),
    maintenance: new Queue<MaintenanceJob>(QueueName.NEWS_MAINTENANCE, { connection, ...queueOptions(config.redisPrefix, 1) }),
  };
  try {
    const n = await new NewsWorkerCore({ prisma, queues, logger: { log: () => undefined, warn: () => undefined } }).reprocessFailed();
    console.log(`${n} artigo(s) devolvido(s) à fila de análise`);
  } finally {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    await connection.quit();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
