import { Confidence, LocationPrecision, SourceReliability, Temporality } from '../types';

/**
 * Confiança = qualidade da evidência (independente da gravidade).
 * Critérios de docs/architecture/07-news-intelligence.md, 7.7 — cada motivo fica registrado.
 */
export interface ConfidenceInput {
  temporality: Temporality;
  precision: LocationPrecision;
  locationAmbiguous: boolean;
  /** Fontes do evento já reduzidas a independentes (cada grupo de republicação conta 1). */
  independentSources: Array<{ reliability: SourceReliability }>;
  contradiction: boolean;
}

export interface ConfidenceResult {
  level: Confidence;
  reasons: string[];
  officialSource: boolean;
  independentEstablished: number;
}

export function assessConfidence(input: ConfidenceInput): ConfidenceResult {
  const officialSource = input.independentSources.some((s) => s.reliability === 'OFFICIAL');
  const independentEstablished = input.independentSources.filter((s) => s.reliability === 'ESTABLISHED_PRESS').length;
  const base = { officialSource, independentEstablished };
  const low = (reason: string): ConfidenceResult => ({ level: 'LOW', reasons: [reason], ...base });

  if (input.temporality !== 'CURRENT') return low(`temporalidade ${input.temporality}: não confirma ocorrência atual`);
  if (input.precision === 'UNKNOWN') return low('localização não identificada');
  if (input.locationAmbiguous) return low('localização ambígua');
  if (input.contradiction) return low('fontes contraditórias');

  if (officialSource) return { level: 'HIGH', reasons: ['fonte oficial atual'], ...base };
  if (independentEstablished >= 2) {
    return { level: 'HIGH', reasons: [`${independentEstablished} veículos de imprensa independentes coerentes em local e tempo`], ...base };
  }
  if (independentEstablished === 1) {
    return { level: 'MEDIUM', reasons: ['um veículo de imprensa estabelecido, ainda sem confirmação independente'], ...base };
  }
  return low('somente fontes agregadoras ou desconhecidas');
}
