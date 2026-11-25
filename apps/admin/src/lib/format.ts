import type { LocationPrecision, NewsConfidence, NewsEventStatus, NewsSourceReliability, OccurrenceStatus, Severity, UserRole } from '@alertacidade/shared-types';

export const SEVERITY_LABEL: Record<Severity, string> = { LOW: 'Baixa', MODERATE: 'Moderada', HIGH: 'Alta', CRITICAL: 'Crítica' };
export const SEVERITIES: Severity[] = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  VALIDATED: 'Validada',
  REJECTED: 'Rejeitada',
  RESOLVED: 'Resolvida',
};
export const STATUSES: OccurrenceStatus[] = ['PENDING', 'UNDER_REVIEW', 'VALIDATED', 'RESOLVED', 'REJECTED'];

/** Verbo do botão de moderação para cada status de destino. */
export const ACTION_LABEL: Record<OccurrenceStatus, string> = {
  PENDING: 'Voltar para pendente',
  UNDER_REVIEW: 'Colocar em análise',
  VALIDATED: 'Validar',
  REJECTED: 'Rejeitar',
  RESOLVED: 'Marcar como resolvida',
};

export const ROLE_LABEL: Record<UserRole, string> = { CITIZEN: 'Cidadão', MODERATOR: 'Moderador', ADMIN: 'Administrador' };

export const REPORT_REASON_LABEL: Record<string, string> = {
  SPAM: 'Spam',
  OFFENSIVE: 'Conteúdo ofensivo',
  FALSE_INFORMATION: 'Informação falsa',
  PERSONAL_DATA: 'Dados pessoais expostos',
  OTHER: 'Outro motivo',
};

// --- Monitoramento de notícias ---
export const NEWS_STATUS_LABEL: Record<NewsEventStatus, string> = {
  AWAITING_VALIDATION: 'Aguardando validação',
  PUBLISHED_PRELIMINARY: 'Publicado (preliminar)',
  PUBLISHED_VERIFIED: 'Publicado (verificado)',
  DISCARDED: 'Descartado',
  OUTDATED: 'Desatualizado',
  RESOLVED: 'Resolvido',
};
export const NEWS_STATUSES: NewsEventStatus[] = ['AWAITING_VALIDATION', 'PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED', 'OUTDATED', 'RESOLVED', 'DISCARDED'];
export const NEWS_ACTION_LABEL: Partial<Record<NewsEventStatus, string>> = { PUBLISHED_VERIFIED: 'Validar', DISCARDED: 'Descartar', RESOLVED: 'Encerrar alerta' };
export const CONFIDENCE_LABEL: Record<NewsConfidence, string> = { LOW: 'Baixa', MEDIUM: 'Média', HIGH: 'Alta' };
export const PRECISION_LABEL: Record<LocationPrecision, string> = {
  EXACT: 'Ponto exato',
  STREET: 'Logradouro',
  NEIGHBORHOOD: 'Distrito/bairro',
  CITY: 'Cidade',
  REGION: 'Região',
  UNKNOWN: 'Não identificada',
};
export const RELIABILITY_LABEL: Record<NewsSourceReliability, string> = {
  OFFICIAL: 'Fonte oficial',
  ESTABLISHED_PRESS: 'Imprensa',
  AGGREGATOR: 'Agregador',
  UNKNOWN: 'Desconhecida',
};
export const TEMPORALITY_LABEL: Record<string, string> = {
  CURRENT: 'Ocorrência atual',
  FORECAST: 'Previsão',
  PREVENTION: 'Prevenção',
  HISTORICAL: 'Histórico',
  RESOLVED: 'Normalização',
  UNCERTAIN: 'Incerta',
};

export const ACTION_TEXT: Record<string, string> = {
  'news_event.approved': 'Evento de notícia validado',
  'news_event.rejected': 'Evento de notícia descartado',
  'news_event.resolved': 'Alerta de notícia encerrado',
  'news_event.updated': 'Evento de notícia corrigido',
  'news_event.merged': 'Evento marcado como duplicado',
  'news_event.received_merge': 'Fontes de duplicado recebidas',
  'news_source.enabled': 'Fonte de notícias ligada',
  'news_source.disabled': 'Fonte de notícias desligada',
  'news_collection.requested': 'Coleta de notícias solicitada',
  'occurrence.status_changed': 'Status de ocorrência alterado',
  'occurrence.removed': 'Ocorrência removida pelo autor',
  'content_report.resolved': 'Denúncia encerrada',
  'user.registered': 'Cadastro de usuário',
  'user.updated_by_admin': 'Usuário alterado pela administração',
  'user.password_changed': 'Senha alterada',
  'user.password_reset': 'Senha redefinida',
  'user.deleted_self': 'Conta excluída pelo titular (LGPD)',
};

const dateTimeFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
const dayFmt = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const numberFmt = new Intl.NumberFormat('pt-BR');

export const formatDateTime = (iso: string | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '—');
/** "2026-11-23" (dia já no fuso da cidade, vindo da API) → "23/11". */
export const formatDay = (day: string) => dayFmt.format(new Date(`${day}T00:00:00Z`));
export const formatNumber = (n: number) => numberFmt.format(n);

export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/** Variação percentual só quando há base para comparar (evita "+∞%"). */
export function variation(current: number, previous: number): string | null {
  if (previous === 0) return null;
  const pct = Math.round(((current - previous) / previous) * 100);
  return `${pct > 0 ? '+' : ''}${pct}% em relação às 24 h anteriores`;
}

/** Data local (yyyy-mm-dd) para campos <input type="date">. */
export const toDateInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
