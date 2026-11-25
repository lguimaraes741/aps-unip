import { ConflictException, Inject, Injectable, NotFoundException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { NEWS_EVENT_TRANSITIONS } from '@alertacidade/shared-types';
import { NewsEventStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { NEWS_COLLECT_QUEUE, NEWS_MAINTENANCE_QUEUE, NewsCollectQueue, NewsMaintenanceQueue } from '../redis/redis.module';
import { CollectionsQuery, MergeNewsEventDto, NewsDecisionDto, NewsReviewQuery, UpdateNewsEventDto } from './news-admin.dto';

export const STATUS_LABEL: Record<NewsEventStatus, string> = {
  AWAITING_VALIDATION: 'Aguardando validação',
  PUBLISHED_PRELIMINARY: 'Publicado (preliminar)',
  PUBLISHED_VERIFIED: 'Publicado (verificado)',
  DISCARDED: 'Descartado',
  OUTDATED: 'Desatualizado',
  RESOLVED: 'Resolvido',
};

const ACTIVE: NewsEventStatus[] = ['AWAITING_VALIDATION', 'PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED'];
const QUEUE_TIMEOUT_MS = 3_000;

const LIST_SELECT = {
  id: true,
  code: true,
  title: true,
  status: true,
  estimatedSeverity: true,
  confidence: true,
  independentSources: true,
  urgentReview: true,
  locationPrecision: true,
  city: true,
  state: true,
  placeText: true,
  firstEvidenceAt: true,
  lastEvidenceAt: true,
  version: true,
  updatedAt: true,
  region: { select: { kind: true, name: true, ibgeCode: true } },
  _count: { select: { articles: true } },
  articles: { take: 1, orderBy: { createdAt: 'asc' }, select: { article: { select: { source: { select: { name: true } } } } } },
} satisfies Prisma.NewsEventSelect;

/**
 * Moderação do News Intelligence (docs/architecture/07-news-intelligence.md, seção 10 do enunciado do módulo).
 * Mesmo padrão da moderação de ocorrências: controle otimista por versão e auditoria
 * (antes/depois, IP) na MESMA transação da alteração.
 *
 * Publicar para o público e notificar (news_alerts + outbox) é a etapa de notificações; aqui o
 * moderador decide o status, corrige gravidade/local, mescla duplicados e opera as fontes.
 */
@Injectable()
export class NewsAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(NEWS_COLLECT_QUEUE) private readonly collectQueue: NewsCollectQueue,
    @Inject(NEWS_MAINTENANCE_QUEUE) private readonly maintenanceQueue: NewsMaintenanceQueue,
  ) {}

  // ------------------------------------------------------------------ painel

  async metrics() {
    const since24h = new Date(Date.now() - 24 * 3600_000);
    const [articles, events, severities, sources, failures24h, lastJob, urgent] = await Promise.all([
      this.prisma.newsArticle.groupBy({ by: ['processingStatus'], _count: true }),
      this.prisma.newsEvent.groupBy({ by: ['status'], _count: true }),
      this.prisma.newsEvent.groupBy({ by: ['estimatedSeverity'], where: { status: { in: ACTIVE } }, _count: true }),
      this.prisma.newsSource.findMany({ select: { enabled: true, consecutiveFailures: true } }),
      this.prisma.newsCollectionJob.count({ where: { status: 'FAILED', startedAt: { gte: since24h } } }),
      this.prisma.newsCollectionJob.findFirst({ where: { status: 'SUCCEEDED' }, orderBy: { finishedAt: 'desc' }, select: { finishedAt: true } }),
      this.prisma.newsEvent.count({ where: { urgentReview: true, status: { in: ACTIVE } } }),
    ]);
    const byArticle = Object.fromEntries(articles.map((a) => [a.processingStatus, a._count]));
    const byEvent = Object.fromEntries(events.map((e) => [e.status, e._count]));
    const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);
    return {
      articles: { total: sum(byArticle), relevant: byArticle.ANALYZED ?? 0, irrelevant: byArticle.IRRELEVANT ?? 0, failed: byArticle.FAILED ?? 0, pending: byArticle.COLLECTED ?? 0 },
      events: {
        total: sum(byEvent),
        published: (byEvent.PUBLISHED_PRELIMINARY ?? 0) + (byEvent.PUBLISHED_VERIFIED ?? 0),
        awaitingModeration: byEvent.AWAITING_VALIDATION ?? 0,
        discarded: byEvent.DISCARDED ?? 0,
        urgent,
        byStatus: byEvent,
      },
      activeBySeverity: Object.fromEntries(severities.map((s) => [s.estimatedSeverity ?? 'NONE', s._count])),
      sources: { total: sources.length, enabled: sources.filter((s) => s.enabled).length, failing: sources.filter((s) => s.enabled && s.consecutiveFailures > 0).length },
      collectionFailures24h: failures24h,
      lastSuccessfulCollectionAt: lastJob?.finishedAt ?? null,
    };
  }

  async review(query: NewsReviewQuery) {
    const q = query.q?.trim();
    const code = q && /^n?-?\d{1,9}$/i.test(q) ? Number(q.replace(/\D/g, '')) : undefined;
    const severities = query.severity ?? [];
    const city = query.city?.trim();
    const where: Prisma.NewsEventWhereInput = {
      status: { in: query.status?.length ? query.status : ACTIVE },
      ...(severities.length && {
        OR: [
          ...(severities.some((s) => s !== 'NONE') ? [{ estimatedSeverity: { in: severities.filter((s) => s !== 'NONE') as Prisma.EnumSeverityFilter['in'] } }] : []),
          ...(severities.includes('NONE') ? [{ estimatedSeverity: null }] : []),
        ],
      }),
      ...(query.confidence?.length && { confidence: { in: query.confidence } }),
      ...(query.urgent && { urgentReview: true }),
      ...(city && (/^\d{7}$/.test(city) ? { cityIbges: { has: city } } : { city: { contains: city, mode: 'insensitive' as const } })),
      ...((query.from || query.to) && { lastEvidenceAt: { gte: query.from, lt: query.to } }),
      ...(q && { AND: [{ OR: [...(code !== undefined ? [{ code }] : []), { title: { contains: q, mode: 'insensitive' as const } }] }] }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.newsEvent.findMany({
        where,
        select: LIST_SELECT,
        // Fila de moderação: urgentes primeiro, depois os mais recentes.
        orderBy: [{ urgentReview: 'desc' }, { lastEvidenceAt: 'desc' }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.newsEvent.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, articles, ...e }) => ({ ...e, sourceCount: _count.articles, firstSource: articles[0]?.article.source.name ?? null })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Análise de um evento: fontes com as evidências literais, decisão automática e trilha de auditoria. */
  async detail(id: string) {
    const e = await this.prisma.newsEvent.findUnique({
      where: { id },
      include: {
        region: { select: { id: true, kind: true, name: true, ibgeCode: true } },
        moderatedBy: { select: { id: true, name: true } },
        relatedOccurrence: { select: { id: true, code: true, title: true, status: true } },
        articles: {
          orderBy: { createdAt: 'asc' },
          include: {
            article: {
              include: {
                source: { select: { id: true, key: true, name: true, reliability: true, type: true } },
                analyses: { orderBy: { analyzedAt: 'desc' }, take: 1 },
              },
            },
          },
        },
      },
    });
    if (!e) throw new NotFoundException('Evento de notícia não encontrado');
    const audit = await this.prisma.auditLog.findMany({
      where: { entityType: 'news_event', entityId: id },
      orderBy: { createdAt: 'asc' },
      include: { actor: { select: { name: true, role: true } } },
    });
    const { articles, ...rest } = e;
    return {
      ...rest,
      statusLabel: STATUS_LABEL[e.status],
      allowedTransitions: NEWS_EVENT_TRANSITIONS[e.status],
      sources: articles.map((l) => {
        const a = l.article;
        const an = a.analyses[0];
        const data = (an?.extractedData ?? {}) as Record<string, unknown>;
        return {
          articleId: a.id,
          title: a.title,
          url: a.url,
          summary: a.summary,
          author: a.author,
          publishedAt: a.publishedAt,
          collectedAt: a.collectedAt,
          source: a.source,
          isIndependent: l.isIndependent,
          derivedFromArticleId: l.derivedFromArticleId,
          linkedBy: l.linkedBy,
          analysis: an
            ? {
                rulesVersion: an.rulesVersion,
                modelVersion: an.modelVersion,
                temporality: an.temporality,
                estimatedSeverity: an.estimatedSeverity,
                confidence: an.confidence,
                locationPrecision: an.locationPrecision,
                needsReview: an.needsReview,
                reasoningSummary: an.reasoningSummary,
                severityEvidence: data.severityEvidence ?? [],
                discardedEvidence: data.discardedEvidence ?? [],
                location: data.location ?? null,
                missing: data.missing ?? [],
              }
            : null,
        };
      }),
      audit: audit.map((x) => ({ action: x.action, before: x.before, after: x.after, createdAt: x.createdAt, actor: x.actor })),
    };
  }

  // ------------------------------------------------------------------ decisões

  approve(actor: AuthUser, id: string, dto: NewsDecisionDto, ip?: string) {
    return this.transition(actor, id, dto, 'PUBLISHED_VERIFIED', 'news_event.approved', ip, (current) => {
      if (current.locationPrecision === 'UNKNOWN') {
        throw new UnprocessableEntityException('Corrija a localização antes de validar: um alerta sem local não pode ser publicado');
      }
    });
  }

  reject(actor: AuthUser, id: string, dto: NewsDecisionDto, ip?: string) {
    if (!dto.note?.trim()) throw new UnprocessableEntityException('Informe o motivo do descarte');
    return this.transition(actor, id, dto, 'DISCARDED', 'news_event.rejected', ip);
  }

  resolve(actor: AuthUser, id: string, dto: NewsDecisionDto, ip?: string) {
    return this.transition(actor, id, dto, 'RESOLVED', 'news_event.resolved', ip);
  }

  private async transition(
    actor: AuthUser,
    id: string,
    dto: NewsDecisionDto,
    to: NewsEventStatus,
    action: string,
    ip: string | undefined,
    check?: (current: { locationPrecision: string }) => void,
  ) {
    const note = dto.note?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVersion(tx, id, dto.expectedVersion);
      if (!(NEWS_EVENT_TRANSITIONS[current.status] as readonly NewsEventStatus[]).includes(to)) {
        throw new UnprocessableEntityException(`Não é possível mudar de "${STATUS_LABEL[current.status]}" para "${STATUS_LABEL[to]}"`);
      }
      check?.(current);
      await this.bump(tx, id, dto.expectedVersion, {
        status: to,
        moderatedById: actor.id,
        moderationNote: note,
        urgentReview: false,
        ...(to === 'RESOLVED' && { decisionReasons: { push: 'encerrado por moderador' } }),
      });
      const updated = await tx.newsEvent.findUniqueOrThrow({ where: { id } });
      await this.audit.log(tx, {
        actorId: actor.id,
        action,
        entityType: 'news_event',
        entityId: id,
        before: { status: current.status, version: current.version, moderationNote: current.moderationNote },
        after: { status: updated.status, version: updated.version, moderationNote: updated.moderationNote },
        ipAddress: ip,
      });
      return { id, status: updated.status, version: updated.version, allowedTransitions: NEWS_EVENT_TRANSITIONS[updated.status] };
    }).then(async (r) => ({ ...r, publicationQueued: await this.requestPublicationSync(id) }));
  }

  /** Corrige título, gravidade e/ou localização. O que o moderador corrigir não é sobrescrito pela automação. */
  async update(actor: AuthUser, id: string, dto: UpdateNewsEventDto, ip?: string) {
    if (dto.title === undefined && dto.severity === undefined && dto.regionIbge === undefined) {
      throw new UnprocessableEntityException('Nada para alterar');
    }
    return this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVersion(tx, id, dto.expectedVersion);
      const data: Prisma.NewsEventUpdateInput = { moderatedBy: { connect: { id: actor.id } } };
      if (dto.title !== undefined) data.title = dto.title.trim();
      if (dto.severity !== undefined) data.estimatedSeverity = dto.severity === 'NONE' ? null : dto.severity;
      if (dto.note !== undefined) data.moderationNote = dto.note.trim() || null;
      if (dto.regionIbge !== undefined) {
        const region = await tx.newsRegion.findUnique({ where: { ibgeCode: dto.regionIbge }, include: { parent: true } });
        if (!region || !['CITY', 'DISTRICT'].includes(region.kind) || !region.monitored) {
          throw new UnprocessableEntityException('Localidade fora das regiões monitoradas');
        }
        const isDistrict = region.kind === 'DISTRICT';
        Object.assign(data, {
          region: { connect: { id: region.id } },
          city: isDistrict ? region.parent?.name ?? null : region.name,
          state: region.state,
          locationPrecision: isDistrict ? 'NEIGHBORHOOD' : 'CITY',
          cityIbges: [isDistrict ? region.parent!.ibgeCode! : region.ibgeCode!],
          districtIbges: isDistrict ? [region.ibgeCode!] : [],
          // Ponto só com precisão de logradouro (CHECK no banco): ao corrigir para cidade/distrito, sai.
          latitude: null,
          longitude: null,
        });
      }
      const { count } = await tx.newsEvent.updateMany({ where: { id, version: dto.expectedVersion }, data: { version: { increment: 1 } } });
      if (count === 0) throw new ConflictException('Este evento acabou de ser alterado por outra pessoa. Recarregue e tente de novo.');
      const updated = await tx.newsEvent.update({ where: { id }, data, include: { region: { select: { name: true, kind: true } } } });
      await this.audit.log(tx, {
        actorId: actor.id,
        action: 'news_event.updated',
        entityType: 'news_event',
        entityId: id,
        before: { title: current.title, estimatedSeverity: current.estimatedSeverity, regionId: current.regionId, city: current.city, locationPrecision: current.locationPrecision, version: current.version },
        after: { title: updated.title, estimatedSeverity: updated.estimatedSeverity, regionId: updated.regionId, city: updated.city, locationPrecision: updated.locationPrecision, version: updated.version },
        ipAddress: ip,
      });
      return { id, version: updated.version, title: updated.title, estimatedSeverity: updated.estimatedSeverity, city: updated.city, region: updated.region, locationPrecision: updated.locationPrecision };
    }).then(async (r) => ({ ...r, publicationQueued: await this.requestPublicationSync(id) }));
  }

  /**
   * "Identificar duplicidade": as fontes deste evento passam para o outro, este é descartado
   * com a referência. O recálculo do destino (gravidade, confiança) é pedido ao news-worker
   * pela fila DEPOIS do commit — a regra de agrupamento vive num lugar só.
   */
  async merge(actor: AuthUser, id: string, dto: MergeNewsEventDto, ip?: string) {
    if (dto.intoEventId === id) throw new UnprocessableEntityException('Escolha outro evento como destino');
    const result = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockedVersion(tx, id, dto.expectedVersion);
      if (current.status === 'DISCARDED' || current.status === 'RESOLVED') throw new UnprocessableEntityException('Evento já encerrado');
      const target = await tx.newsEvent.findUnique({ where: { id: dto.intoEventId } });
      if (!target) throw new NotFoundException('Evento de destino não encontrado');
      if (target.status === 'DISCARDED' || target.status === 'RESOLVED') throw new UnprocessableEntityException('O evento de destino está encerrado');

      const moved = await tx.newsEventArticle.updateMany({ where: { eventId: id }, data: { eventId: target.id, linkedBy: 'MODERATOR' } });
      const note = `Duplicado de N-${target.code}${dto.note?.trim() ? `: ${dto.note.trim()}` : ''}`.slice(0, 500);
      await this.bump(tx, id, dto.expectedVersion, { status: 'DISCARDED', moderatedById: actor.id, moderationNote: note, urgentReview: false });
      await this.audit.log(tx, {
        actorId: actor.id,
        action: 'news_event.merged',
        entityType: 'news_event',
        entityId: id,
        before: { status: current.status, version: current.version },
        after: { status: 'DISCARDED', mergedInto: target.id, mergedIntoCode: target.code, movedSources: moved.count },
        ipAddress: ip,
      });
      await this.audit.log(tx, {
        actorId: actor.id,
        action: 'news_event.received_merge',
        entityType: 'news_event',
        entityId: target.id,
        before: null,
        after: { from: id, fromCode: current.code, movedSources: moved.count },
        ipAddress: ip,
      });
      return { id, status: 'DISCARDED' as const, mergedInto: target.id, movedSources: moved.count };
    });
    const recomputeQueued = await this.enqueue(() =>
      this.maintenanceQueue.add('recompute-event', { kind: 'recompute-event', eventId: result.mergedInto }, { jobId: `recompute:${result.mergedInto}:${Date.now()}` }),
    ).then(() => true, () => false);
    return { ...result, recomputeQueued };
  }

  /** Cidades e distritos monitorados — opções para o moderador corrigir a localização. */
  async regions() {
    const rows = await this.prisma.newsRegion.findMany({
      where: { monitored: true, kind: { in: ['CITY', 'DISTRICT'] } },
      select: { ibgeCode: true, name: true, kind: true, parent: { select: { name: true } } },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => ({ ibgeCode: r.ibgeCode, name: r.name, kind: r.kind, city: r.kind === 'DISTRICT' ? r.parent?.name ?? null : r.name }));
  }

  // ------------------------------------------------------------------ fontes

  async sources() {
    const rows = await this.prisma.newsSource.findMany({
      orderBy: { name: 'asc' },
      include: { collectionJobs: { take: 1, orderBy: { startedAt: 'desc' } }, _count: { select: { articles: true } } },
    });
    return rows.map(({ collectionJobs, _count, config, ...s }) => ({ ...s, config, articleCount: _count.articles, lastJob: collectionJobs[0] ?? null }));
  }

  async updateSource(actor: AuthUser, id: string, enabled: boolean, ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.newsSource.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Fonte não encontrada');
      if (enabled && !current.termsCheckedAt) {
        throw new UnprocessableEntityException('Confira os termos de uso da fonte antes de ligá-la');
      }
      const updated = await tx.newsSource.update({ where: { id }, data: { enabled, ...(enabled && { consecutiveFailures: 0, nextAttemptAt: null }) } });
      await this.audit.log(tx, {
        actorId: actor.id,
        action: enabled ? 'news_source.enabled' : 'news_source.disabled',
        entityType: 'news_source',
        entityId: id,
        before: { enabled: current.enabled },
        after: { enabled: updated.enabled },
        ipAddress: ip,
      });
      // O agendador do news-worker confere news_sources periodicamente e cria/remove o agendamento.
      return { id, enabled: updated.enabled };
    });
  }

  /** Coleta imediata (fila do news-worker). Deduplica: não empilha coletas da mesma fonte. */
  async requestCollection(actor: AuthUser, sourceId: string | undefined, ip?: string) {
    const sources = await this.prisma.newsSource.findMany({ where: { enabled: true, ...(sourceId && { id: sourceId }) }, select: { id: true, key: true } });
    if (sourceId && sources.length === 0) throw new UnprocessableEntityException('Fonte inexistente ou desligada');
    const jobs: { sourceId: string; key: string; jobId: string | undefined }[] = [];
    for (const s of sources) {
      const job = await this.enqueue(() =>
        this.collectQueue.add('collect', { sourceId: s.id, trigger: 'MANUAL', requestedById: actor.id }, { deduplication: { id: `manual:${s.id}` } }),
      );
      jobs.push({ sourceId: s.id, key: s.key, jobId: job.id });
    }
    await this.prisma.$transaction((tx) =>
      this.audit.log(tx, { actorId: actor.id, action: 'news_collection.requested', entityType: 'news_source', entityId: sourceId ?? null, before: null, after: { sources: jobs.map((j) => j.key) }, ipAddress: ip }),
    );
    return { queued: jobs };
  }

  async collections(query: CollectionsQuery) {
    const where: Prisma.NewsCollectionJobWhereInput = { ...(query.status && { status: query.status }), ...(query.sourceId && { sourceId: query.sourceId }) };
    const [items, total] = await Promise.all([
      this.prisma.newsCollectionJob.findMany({
        where,
        orderBy: { startedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { source: { select: { key: true, name: true } } },
      }),
      this.prisma.newsCollectionJob.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  // ------------------------------------------------------------------ apoio

  /**
   * Depois do commit da decisão, pede ao news-worker o recálculo do evento — que publica, atualiza
   * ou retira o alerta (news_alerts + outbox) numa transação dele. A decisão já está persistida;
   * se a fila estiver fora, a reconciliação periódica do worker aplica a publicação depois.
   */
  private async requestPublicationSync(eventId: string): Promise<boolean> {
    return this.enqueue(() =>
      this.maintenanceQueue.add('recompute-event', { kind: 'recompute-event', eventId }, { jobId: `recompute:${eventId}:${Date.now()}` }),
    ).then(
      () => true,
      () => false,
    );
  }

  private async lockedVersion(tx: Prisma.TransactionClient, id: string, expectedVersion: number) {
    const current = await tx.newsEvent.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Evento de notícia não encontrado');
    if (current.version !== expectedVersion) {
      throw new ConflictException(
        `Este evento foi alterado enquanto você analisava (agora está "${STATUS_LABEL[current.status]}"). Recarregue e tente de novo.`,
      );
    }
    return current;
  }

  private async bump(tx: Prisma.TransactionClient, id: string, expectedVersion: number, data: Prisma.NewsEventUncheckedUpdateManyInput) {
    const { count } = await tx.newsEvent.updateMany({ where: { id, version: expectedVersion }, data: { ...data, version: { increment: 1 } } });
    if (count === 0) throw new ConflictException('Este evento acabou de ser alterado por outra pessoa. Recarregue e tente de novo.');
  }

  /** Com o Redis fora, a fila não responde: falha rápido com 503 em vez de pendurar a requisição. */
  private async enqueue<T>(fn: () => Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), QUEUE_TIMEOUT_MS);
    });
    try {
      return await Promise.race([fn(), timeout]);
    } catch {
      throw new ServiceUnavailableException('Fila de coleta indisponível no momento. Tente de novo em instantes.');
    } finally {
      clearTimeout(timer!);
    }
  }
}
