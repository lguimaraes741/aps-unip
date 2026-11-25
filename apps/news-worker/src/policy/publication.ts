import { AlertLevel, Confidence, EventStatus, Severity, SEVERITY_ORDER, Temporality } from '../types';

/**
 * Política de publicação (docs/architecture/07-news-intelligence.md, 7.7).
 * Função pura: a decisão é PERSISTIDA (news_alerts + domain_events na mesma transação)
 * antes de qualquer notificação — este módulo só decide, não envia nada.
 */
export interface PublicationInput {
  temporality: Temporality;
  confidence: Confidence;
  severity: Severity | null;
  officialSource: boolean;
  independentEstablished: number;
  moderatorApproved: boolean;
}

export interface PublicationDecision {
  status: EventStatus;
  level: AlertLevel | null;
  /** Pode gerar push (as preferências de cada usuário ainda filtram). */
  pushAllowed: boolean;
  /** Vai para o topo da fila de moderação. */
  urgentReview: boolean;
  reasons: string[];
}

export function decidePublication(input: PublicationInput): PublicationDecision {
  const reasons: string[] = [];

  if (input.temporality === 'RESOLVED') {
    return { status: 'RESOLVED', level: null, pushAllowed: false, urgentReview: false, reasons: ['fonte indica normalização'] };
  }
  if (input.temporality === 'PREVENTION' || input.temporality === 'FORECAST' || input.temporality === 'HISTORICAL') {
    return { status: 'DISCARDED', level: null, pushAllowed: false, urgentReview: false, reasons: [`não é ocorrência ativa (${input.temporality})`] };
  }

  const critical = input.severity === 'CRITICAL';
  const criticalCorroborated = input.officialSource || input.independentEstablished >= 2 || input.moderatorApproved;

  if (input.confidence === 'LOW' && !input.moderatorApproved) {
    reasons.push('confiança baixa: aguarda moderação, não aparece como ocorrência ativa');
    if (critical) reasons.push('gravidade crítica relatada: revisão urgente');
    return { status: 'AWAITING_VALIDATION', level: null, pushAllowed: false, urgentReview: critical, reasons };
  }

  const level: AlertLevel = input.officialSource ? 'OFFICIAL' : input.confidence === 'HIGH' || input.moderatorApproved ? 'VERIFIED' : 'PRELIMINARY';
  const status: EventStatus = level === 'PRELIMINARY' ? 'PUBLISHED_PRELIMINARY' : 'PUBLISHED_VERIFIED';
  reasons.push(level === 'PRELIMINARY' ? 'publicação preliminar: notícia ainda sem confirmação independente' : `publicação ${level === 'OFFICIAL' ? 'com fonte oficial' : 'verificada'}`);

  let pushAllowed: boolean;
  let urgentReview = false;
  if (input.severity === null) {
    pushAllowed = false;
    reasons.push('sem push: impacto não informado pela fonte');
  } else if (critical && !criticalCorroborated) {
    pushAllowed = false;
    urgentReview = true;
    reasons.push('sem push crítico: falta fonte oficial, 2 fontes independentes ou aprovação de moderador');
  } else if (level === 'PRELIMINARY') {
    pushAllowed = input.severity === 'HIGH';
    reasons.push(pushAllowed ? 'push preliminar permitido (gravidade alta)' : 'sem push: preliminar com gravidade abaixo de alta');
  } else {
    pushAllowed = true;
  }

  return { status, level, pushAllowed, urgentReview, reasons };
}

export interface NotifiedState {
  severity: Severity | null;
  level: AlertLevel | null;
}

/**
 * "Não repetir alertas sem motivo relevante": um evento já notificado só notifica de novo
 * se a gravidade SUBIR ou o alerta deixar de ser preliminar.
 */
export function isRelevantChange(previous: NotifiedState | null, next: NotifiedState): boolean {
  if (!previous || previous.severity === null) return next.severity !== null;
  if (next.severity && SEVERITY_ORDER.indexOf(next.severity) > SEVERITY_ORDER.indexOf(previous.severity)) return true;
  return previous.level === 'PRELIMINARY' && (next.level === 'VERIFIED' || next.level === 'OFFICIAL');
}
