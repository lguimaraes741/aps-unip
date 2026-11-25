import { NewsAnalyzeJob, NewsCollectJob, NewsMaintenanceJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Job, Queue } from 'bullmq';
import { collectSource, CollectionResult, Logger } from './collector/collector';
import { BuildResult, expireStaleEvents, processArticle, recompute, reconcilePublications, TX_OPTIONS } from './events/event-builder';
import { HostRateLimiter } from './sources/rate-limit';

/**
 * Orquestração do News Intelligence sobre BullMQ (docs/architecture/07-news-intelligence.md, 7.2):
 *
 *   agendador (1 job scheduler por fonte) → fila news-collect → coletor
 *     → fila news-analyze (jobId = id do artigo) → análise + agrupamento em evento
 *   fila news-maintenance: eventos desatualizados e artigos órfãos (recuperação)
 *
 * Coleta e análise são filas separadas: uma fonte fora do ar não atrasa a análise, e uma análise
 * com erro pode ser repetida sem baixar o feed de novo.
 *
 * Falhas:
 *  - coleta AGENDADA que falha não é repetida pelo BullMQ — o backoff fica na fonte (next_attempt_at),
 *    e o próximo disparo do agendador respeita essa espera;
 *  - coleta MANUAL/RETRY com falha temporária é repetida pelo BullMQ (3 tentativas, exponencial);
 *  - análise: N tentativas com backoff; esgotou → artigo FAILED com o erro (fila de "mortos" =
 *    jobs falhos retidos no Redis por 30 dias + status no banco). `reprocessFailed()` reenfileira.
 */

export type MaintenanceJob = NewsMaintenanceJob;

export const SCHEDULER_PREFIX = 'collect:';
const DAY = 24 * 3600;

export function queueOptions(prefix: string, attempts: number, backoffDelayMs = 10_000) {
  return {
    prefix,
    defaultJobOptions: {
      attempts,
      backoff: { type: 'exponential' as const, delay: backoffDelayMs },
      removeOnComplete: { age: 2 * DAY, count: 5_000 },
      removeOnFail: { age: 30 * DAY },
    },
  };
}

export interface NewsQueues {
  collect: Queue<NewsCollectJob>;
  analyze: Queue<NewsAnalyzeJob>;
  maintenance: Queue<MaintenanceJob>;
}

export interface NewsWorkerDeps {
  prisma: PrismaClient;
  queues: NewsQueues;
  logger: Logger;
  limiter?: HostRateLimiter;
  httpTimeoutMs?: number;
  /** Somente testes: fontes num servidor HTTP local. */
  allowPrivateNetwork?: boolean;
  /** Injetável para testes de falha. */
  analyze?: (prisma: PrismaClient, articleId: string) => Promise<BuildResult>;
}

export class NewsWorkerCore {
  private readonly limiter: HostRateLimiter;

  constructor(private readonly deps: NewsWorkerDeps) {
    this.limiter = deps.limiter ?? new HostRateLimiter();
  }

  // ---------------------------------------------------------------- agendador

  /**
   * Um job scheduler por fonte LIGADA, com o intervalo da própria fonte. Fonte desligada ou
   * removida → scheduler removido. Idempotente: pode rodar em vários processos e a cada N minutos.
   */
  async syncSchedulers(): Promise<{ active: number; removed: number }> {
    const { prisma, queues, logger } = this.deps;
    const sources = await prisma.newsSource.findMany({ where: { enabled: true }, select: { id: true, key: true, collectionIntervalSec: true } });
    for (const s of sources) {
      await queues.collect.upsertJobScheduler(
        `${SCHEDULER_PREFIX}${s.id}`,
        { every: s.collectionIntervalSec * 1000 },
        { name: 'collect', data: { sourceId: s.id, trigger: 'SCHEDULE' }, opts: { attempts: 1 } },
      );
    }
    const wanted = new Set(sources.map((s) => `${SCHEDULER_PREFIX}${s.id}`));
    let removed = 0;
    for (const sch of await queues.collect.getJobSchedulers(0, -1)) {
      const id = sch.key ?? sch.id;
      if (id && id.startsWith(SCHEDULER_PREFIX) && !wanted.has(id)) {
        await queues.collect.removeJobScheduler(id);
        removed++;
      }
    }
    logger.log('agendadores sincronizados', { active: sources.length, removed });
    return { active: sources.length, removed };
  }

  /** Agendador da manutenção. */
  async scheduleMaintenance(everyMs: number): Promise<void> {
    await this.deps.queues.maintenance.upsertJobScheduler('expire-events', { every: everyMs }, { name: 'expire-events', data: { kind: 'expire-events' }, opts: { attempts: 1 } });
    await this.deps.queues.maintenance.upsertJobScheduler('sweep-orphans', { every: everyMs }, { name: 'sweep-orphans', data: { kind: 'sweep-orphans' }, opts: { attempts: 1 } });
  }

  // ---------------------------------------------------------------- handlers

  async handleCollect(job: Pick<Job<NewsCollectJob>, 'data' | 'attemptsMade' | 'opts'>): Promise<CollectionResult> {
    const { prisma, queues, logger } = this.deps;
    const { sourceId, trigger, requestedById } = job.data;
    const result = await collectSource(
      { prisma, limiter: this.limiter, logger, timeoutMs: this.deps.httpTimeoutMs, allowPrivateNetwork: this.deps.allowPrivateNetwork },
      sourceId,
      trigger,
      requestedById ?? null,
    );
    if (result.newArticleIds.length > 0) {
      // jobId = id do artigo: o mesmo artigo nunca fica duas vezes na fila.
      await queues.analyze.addBulk(result.newArticleIds.map((articleId) => ({ name: 'analyze', data: { articleId }, opts: { jobId: articleId } })));
    }
    // Só coletas pedidas por gente são repetidas pela fila; a agendada espera o backoff da fonte.
    // 429 nunca é repetido: a fonte pediu para esperar (caso real: GDELT na coleta manual).
    if (result.status === 'FAILED' && result.transient && !result.rateLimited && trigger !== 'SCHEDULE') {
      throw new Error(`coleta falhou (temporária): ${result.reason}`);
    }
    return result;
  }

  async handleAnalyze(job: Pick<Job<NewsAnalyzeJob>, 'data' | 'attemptsMade' | 'opts'>): Promise<BuildResult> {
    const { prisma } = this.deps;
    const run = this.deps.analyze ?? ((p: PrismaClient, id: string) => processArticle(p, id));
    try {
      return await run(prisma, job.data.articleId);
    } catch (error) {
      const message = (error as Error).message.slice(0, 500);
      const lastAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
      await prisma.newsArticle
        .update({
          where: { id: job.data.articleId },
          data: { attempts: { increment: 1 }, lastError: message, ...(lastAttempt ? { processingStatus: 'FAILED' as const } : {}) },
        })
        .catch(() => undefined); // banco fora: o BullMQ repete o job
      throw error;
    }
  }

  async handleMaintenance(job: Pick<Job<MaintenanceJob>, 'data'>): Promise<number> {
    const d = job.data;
    if (d.kind === 'expire-events') return this.expireEvents();
    if (d.kind === 'sweep-orphans') {
      const orphans = await this.sweepOrphans();
      const fixed = await reconcilePublications(this.deps.prisma);
      if (fixed > 0) this.deps.logger.log('publicações reconciliadas', { count: fixed });
      return orphans + fixed;
    }
    await this.deps.prisma.$transaction((tx) => recompute(tx, d.eventId), TX_OPTIONS);
    this.deps.logger.log('evento recalculado', { eventId: d.eventId });
    return 1;
  }

  async expireEvents(): Promise<number> {
    const n = await expireStaleEvents(this.deps.prisma);
    if (n > 0) this.deps.logger.log('eventos desatualizados', { count: n });
    return n;
  }

  /**
   * Recuperação: artigo gravado mas cujo job de análise se perdeu (processo caiu entre o INSERT e o
   * enfileiramento, Redis fora). Reenfileira com jobId = id do artigo — se o job ainda existe, nada muda.
   */
  async sweepOrphans(olderThanMs = 60_000): Promise<number> {
    const orphans = await this.deps.prisma.newsArticle.findMany({
      where: { processingStatus: 'COLLECTED', collectedAt: { lt: new Date(Date.now() - olderThanMs) } },
      select: { id: true },
      take: 500,
    });
    if (orphans.length === 0) return 0;
    await this.deps.queues.analyze.addBulk(orphans.map((a) => ({ name: 'analyze', data: { articleId: a.id }, opts: { jobId: a.id } })));
    this.deps.logger.log('artigos pendentes reenfileirados', { count: orphans.length });
    return orphans.length;
  }

  /** Reprocessa artigos que esgotaram as tentativas (FAILED) — ex.: depois de corrigir um bug. */
  async reprocessFailed(): Promise<number> {
    const failed = await this.deps.prisma.newsArticle.findMany({ where: { processingStatus: 'FAILED' }, select: { id: true } });
    if (failed.length === 0) return 0;
    await this.deps.prisma.newsArticle.updateMany({ where: { id: { in: failed.map((f) => f.id) } }, data: { processingStatus: 'COLLECTED', lastError: null } });
    // jobId novo: o job antigo continua na lista de falhos (histórico) e não bloqueia o novo.
    const stamp = Date.now();
    await this.deps.queues.analyze.addBulk(failed.map((a) => ({ name: 'analyze', data: { articleId: a.id }, opts: { jobId: `${a.id}:retry:${stamp}` } })));
    return failed.length;
  }

  /** Coleta imediata de uma fonte (o painel usará via API). Deduplica enquanto houver uma pendente. */
  async requestCollection(sourceId: string, requestedById: string | null = null): Promise<string | undefined> {
    const job = await this.deps.queues.collect.add(
      'collect',
      { sourceId, trigger: 'MANUAL', requestedById },
      { attempts: 3, deduplication: { id: `manual:${sourceId}` } },
    );
    return job.id;
  }

  async queueCounts(): Promise<Record<string, Record<string, number>>> {
    const { collect, analyze, maintenance } = this.deps.queues;
    const states = ['waiting', 'active', 'delayed', 'failed', 'completed'] as const;
    return {
      [QueueName.NEWS_COLLECT]: await collect.getJobCounts(...states),
      [QueueName.NEWS_ANALYZE]: await analyze.getJobCounts(...states),
      [QueueName.NEWS_MAINTENANCE]: await maintenance.getJobCounts(...states),
    };
  }
}
