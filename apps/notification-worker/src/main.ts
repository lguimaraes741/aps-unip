import { OccurrenceEventJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Emitter } from '@socket.io/redis-emitter';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { loadConfig } from './config';
import { NotificationWorker, prismaTransactionOptions, PushDeliveryJob, pushQueueOptions } from './notification-worker';
import { FcmPushProvider } from './push/fcm-provider';
import { LogPushProvider } from './push/log-provider';
import { PushProvider } from './push/push-provider';

const logger = {
  log: (m: string) => console.log(`[worker] ${new Date().toISOString()} ${m}`),
  warn: (m: string) => console.warn(`[worker] ${new Date().toISOString()} AVISO ${m}`),
};

async function main(): Promise<void> {
  const config = loadConfig();
  const prisma = new PrismaClient({
    datasourceUrl: config.databaseUrl,
    transactionOptions: prismaTransactionOptions,
  });
  await prisma.$connect(); // abre o pool antes de consumir as filas

  // Consumidores do BullMQ exigem maxRetriesPerRequest = null (bloqueiam esperando jobs).
  const redisOptions = {
    maxRetriesPerRequest: null,
    retryStrategy: (times: number) => Math.min(200 * 2 ** times, 5000),
  };
  const connection = new Redis(config.redisUrl, { ...redisOptions, connectionName: 'alertacidade-worker' });
  const emitterClient = new Redis(config.redisUrl, { ...redisOptions, connectionName: 'alertacidade-worker:emitter' });
  let redisDown = false;
  connection.on('error', (e) => {
    // ECONNREFUSED do ioredis pode vir com message vazia; o código do erro diz o motivo.
    const reason = e.message || (e as NodeJS.ErrnoException).code || String(e);
    if (!redisDown) logger.warn(`Redis indisponível: ${reason} (reconectando…)`);
    redisDown = true;
  });
  connection.on('ready', () => {
    if (redisDown) logger.log('Redis reconectado; retomando o consumo das filas');
    redisDown = false;
  });
  emitterClient.on('error', () => undefined);

  const provider: PushProvider =
    config.pushProvider === 'fcm' ? new FcmPushProvider(config.firebaseCredentialsFile!) : new LogPushProvider((l) => logger.log(l));
  const emitter = new Emitter(emitterClient, { key: `${config.redisPrefix}#socket.io` });
  const pushQueue = new Queue<PushDeliveryJob>(QueueName.PUSH_DELIVERIES, { connection, ...pushQueueOptions(config.redisPrefix, config.pushAttempts) });
  const core = new NotificationWorker(prisma, pushQueue, provider, emitter, logger, config.pushAttempts);

  const eventsWorker = new Worker<OccurrenceEventJob>(
    QueueName.OCCURRENCE_EVENTS,
    async (job) => {
      const result = await core.processOccurrenceEvent(job.data);
      if (result.duplicate) logger.log(`evento ${job.data.eventId} já processado (ignorado)`);
      else if (result.notifications > 0) logger.log(`${job.data.type} ${job.data.aggregateId}: ${result.notifications} notificação(ões)`);
      return result;
    },
    { connection, prefix: config.redisPrefix, concurrency: config.concurrency },
  );
  const pushWorker = new Worker<PushDeliveryJob>(QueueName.PUSH_DELIVERIES, (job) => core.processPushDelivery(job), {
    connection,
    prefix: config.redisPrefix,
    concurrency: config.concurrency,
  });

  for (const w of [eventsWorker, pushWorker]) {
    w.on('failed', (job, error) => {
      const final = job && job.attemptsMade >= (job.opts.attempts ?? 1);
      logger.warn(`${w.name} job ${job?.id} falhou (tentativa ${job?.attemptsMade}${final ? ', desistindo' : ''}): ${error.message}`);
    });
    w.on('error', (error) => logger.warn(`${w.name}: ${error.message}`));
  }

  logger.log(`iniciado — push: ${provider.name}${provider.delivers ? '' : ' (desenvolvimento: nada é entregue)'}, concorrência ${config.concurrency}, prefixo "${config.redisPrefix}"`);

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.log(`${signal} recebido: terminando os jobs em andamento…`);
    // close() espera os jobs ativos; os pendentes ficam no Redis para o próximo worker.
    await Promise.all([eventsWorker.close(), pushWorker.close()]);
    await pushQueue.close();
    await prisma.$disconnect();
    connection.disconnect();
    emitterClient.disconnect();
    logger.log('encerrado');
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error(`[worker] falha ao iniciar: ${(error as Error).message}`);
  process.exit(1);
});
