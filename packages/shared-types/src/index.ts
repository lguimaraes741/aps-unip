/**
 * Contratos compartilhados do AlertaCidade.
 * Os valores dos enums DEVEM coincidir com os enums do schema Prisma
 * (verificado automaticamente em apps/api/test/contracts.spec.ts).
 * O app Flutter replica estes contratos em Dart (Fase 3).
 */

export const UserRole = { CITIZEN: 'CITIZEN', MODERATOR: 'MODERATOR', ADMIN: 'ADMIN' } as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const UserStatus = { ACTIVE: 'ACTIVE', SUSPENDED: 'SUSPENDED', DELETED: 'DELETED' } as const;
export type UserStatus = (typeof UserStatus)[keyof typeof UserStatus];

/** Gravidade informada pelo cidadão — independente do status. */
export const Severity = { LOW: 'LOW', MODERATE: 'MODERATE', HIGH: 'HIGH', CRITICAL: 'CRITICAL' } as const;
export type Severity = (typeof Severity)[keyof typeof Severity];
export const SEVERITY_ORDER: readonly Severity[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

/** Situação do registro no fluxo de moderação. */
export const OccurrenceStatus = {
  PENDING: 'PENDING',
  UNDER_REVIEW: 'UNDER_REVIEW',
  VALIDATED: 'VALIDATED',
  REJECTED: 'REJECTED',
  RESOLVED: 'RESOLVED',
} as const;
export type OccurrenceStatus = (typeof OccurrenceStatus)[keyof typeof OccurrenceStatus];

/** Transições permitidas (aplicadas pela API na moderação — Fase 5). */
export const STATUS_TRANSITIONS: Readonly<Record<OccurrenceStatus, readonly OccurrenceStatus[]>> = {
  PENDING: ['UNDER_REVIEW', 'VALIDATED', 'REJECTED'],
  UNDER_REVIEW: ['VALIDATED', 'REJECTED'],
  VALIDATED: ['RESOLVED'],
  REJECTED: [],
  RESOLVED: [],
};

export const ConfirmationType = { CONFIRM: 'CONFIRM', CONTEST: 'CONTEST' } as const;
export type ConfirmationType = (typeof ConfirmationType)[keyof typeof ConfirmationType];

export const NotificationType = {
  OCCURRENCE_NEARBY: 'OCCURRENCE_NEARBY',
  OCCURRENCE_STATUS_CHANGED: 'OCCURRENCE_STATUS_CHANGED',
  /** Alerta identificado em notícias (Fase 7). Não é comunicado oficial. */
  NEWS_ALERT: 'NEWS_ALERT',
  /** Alerta de notícia encerrado, corrigido ou desmentido — só para quem recebeu o original. */
  NEWS_ALERT_UPDATE: 'NEWS_ALERT_UPDATE',
  /** Só para MODERATOR/ADMIN: notícia urgente aguardando moderação (ex.: crítico de fonte única). */
  NEWS_REVIEW_URGENT: 'NEWS_REVIEW_URGENT',
} as const;
export type NotificationType = (typeof NotificationType)[keyof typeof NotificationType];

export const DeliveryStatus = { PENDING: 'PENDING', SENT: 'SENT', FAILED: 'FAILED', SKIPPED: 'SKIPPED' } as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

export const ReportStatus = { OPEN: 'OPEN', REVIEWED: 'REVIEWED', DISMISSED: 'DISMISSED' } as const;
export type ReportStatus = (typeof ReportStatus)[keyof typeof ReportStatus];

export const DevicePlatform = { ANDROID: 'ANDROID', IOS: 'IOS', WEB: 'WEB' } as const;
export type DevicePlatform = (typeof DevicePlatform)[keyof typeof DevicePlatform];

// ---------------------------------------------------------------------------
// Eventos de domínio / tempo real (WebSocket — Fase 4)
// ---------------------------------------------------------------------------

export const RealtimeEvent = {
  OCCURRENCE_CREATED: 'occurrence.created',
  OCCURRENCE_UPDATED: 'occurrence.updated',
  OCCURRENCE_VALIDATED: 'occurrence.validated',
  OCCURRENCE_REJECTED: 'occurrence.rejected',
  OCCURRENCE_RESOLVED: 'occurrence.resolved',
  /** Removida pelo autor (soft delete): o cliente deve tirá-la do mapa e das listas. */
  OCCURRENCE_REMOVED: 'occurrence.removed',
  /** Fase 7 — alerta de notícia publicado (preliminar, verificado ou oficial). */
  NEWS_ALERT_PUBLISHED: 'news.alert.published',
  /** Mudou gravidade, nível ou fontes de um alerta de notícia ativo. */
  NEWS_ALERT_UPDATED: 'news.alert.updated',
  /** Situação normalizada (fonte ou moderador). */
  NEWS_ALERT_RESOLVED: 'news.alert.resolved',
  /** Descartado/desmentido depois de publicado. */
  NEWS_ALERT_RETRACTED: 'news.alert.retracted',
  /** Sem notícia nova há mais de 6 h: sai do mapa como ativo. */
  NEWS_ALERT_EXPIRED: 'news.alert.expired',
  /**
   * SÓ EQUIPE: evento de notícia passou a exigir moderação urgente. Contém dados ainda NÃO
   * publicados — nunca vai para cidadãos (nem pelo Socket.IO nem pelo GET /sync).
   */
  NEWS_REVIEW_URGENT: 'news.review.urgent',
} as const;
export type RealtimeEvent = (typeof RealtimeEvent)[keyof typeof RealtimeEvent];

/** Perfis que recebem eventos "só equipe". */
export const STAFF_ROLES: readonly UserRole[] = ['MODERATOR', 'ADMIN'];

/** Eventos de moderação: entregues só às salas de MODERATOR/ADMIN e filtrados do /sync de cidadãos. */
export function isStaffOnlyEvent(type: string): boolean {
  return type.startsWith('news.review.');
}

/** Payload de `news.review.urgent` (outbox → painel e worker de notificações). */
export interface NewsReviewEventPayload {
  eventId: string;
  code: number;
  title: string;
  city: string | null;
  /** Null = gravidade não informada. */
  severity: Severity | null;
  status: NewsEventStatus;
  /** Motivos da decisão automática (ex.: "crítico sem corroboração"). */
  reasons: string[];
}

/** Nomes das mensagens trocadas pelo Socket.IO. */
export const SocketMessage = {
  /** Servidor → cliente: um EventEnvelope de domínio (todos os clientes autenticados). */
  EVENT: 'event',
  /** Servidor → cliente: nova notificação na caixa de alertas (somente a sala do usuário). */
  NOTIFICATION: 'notification',
} as const;

/**
 * Envelope de todo evento emitido.
 *
 * `sequence` é o CURSOR DE ENTREGA (`domain_events.published_sequence`), atribuído pelo
 * publicador na ordem em que publica — não a ordem de inserção. Assim, um evento cuja
 * transação confirmou depois de outro nunca recebe número menor que um já entregue, e o
 * cliente pode usar "último sequence visto" com segurança em `GET /sync?since=`.
 * Lacunas podem existir (publicação desfeita) e só disparam uma ressincronização.
 */
export interface EventEnvelope<TPayload = OccurrenceEventPayload> {
  eventId: string;
  sequence: string; // bigint serializado como string
  type: RealtimeEvent;
  occurredAt: string; // ISO-8601 UTC
  payload: TPayload;
}

/** Resposta de `GET /api/v1/sync?since=`. */
export interface SyncResponse {
  events: EventEnvelope[];
  /** Último sequence incluído (ou o atual, se não houver eventos novos). Usar como próximo `since`. */
  cursor: string;
  hasMore: boolean;
}

/** Job publicado na fila do BullMQ para o worker (jobId = eventId, garante dedup na fila). */
export interface OccurrenceEventJob {
  eventId: string;
  type: RealtimeEvent;
  aggregateId: string;
  occurredAt: string;
  payload: OccurrenceEventPayload;
}

export const QueueName = {
  OCCURRENCE_EVENTS: 'occurrence-events',
  PUSH_DELIVERIES: 'push-deliveries',
  /** News Intelligence (Fase 7): coleta de uma fonte. */
  NEWS_COLLECT: 'news-collect',
  /** News Intelligence: análise + agrupamento de um artigo (jobId = id do artigo). */
  NEWS_ANALYZE: 'news-analyze',
  /** News Intelligence: manutenção periódica (eventos desatualizados, artigos órfãos). */
  NEWS_MAINTENANCE: 'news-maintenance',
} as const;

export type NewsCollectTrigger = 'SCHEDULE' | 'MANUAL' | 'RETRY';

/** Job de coleta. A API enfileira MANUAL (painel); o agendador do news-worker, SCHEDULE. */
export interface NewsCollectJob {
  sourceId: string;
  trigger: NewsCollectTrigger;
  requestedById?: string | null;
}

export interface NewsAnalyzeJob {
  articleId: string;
}

/** Manutenção do News Intelligence. `recompute-event`: a API pede após mesclar eventos duplicados. */
export type NewsMaintenanceJob =
  | { kind: 'expire-events' }
  | { kind: 'sweep-orphans' }
  | { kind: 'recompute-event'; eventId: string };

/** Mensagem `notification` do Socket.IO e item da caixa de alertas. */
export interface NotificationItem {
  id: string;
  type: NotificationType;
  occurrenceId: string | null;
  /** Evento de notícia (alertas NEWS_ALERT*). */
  newsEventId?: string | null;
  title: string;
  body: string;
  distanceMeters: number | null;
  /** Estado ATUAL da ocorrência (pode ter mudado desde o alerta); null se ela foi removida. */
  occurrence: { code: number; severity: Severity; status: OccurrenceStatus } | null;
  readAt: string | null;
  createdAt: string;
}

export const NotificationFilter = { ALL: 'all', UNREAD: 'unread', CRITICAL: 'critical', NEARBY: 'nearby', RESOLVED: 'resolved' } as const;
export type NotificationFilter = (typeof NotificationFilter)[keyof typeof NotificationFilter];

export interface OccurrenceEventPayload {
  occurrenceId: string;
  code: number;
  severity: Severity;
  status: OccurrenceStatus;
  latitude: number;
  longitude: number;
  neighborhood: string | null;
  version: number;
}

// ---------------------------------------------------------------------------
// DTOs de leitura comuns (detalhados na Fase 2)
// ---------------------------------------------------------------------------

export interface OccurrenceSummary {
  id: string;
  code: number;
  title: string;
  address: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  severity: Severity;
  status: OccurrenceStatus;
  occurredAt: string;
  createdAt: string;
  confirmCount: number;
  contestCount: number;
  coverPhotoUrl: string | null;
  distanceMeters?: number;
  isDemo: boolean;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string | string[];
  requestId?: string;
}

// ---------------------------------------------------------------------------
// News Intelligence (Fase 7) — valores iguais aos enums do banco (contracts.spec.ts)
// ---------------------------------------------------------------------------

export const NewsEventStatus = {
  AWAITING_VALIDATION: 'AWAITING_VALIDATION',
  PUBLISHED_PRELIMINARY: 'PUBLISHED_PRELIMINARY',
  PUBLISHED_VERIFIED: 'PUBLISHED_VERIFIED',
  DISCARDED: 'DISCARDED',
  OUTDATED: 'OUTDATED',
  RESOLVED: 'RESOLVED',
} as const;
export type NewsEventStatus = (typeof NewsEventStatus)[keyof typeof NewsEventStatus];

export const NewsConfidence = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH' } as const;
export type NewsConfidence = (typeof NewsConfidence)[keyof typeof NewsConfidence];

export const LocationPrecision = {
  EXACT: 'EXACT',
  STREET: 'STREET',
  NEIGHBORHOOD: 'NEIGHBORHOOD',
  CITY: 'CITY',
  REGION: 'REGION',
  UNKNOWN: 'UNKNOWN',
} as const;
export type LocationPrecision = (typeof LocationPrecision)[keyof typeof LocationPrecision];

export const NewsSourceReliability = { OFFICIAL: 'OFFICIAL', ESTABLISHED_PRESS: 'ESTABLISHED_PRESS', AGGREGATOR: 'AGGREGATOR', UNKNOWN: 'UNKNOWN' } as const;
export type NewsSourceReliability = (typeof NewsSourceReliability)[keyof typeof NewsSourceReliability];

/**
 * Ações do moderador sobre um evento de notícia. "Validar" leva a PUBLISHED_VERIFIED;
 * descartado e resolvido são finais (uma notícia nova abre outro evento).
 */
export const NEWS_EVENT_TRANSITIONS: Readonly<Record<NewsEventStatus, readonly NewsEventStatus[]>> = {
  AWAITING_VALIDATION: ['PUBLISHED_VERIFIED', 'DISCARDED', 'RESOLVED'],
  PUBLISHED_PRELIMINARY: ['PUBLISHED_VERIFIED', 'DISCARDED', 'RESOLVED'],
  PUBLISHED_VERIFIED: ['DISCARDED', 'RESOLVED'],
  OUTDATED: ['PUBLISHED_VERIFIED', 'DISCARDED', 'RESOLVED'],
  DISCARDED: [],
  RESOLVED: [],
};

export type NewsAlertLevel = 'PRELIMINARY' | 'VERIFIED' | 'OFFICIAL';
export type NewsAlertStatus = 'ACTIVE' | 'RETRACTED' | 'RESOLVED' | 'EXPIRED';

/**
 * Payload dos eventos `news.alert.*` (outbox → Socket.IO, /sync e worker de notificações).
 * `notify` já é a DECISÃO de push, gravada junto com o alerta: o worker só calcula quem recebe.
 */
export interface NewsAlertEventPayload {
  alertId: string;
  eventId: string;
  code: number;
  title: string;
  status: NewsAlertStatus;
  level: NewsAlertLevel;
  /** Null = gravidade não informada pela fonte. */
  severity: Severity | null;
  city: string | null;
  regionId: string | null;
  regionName: string | null;
  locationPrecision: LocationPrecision;
  latitude: number | null;
  longitude: number | null;
  /** Consequência principal relatada (ex.: "via interditada"), para o texto da notificação. */
  headline: string | null;
  revision: number;
  notify: boolean;
  /** Por que mudou: new · escalated · upgraded · sources · resolved · retracted · expired. */
  change: 'new' | 'escalated' | 'upgraded' | 'sources' | 'resolved' | 'retracted' | 'expired';
}
