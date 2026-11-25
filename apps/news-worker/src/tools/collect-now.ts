/**
 * `npm run news:collect-now -- <chave da fonte | all>` — pede coleta imediata pela FILA
 * (o news-worker precisa estar rodando). Usa a mesma configuração do worker (prefixo do Redis).
 */
import { NewsAnalyzeJob, NewsCollectJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from '../config';
import { MaintenanceJob, NewsWorkerCore, queueOptions } from '../news-worker';

async function main(): Promise<void> {
  const target = process.argv[2];
  if (!target) throw new Error('Informe a chave da fonte ou "all".');
  const config = loadConfig();
  const prisma = new PrismaClient();
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const queues = {
    collect: new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, { connection, ...queueOptions(config.redisPrefix, 1) }),
    analyze: new Queue<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, { connection, ...queueOptions(config.redisPrefix, config.analyzeAttempts) }),
    maintenance: new Queue<MaintenanceJob>(QueueName.NEWS_MAINTENANCE, { connection, ...queueOptions(config.redisPrefix, 1) }),
  };
  try {
    const core = new NewsWorkerCore({ prisma, queues, logger: { log: () => undefined, warn: () => undefined } });
    const sources = await prisma.newsSource.findMany({ where: target === 'all' ? { enabled: true } : { key: target } });
    if (sources.length === 0) throw new Error(`Fonte não encontrada: ${target}`);
    for (const s of sources) console.log(`${s.key}: job ${await core.requestCollection(s.id)} (prefixo "${config.redisPrefix}")`);
  } finally {
    await Promise.all(Object.values(queues).map((q) => q.close()));
    await prisma.$disconnect();
    await connection.quit();
  }
}

main().catch((e) => {
  console.error((e as Error).message);
  process.exit(1);
});
