import { NewsCollectionTrigger, PrismaClient } from '@prisma/client';
import { isFloodCandidate } from '../analysis/rules';
import { titleFingerprint } from '../dedup/similarity';
import { NewsSourceAdapter, SourceConfig } from '../sources/adapter';
import { adapterFor } from '../sources/adapters';
import { FetchError } from '../sources/http';
import { HostRateLimiter } from '../sources/rate-limit';
import { RawNewsItem } from '../sources/rss';
import { truncate } from '../text/normalize';
import { canonicalizeUrl, urlHash } from '../text/url';

export interface Logger {
  log(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
}

export interface CollectorDeps {
  prisma: PrismaClient;
  limiter: HostRateLimiter;
  logger: Logger;
  adapterFor?: (type: SourceConfig['type']) => NewsSourceAdapter;
  allowPrivateNetwork?: boolean;
  timeoutMs?: number;
  now?: () => Date;
}

export interface CollectionResult {
  jobId: string | null;
  status: 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  reason?: string;
  itemsFound: number;
  itemsNew: number;
  newArticleIds: string[];
  /** Falha temporária: a fila pode tentar de novo. */
  transient?: boolean;
  /** A fonte pediu para esperar (HTTP 429): ninguém deve insistir antes do backoff. */
  rateLimited?: boolean;
}

/** Feed cujo item mais novo é mais velho que isto provavelmente foi abandonado (caso real: g1 parado em 2018). */
export const STALE_FEED_DAYS = 7;

/** Backoff progressivo por fonte: 5, 15, 45 min… até 6 h. */
export function sourceBackoffMs(consecutiveFailures: number): number {
  return Math.min(5 * 60_000 * 3 ** Math.max(0, consecutiveFailures - 1), 6 * 3_600_000);
}

/** Validadores HTTP por fonte (requisição condicional). Memória do processo: perder só custa um download. */
const conditional = new Map<string, { etag: string | null; lastModified: string | null }>();

export interface NormalizedItem {
  externalId: string | null;
  title: string;
  url: string;
  canonicalUrl: string;
  urlHash: string;
  titleFingerprint: string;
  publishedAt: Date | null;
  summary: string | null;
  author: string | null;
}

/** Normaliza e filtra. Itens sem URL http(s) válida ou fora do tema são descartados. */
export function normalizeItems(items: RawNewsItem[]): { kept: NormalizedItem[]; invalid: number; offTopic: number } {
  const kept = new Map<string, NormalizedItem>();
  let invalid = 0;
  let offTopic = 0;
  for (const item of items) {
    const canonical = canonicalizeUrl(item.url);
    if (!canonical || item.title.trim().length < 3) {
      invalid++;
      continue;
    }
    if (!isFloodCandidate(item.title, item.summary)) {
      offTopic++;
      continue;
    }
    const hash = urlHash(canonical);
    if (kept.has(hash)) continue;
    kept.set(hash, {
      externalId: item.externalId ? truncate(item.externalId, 500) : null,
      title: truncate(item.title.trim(), 500),
      url: truncate(item.url.trim(), 2000),
      canonicalUrl: canonical,
      urlHash: hash,
      titleFingerprint: truncate(titleFingerprint(item.title), 500),
      publishedAt: item.publishedAt,
      summary: item.summary,
      author: item.author ? truncate(item.author, 200) : null,
    });
  }
  return { kept: [...kept.values()], invalid, offTopic };
}

/**
 * Coleta UMA fonte: registra o job, respeita o intervalo do host, grava só itens novos
 * (url_hash único → idempotente) e atualiza o backoff da fonte em caso de falha.
 * Nunca lança por falha da fonte: o resultado diz se vale tentar de novo.
 */
export async function collectSource(
  deps: CollectorDeps,
  sourceId: string,
  trigger: NewsCollectionTrigger,
  requestedById: string | null = null,
): Promise<CollectionResult> {
  const { prisma, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const source = await prisma.newsSource.findUnique({ where: { id: sourceId } });
  const empty = { itemsFound: 0, itemsNew: 0, newArticleIds: [] as string[] };
  if (!source) return { jobId: null, status: 'SKIPPED', reason: 'fonte inexistente', ...empty };
  if (!source.enabled) return { jobId: null, status: 'SKIPPED', reason: 'fonte desligada', ...empty };
  if (trigger === 'SCHEDULE' && source.nextAttemptAt && source.nextAttemptAt > now()) {
    return { jobId: null, status: 'SKIPPED', reason: `em espera até ${source.nextAttemptAt.toISOString()}`, ...empty };
  }

  const job = await prisma.newsCollectionJob.create({ data: { sourceId, trigger, requestedById, startedAt: now() } });
  const started = Date.now();
  const cfg: SourceConfig = {
    id: source.id,
    key: source.key,
    type: source.type,
    feedUrl: source.feedUrl,
    minRequestIntervalMs: source.minRequestIntervalMs,
    config: (source.config ?? {}) as Record<string, unknown>,
  };

  try {
    await deps.limiter.wait(cfg.feedUrl, cfg.minRequestIntervalMs);
    const adapter = (deps.adapterFor ?? adapterFor)(cfg.type);
    const validators = conditional.get(source.id);
    const out = await adapter.collect(cfg, {
      etag: validators?.etag ?? null,
      lastModified: validators?.lastModified ?? null,
      allowPrivateNetwork: deps.allowPrivateNetwork,
      timeoutMs: deps.timeoutMs,
    });
    conditional.set(source.id, { etag: out.etag, lastModified: out.lastModified });

    const { kept, invalid, offTopic } = normalizeItems(out.items);
    const created = kept.length
      ? await prisma.newsArticle.createManyAndReturn({
          data: kept.map((k) => ({ ...k, sourceId, collectionJobId: job.id, collectedAt: now() })),
          skipDuplicates: true, // url_hash e (source_id, external_id) únicos: recoleta não duplica
          select: { id: true },
        })
      : [];

    const finished = now();
    const newest = out.items.reduce<Date | null>((max, i) => (i.publishedAt && (!max || i.publishedAt > max) ? i.publishedAt : max), null);
    const stale = newest && finished.getTime() - newest.getTime() > STALE_FEED_DAYS * 86_400_000
      ? `feed parece parado: item mais recente em ${newest.toISOString().slice(0, 10)}`
      : null;
    if (stale) logger.warn('feed parado', { source: source.key, newest: newest!.toISOString() });
    await prisma.$transaction([
      prisma.newsCollectionJob.update({
        where: { id: job.id },
        data: { status: 'SUCCEEDED', finishedAt: finished, durationMs: Date.now() - started, httpStatus: out.httpStatus, itemsFound: out.items.length, itemsNew: created.length, errorMessage: stale },
      }),
      prisma.newsSource.update({
        where: { id: sourceId },
        data: {
          lastAttemptAt: finished,
          lastSuccessfulCollectionAt: finished,
          consecutiveFailures: 0,
          nextAttemptAt: new Date(finished.getTime() + source.collectionIntervalSec * 1000),
        },
      }),
    ]);
    logger.log('coleta concluída', { source: source.key, http: out.httpStatus, found: out.items.length, offTopic, invalid, new: created.length, ms: Date.now() - started });
    return { jobId: job.id, status: 'SUCCEEDED', reason: stale ?? undefined, itemsFound: out.items.length, itemsNew: created.length, newArticleIds: created.map((c) => c.id) };
  } catch (error) {
    const fe = error instanceof FetchError ? error : null;
    const message = (error as Error).message.slice(0, 500);
    const failures = source.consecutiveFailures + 1;
    const finished = now();
    const waitMs = Math.max(sourceBackoffMs(failures), fe?.retryAfterMs ?? 0);
    if (fe?.retryAfterMs) deps.limiter.defer(cfg.feedUrl, Date.now() + fe.retryAfterMs);
    await prisma.$transaction([
      prisma.newsCollectionJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', finishedAt: finished, durationMs: Date.now() - started, httpStatus: fe?.status ?? null, errorMessage: message },
      }),
      prisma.newsSource.update({
        where: { id: sourceId },
        data: { lastAttemptAt: finished, consecutiveFailures: failures, nextAttemptAt: new Date(finished.getTime() + waitMs) },
      }),
    ]);
    logger.warn('coleta falhou', { source: source.key, failures, transient: fe?.transient ?? true, nextInMin: Math.round(waitMs / 60_000), error: message });
    return { jobId: job.id, status: 'FAILED', reason: message, transient: fe?.transient ?? true, rateLimited: fe?.status === 429, ...empty };
  }
}

