import type { LocationPrecision, NewsConfidence, NewsEventStatus, NewsSourceReliability, OccurrenceStatus, Severity, UserRole } from '@alertacidade/shared-types';
import { api, ApiClient } from './client';

export type { LocationPrecision, NewsConfidence, NewsEventStatus, NewsSourceReliability, OccurrenceStatus, Severity, UserRole };

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status?: 'ACTIVE' | 'SUSPENDED' | 'DELETED';
  createdAt?: string;
  lastLoginAt?: string | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
}

export interface AdminOccurrence {
  id: string;
  code: number;
  title: string;
  address: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  severity: Severity;
  status: OccurrenceStatus;
  version: number;
  confirmCount: number;
  contestCount: number;
  isDemo: boolean;
  occurredAt: string;
  createdAt: string;
  author: { id: string; name: string };
  openReports: number;
  photoCount: number;
}

export interface ContentReportItem {
  id: string;
  reason: string;
  details: string | null;
  status: 'OPEN' | 'REVIEWED' | 'DISMISSED';
  createdAt: string;
  reporter: string;
}

export interface OccurrenceAnalysis extends Omit<AdminOccurrence, 'author' | 'openReports' | 'photoCount'> {
  description: string;
  moderationNote: string | null;
  validatedAt: string | null;
  resolvedAt: string | null;
  author: { id: string; name: string; role: UserRole; status: string; email?: string };
  moderatedBy: { id: string; name: string } | null;
  photos: { id: string; url: string; width: number; height: number }[];
  history: { fromStatus: OccurrenceStatus | null; toStatus: OccurrenceStatus; note: string | null; createdAt: string; actor: { name: string; role: UserRole } | null }[];
  reports: ContentReportItem[];
  allowedTransitions: OccurrenceStatus[];
}

export interface Dashboard {
  status: Record<OccurrenceStatus, number>;
  activeBySeverity: Record<Severity, number>;
  moderationQueue: number;
  openReports: number;
  last24h: number;
  previous24h: number;
  avgValidationMinutes30d: number | null;
  daily: { day: string; created: number; resolved: number }[];
  topNeighborhoods30d: { neighborhood: string; total: number }[];
  demo: number;
  generatedAt: string;
}

export interface Statistics {
  period: { from: string; to: string; timezone: string };
  total: number;
  demo: number;
  byStatus: Record<OccurrenceStatus, number>;
  bySeverity: Record<Severity, number>;
  resolutionRate: number | null;
  avgValidationMinutes: number | null;
  byNeighborhood: { neighborhood: string; total: number; critical: number; high: number; resolved: number }[];
  byDay: { day: string; total: number }[];
}

export interface AuditEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
  ipAddress: string | null;
  createdAt: string;
  actor: { id: string; name: string; role: UserRole } | null;
}

// ---------------------------------------------------------------------------
// Monitoramento de notícias (Fase 7)
// ---------------------------------------------------------------------------

export interface NewsMetrics {
  articles: { total: number; relevant: number; irrelevant: number; failed: number; pending: number };
  events: { total: number; published: number; awaitingModeration: number; discarded: number; urgent: number; byStatus: Partial<Record<NewsEventStatus, number>> };
  activeBySeverity: Partial<Record<Severity | 'NONE', number>>;
  sources: { total: number; enabled: number; failing: number };
  collectionFailures24h: number;
  lastSuccessfulCollectionAt: string | null;
}

export interface NewsEventItem {
  id: string;
  code: number;
  title: string;
  status: NewsEventStatus;
  estimatedSeverity: Severity | null;
  confidence: NewsConfidence;
  independentSources: number;
  urgentReview: boolean;
  locationPrecision: LocationPrecision;
  city: string | null;
  state: string | null;
  placeText: string | null;
  firstEvidenceAt: string;
  lastEvidenceAt: string;
  version: number;
  region: { kind: string; name: string; ibgeCode: string | null } | null;
  sourceCount: number;
  firstSource: string | null;
}

export interface NewsEvidence {
  label: string;
  excerpt: string;
  severity?: Severity;
  why?: string;
}

export interface NewsEventSource {
  articleId: string;
  title: string;
  url: string;
  summary: string | null;
  author: string | null;
  publishedAt: string | null;
  collectedAt: string;
  source: { id: string; key: string; name: string; reliability: NewsSourceReliability; type: string };
  isIndependent: boolean;
  derivedFromArticleId: string | null;
  linkedBy: 'AUTO' | 'MODERATOR';
  analysis: {
    rulesVersion: string;
    modelVersion: string;
    temporality: string | null;
    estimatedSeverity: Severity | null;
    confidence: NewsConfidence | null;
    locationPrecision: LocationPrecision;
    needsReview: boolean;
    reasoningSummary: string;
    severityEvidence: NewsEvidence[];
    discardedEvidence: NewsEvidence[];
    location: { ambiguities?: string[]; places?: string[] } | null;
    missing: string[];
  } | null;
}

export interface NewsEventDetail extends Omit<NewsEventItem, 'sourceCount' | 'firstSource' | 'region'> {
  statusLabel: string;
  allowedTransitions: NewsEventStatus[];
  decisionReasons: string[];
  moderationNote: string | null;
  rulesVersion: string;
  region: { id: string; kind: string; name: string; ibgeCode: string | null } | null;
  moderatedBy: { id: string; name: string } | null;
  sources: NewsEventSource[];
  audit: { action: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; createdAt: string; actor: { name: string; role: UserRole } | null }[];
}

export interface NewsRegionOption {
  ibgeCode: string;
  name: string;
  kind: 'CITY' | 'DISTRICT';
  city: string | null;
}

export interface CollectionJob {
  id: string;
  status: 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'SKIPPED';
  trigger: 'SCHEDULE' | 'MANUAL' | 'RETRY';
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  httpStatus: number | null;
  itemsFound: number;
  itemsNew: number;
  errorMessage: string | null;
  source?: { key: string; name: string };
}

export interface NewsSourceItem {
  id: string;
  key: string;
  name: string;
  type: 'RSS' | 'GDELT' | 'API';
  reliability: NewsSourceReliability;
  baseUrl: string;
  feedUrl: string;
  enabled: boolean;
  collectionIntervalSec: number;
  termsCheckedAt: string | null;
  termsNote: string | null;
  lastSuccessfulCollectionAt: string | null;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  articleCount: number;
  lastJob: CollectionJob | null;
}

export type NewsAction = 'approve' | 'reject' | 'resolve';

export interface AuthResponse {
  accessToken: string;
  refreshToken: string;
  user: AdminUser;
}

const qs = (params: Record<string, string | number | boolean | undefined | null | string[]>) => {
  const s = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    s.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  const text = s.toString();
  return text ? `?${text}` : '';
};

export function endpoints(client: ApiClient = api) {
  return {
    login: (email: string, password: string) => client.request<AuthResponse>('/auth/login', { method: 'POST', json: { email, password } }),
    logout: (refreshToken: string) => client.request<void>('/auth/logout', { method: 'POST', json: { refreshToken } }),
    dashboard: () => client.request<Dashboard>('/admin/dashboard'),
    occurrences: (p: { status?: OccurrenceStatus[]; severity?: Severity[]; q?: string; reported?: boolean; page?: number; limit?: number }) =>
      client.request<Paged<AdminOccurrence>>(`/admin/occurrences${qs({ ...p, reported: p.reported || undefined })}`),
    occurrence: (id: string) => client.request<OccurrenceAnalysis>(`/admin/occurrences/${id}`),
    changeStatus: (id: string, body: { status: OccurrenceStatus; expectedVersion: number; note?: string }) =>
      client.request<{ status: OccurrenceStatus; version: number }>(`/admin/occurrences/${id}/status`, { method: 'POST', json: body }),
    contentReports: (status: ContentReportItem['status'] = 'OPEN', page = 1) =>
      client.request<Paged<ContentReportItem & { occurrence: { id: string; code: number; title: string; status: OccurrenceStatus } }>>(
        `/admin/content-reports${qs({ status, page })}`,
      ),
    resolveReport: (id: string, status: 'REVIEWED' | 'DISMISSED') =>
      client.request<void>(`/admin/content-reports/${id}/resolve`, { method: 'POST', json: { status } }),
    statistics: (from: string, to: string) => client.request<Statistics>(`/admin/statistics${qs({ from, to })}`),
    exportCsv: (p: { from: string; to: string; status?: OccurrenceStatus[]; severity?: Severity[]; includeDemo?: boolean }) =>
      client.request<Response>(`/admin/exports/occurrences.csv${qs({ ...p })}`, { raw: true }),
    users: (p: { q?: string; role?: UserRole; page?: number }) => client.request<Paged<AdminUser>>(`/users${qs({ ...p, limit: 20 })}`),
    updateUser: (id: string, body: { role?: UserRole; status?: 'ACTIVE' | 'SUSPENDED' }) =>
      client.request<AdminUser>(`/admin/users/${id}`, { method: 'PATCH', json: body }),
    audit: (p: { entityType?: string; entityId?: string; action?: string; page?: number }) =>
      client.request<Paged<AuditEntry>>(`/admin/audit${qs({ ...p, limit: 25 })}`),
    newsMetrics: () => client.request<NewsMetrics>('/admin/news/metrics'),
    newsReview: (p: { status?: NewsEventStatus[]; severity?: (Severity | 'NONE')[]; confidence?: NewsConfidence[]; city?: string; urgent?: boolean; q?: string; page?: number; limit?: number }) =>
      client.request<Paged<NewsEventItem>>(`/admin/news/review${qs({ ...p, urgent: p.urgent || undefined })}`),
    newsEvent: (id: string) => client.request<NewsEventDetail>(`/admin/news/events/${id}`),
    newsDecision: (id: string, action: NewsAction, body: { expectedVersion: number; note?: string }) =>
      client.request<{ status: NewsEventStatus; version: number }>(`/admin/news/events/${id}/${action}`, { method: 'POST', json: body }),
    newsUpdate: (id: string, body: { expectedVersion: number; title?: string; severity?: Severity | 'NONE'; regionIbge?: string; note?: string }) =>
      client.request<{ version: number }>(`/admin/news/events/${id}`, { method: 'PATCH', json: body }),
    newsMerge: (id: string, body: { expectedVersion: number; intoEventId: string; note?: string }) =>
      client.request<{ mergedInto: string; movedSources: number; recomputeQueued: boolean }>(`/admin/news/events/${id}/merge`, { method: 'POST', json: body }),
    newsRegions: () => client.request<NewsRegionOption[]>('/admin/news/regions'),
    newsSources: () => client.request<NewsSourceItem[]>('/admin/news/sources'),
    newsUpdateSource: (id: string, enabled: boolean) => client.request<{ enabled: boolean }>(`/admin/news/sources/${id}`, { method: 'PATCH', json: { enabled } }),
    newsCollect: (sourceId?: string) => client.request<{ queued: { sourceId: string; key: string }[] }>('/admin/news/collect', { method: 'POST', json: sourceId ? { sourceId } : {} }),
    newsCollections: (p: { status?: CollectionJob['status']; page?: number }) => client.request<Paged<CollectionJob>>(`/admin/news/collections${qs({ ...p, limit: 20 })}`),
    health: () => client.request<{ status: string; environment: string; version: string; checks: Record<string, string>; timestamp: string }>('/health'),
  };
}

export const http = endpoints();
