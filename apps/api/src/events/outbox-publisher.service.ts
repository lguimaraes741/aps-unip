import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEnvelope, OccurrenceEventJob, OccurrenceEventPayload, RealtimeEvent } from '@alertacidade/shared-types';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { OCCURRENCE_EVENTS_QUEUE, OccurrenceEventsQueue } from '../redis/redis.module';

/** Chave do advisory lock: só uma instância da API publica por vez (as outras ficam de reserva). */
const PUBLISHER_LOCK_KEY = 74_640_001;
const BATCH_SIZE = 100;
const QUEUE_TIMEOUT_MS = 5_000;
const MAX_BACKOFF_MS = 10_000;

interface PendingRow {
  id: string;
  type: string;
  aggregate_id: string;
  payload: OccurrenceEventPayload;
  occurred_at: Date;
}

interface PublishedEvent extends PendingRow {
  published_sequence: bigint;
}

export function toEnvelope(e: { id: string; type: string; payload: unknown; occurred_at: Date; published_sequence: bigint }): EventEnvelope {
  return {
    eventId: e.id,
    sequence: e.published_sequence.toString(),
    type: e.type as RealtimeEvent,
    occurredAt: e.occurred_at.toISOString(),
    payload: e.payload as OccurrenceEventPayload,
  };
}

/**
 * Publicador do Transactional Outbox.
 *
 * Em uma transação, sob advisory lock: lê os eventos pendentes em ordem de inserção,
 * enfileira cada um no BullMQ (jobId = id do evento → idempotente) e atribui o cursor de
 * entrega `published_sequence`. Só DEPOIS do commit emite pelo Socket.IO — assim um cliente
 * nunca recebe um sequence que `GET /sync` ainda não conhece.
 *
 * Se o Redis estiver fora, o enfileiramento falha, a transação é desfeita e os eventos
 * continuam pendentes no banco: nada se perde, apenas atrasa (entrega "pelo menos uma vez").
 */
@Injectable()
export class OutboxPublisherService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisherService.name);
  private readonly pollMs: number;
  private timer?: NodeJS.Timeout;
  private running?: Promise<void>;
  private stopped = false;
  private failures = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly gateway: RealtimeGateway,
    @Inject(OCCURRENCE_EVENTS_QUEUE) private readonly queue: OccurrenceEventsQueue,
    config: ConfigService,
  ) {
    this.pollMs = config.getOrThrow<number>('OUTBOX_POLL_MS');
  }

  onApplicationBootstrap(): void {
    this.schedule(0);
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running;
  }

  /** Executa um ciclo agora (usado pelos testes). Retorna quantos eventos foram publicados. */
  async publishPending(): Promise<number> {
    const published = await this.publishBatch();
    for (const event of published) this.gateway.broadcastEvent(toEnvelope(event));
    return published.length;
  }

  private schedule(delayMs: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.running = this.tick().finally(() => (this.running = undefined));
    }, delayMs);
    this.timer.unref();
  }

  private async tick(): Promise<void> {
    let next = this.pollMs;
    try {
      const count = await this.publishPending();
      if (this.failures > 0) this.logger.log('Publicação do outbox normalizada');
      this.failures = 0;
      if (count === BATCH_SIZE) next = 0; // ainda há fila: continua sem esperar
    } catch (error) {
      this.failures += 1;
      next = Math.min(this.pollMs * 2 ** this.failures, MAX_BACKOFF_MS);
      if (this.failures === 1 || this.failures % 10 === 0) {
        this.logger.warn(`Falha ao publicar o outbox (tentativa ${this.failures}, nova em ${next} ms): ${(error as Error).message}`);
      }
    }
    this.schedule(next);
  }

  private async publishBatch(): Promise<PublishedEvent[]> {
    let firstPending: string | undefined;
    try {
      return await this.prisma.$transaction(
        async (tx) => {
          const [{ locked }] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(${PUBLISHER_LOCK_KEY}) AS locked`;
          if (!locked) return [];

          const pending = await tx.$queryRaw<PendingRow[]>`
            SELECT id, type, aggregate_id, payload, occurred_at
            FROM domain_events
            WHERE published_at IS NULL
            ORDER BY sequence
            LIMIT ${BATCH_SIZE}
            FOR UPDATE`;
          if (pending.length === 0) return [];
          firstPending = pending[0].id;

          await withTimeout(
            this.queue.addBulk(
              pending.map((e) => ({
                name: e.type,
                data: {
                  eventId: e.id,
                  type: e.type as RealtimeEvent,
                  aggregateId: e.aggregate_id,
                  occurredAt: e.occurred_at.toISOString(),
                  payload: e.payload,
                } satisfies OccurrenceEventJob,
                opts: { jobId: e.id },
              })),
            ),
            QUEUE_TIMEOUT_MS,
            'fila de eventos (Redis) não respondeu',
          );

          // Um UPDATE por evento, na ordem: nextval() segue exatamente a ordem de publicação.
          const published: PublishedEvent[] = [];
          for (const e of pending) {
            const [row] = await tx.$queryRaw<{ published_sequence: bigint }[]>`
              UPDATE domain_events
              SET published_at = now(),
                  published_sequence = nextval('domain_events_published_sequence_seq'),
                  attempts = attempts + 1,
                  last_error = NULL
              WHERE id = ${e.id}::uuid
              RETURNING published_sequence`;
            published.push({ ...e, published_sequence: row.published_sequence });
          }
          return published;
        },
        { timeout: QUEUE_TIMEOUT_MS * 3 },
      );
    } catch (error) {
      if (firstPending) await this.recordFailure(firstPending, error as Error);
      throw error;
    }
  }

  private async recordFailure(eventId: string, error: Error): Promise<void> {
    await this.prisma.domainEvent
      .update({
        where: { id: eventId },
        data: { attempts: { increment: 1 }, lastError: error.message.slice(0, 500) },
      })
      .catch(() => undefined); // banco também indisponível: o próximo ciclo tenta de novo
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
