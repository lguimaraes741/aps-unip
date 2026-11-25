import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NewsCollectJob, NewsMaintenanceJob, OccurrenceEventJob, QueueName } from '@alertacidade/shared-types';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

/** Cliente de uso geral (health check) e par pub/sub do adaptador Socket.IO. */
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_PUB = Symbol('REDIS_PUB');
export const REDIS_SUB = Symbol('REDIS_SUB');
export const QUEUE_CONNECTION = Symbol('QUEUE_CONNECTION');
export const OCCURRENCE_EVENTS_QUEUE = Symbol('OCCURRENCE_EVENTS_QUEUE');

export type OccurrenceEventsQueue = Queue<OccurrenceEventJob>;
/** Filas do news-worker (Fase 7): a API só PRODUZ jobs (coleta manual pelo painel, recálculo após mesclar). */
export const NEWS_COLLECT_QUEUE = Symbol('NEWS_COLLECT_QUEUE');
export const NEWS_MAINTENANCE_QUEUE = Symbol('NEWS_MAINTENANCE_QUEUE');
export type NewsCollectQueue = Queue<NewsCollectJob>;
export type NewsMaintenanceQueue = Queue<NewsMaintenanceJob>;

const logger = new Logger('Redis');

/**
 * Encerra sem rejeitar comandos em andamento: QUIT espera a fila de comandos terminar.
 * Se o Redis estiver fora (ou demorar), corta a conexão.
 */
export async function closeRedis(client: Redis): Promise<void> {
  if (client.status !== 'ready') return void client.disconnect();
  await Promise.race([client.quit().catch(() => undefined), new Promise((r) => setTimeout(r, 1000).unref())]);
  // (o status muda durante o await; o TypeScript não percebe isso)
  if ((client.status as string) !== 'end') client.disconnect();
}

function createClient(config: ConfigService, name: string, extra: Record<string, unknown> = {}): Redis {
  const client = new Redis(config.getOrThrow<string>('REDIS_URL'), {
    connectionName: `alertacidade-api:${name}`,
    // Reconexão com backoff exponencial limitado a 5 s: a API continua atendendo REST com o Redis fora.
    retryStrategy: (times) => Math.min(200 * 2 ** times, 5000),
    ...extra,
  });
  let down = false;
  client.on('error', (error) => {
    const reason = error.message || (error as NodeJS.ErrnoException).code || String(error);
    if (!down) logger.warn(`Redis (${name}) indisponível: ${reason}`);
    down = true;
  });
  client.on('ready', () => {
    if (down) logger.log(`Redis (${name}) reconectado`);
    down = false;
  });
  return client;
}

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      // Falha rápido (sem fila offline): o health check precisa saber na hora se o Redis caiu.
      useFactory: (config: ConfigService) => createClient(config, 'main', { enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
    },
    { provide: REDIS_PUB, inject: [ConfigService], useFactory: (config: ConfigService) => createClient(config, 'pub') },
    { provide: REDIS_SUB, inject: [ConfigService], useFactory: (config: ConfigService) => createClient(config, 'sub') },
    {
      provide: QUEUE_CONNECTION,
      inject: [ConfigService],
      // Produtor: sem fila offline, para que o publicador do outbox perceba a falha
      // e mantenha o evento pendente no banco (em vez de "publicar" só na memória).
      useFactory: (config: ConfigService) => createClient(config, 'queue', { enableOfflineQueue: false, maxRetriesPerRequest: 1 }),
    },
    {
      provide: OCCURRENCE_EVENTS_QUEUE,
      inject: [ConfigService, QUEUE_CONNECTION],
      useFactory: (config: ConfigService, connection: Redis): OccurrenceEventsQueue => {
        return new Queue<OccurrenceEventJob>(QueueName.OCCURRENCE_EVENTS, {
          connection,
          prefix: config.getOrThrow<string>('REDIS_PREFIX'),
          defaultJobOptions: {
            attempts: 8,
            backoff: { type: 'exponential', delay: 2000 },
            // Mantém jobs concluídos por 7 dias: um evento republicado com o mesmo jobId é ignorado.
            removeOnComplete: { age: 7 * 24 * 3600 },
            removeOnFail: { age: 30 * 24 * 3600 },
          },
        });
      },
    },
    {
      provide: NEWS_COLLECT_QUEUE,
      inject: [ConfigService, QUEUE_CONNECTION],
      useFactory: (config: ConfigService, connection: Redis): NewsCollectQueue =>
        new Queue<NewsCollectJob>(QueueName.NEWS_COLLECT, {
          connection,
          prefix: config.getOrThrow<string>('REDIS_PREFIX'),
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 10_000 }, removeOnComplete: { age: 2 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } },
        }),
    },
    {
      provide: NEWS_MAINTENANCE_QUEUE,
      inject: [ConfigService, QUEUE_CONNECTION],
      useFactory: (config: ConfigService, connection: Redis): NewsMaintenanceQueue =>
        new Queue<NewsMaintenanceJob>(QueueName.NEWS_MAINTENANCE, {
          connection,
          prefix: config.getOrThrow<string>('REDIS_PREFIX'),
          defaultJobOptions: { attempts: 3, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: { age: 2 * 24 * 3600 }, removeOnFail: { age: 30 * 24 * 3600 } },
        }),
    },
  ],
  exports: [REDIS_CLIENT, REDIS_PUB, REDIS_SUB, QUEUE_CONNECTION, OCCURRENCE_EVENTS_QUEUE, NEWS_COLLECT_QUEUE, NEWS_MAINTENANCE_QUEUE],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(QUEUE_CONNECTION) private readonly queueConnection: Redis,
    @Inject(OCCURRENCE_EVENTS_QUEUE) private readonly queue: OccurrenceEventsQueue,
    @Inject(NEWS_COLLECT_QUEUE) private readonly newsCollect: NewsCollectQueue,
    @Inject(NEWS_MAINTENANCE_QUEUE) private readonly newsMaintenance: NewsMaintenanceQueue,
  ) {}

  async onApplicationShutdown(): Promise<void> {
    // Fecha a fila primeiro (com limite de 1 s, caso o Redis esteja fora) e só então desconecta:
    // desconectar antes deixava comandos em andamento rejeitados ("Connection is closed").
    // A conexão da fila foi criada aqui (compartilhada), então o BullMQ não a encerra sozinho.
    const queues = [this.queue, this.newsCollect, this.newsMaintenance];
    await Promise.race([Promise.all(queues.map((q) => q.close().catch(() => undefined))), new Promise((r) => setTimeout(r, 1000).unref())]);
    await Promise.all([closeRedis(this.client), closeRedis(this.queueConnection)]);
    // pub/sub do Socket.IO: fechados pelo RedisIoAdapter.dispose(), que o Nest chama DEPOIS
    // de encerrar o servidor de WebSocket (os ganchos de shutdown dos módulos rodam antes).
  }
}
