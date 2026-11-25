/**
 * Tipos do domínio News Intelligence (espelham os enums planejados para o banco —
 * docs/architecture/07-news-intelligence.md, seção 7.4).
 */

/** Versão das regras determinísticas. Mudou uma regra → mude a versão (as análises antigas ficam no banco). */
export const RULES_VERSION = 'rules-2';

export type Severity = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
export const SEVERITY_ORDER: readonly Severity[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];

export type Temporality = 'CURRENT' | 'FORECAST' | 'PREVENTION' | 'HISTORICAL' | 'RESOLVED' | 'UNCERTAIN';
export type EventType = 'FLOODING' | 'RIVER_OVERFLOW' | 'FLASH_FLOOD';
export type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
export type SourceReliability = 'OFFICIAL' | 'ESTABLISHED_PRESS' | 'AGGREGATOR' | 'UNKNOWN';
export type LocationPrecision = 'EXACT' | 'STREET' | 'NEIGHBORHOOD' | 'CITY' | 'REGION' | 'UNKNOWN';

export type EventStatus =
  | 'AWAITING_VALIDATION'
  | 'PUBLISHED_PRELIMINARY'
  | 'PUBLISHED_VERIFIED'
  | 'DISCARDED'
  | 'OUTDATED'
  | 'RESOLVED';

export type AlertLevel = 'PRELIMINARY' | 'VERIFIED' | 'OFFICIAL';

/** Trecho literal do texto que sustenta uma conclusão (rastreabilidade). */
export interface Evidence {
  label: string;
  excerpt: string;
}

export interface ArticleText {
  title: string;
  summary: string | null;
  publishedAt: Date | null;
}
