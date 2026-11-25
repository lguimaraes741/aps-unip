import { assessConfidence, ConfidenceResult } from '../analysis/confidence';
import { analyzeByRules, RuleAnalysis } from '../analysis/rules';
import { extractLocation, LocationExtraction } from '../geo/gazetteer';
import { decidePublication, PublicationDecision } from '../policy/publication';
import { ArticleText, SourceReliability } from '../types';

export interface ArticleInput extends ArticleText {
  reliability: SourceReliability;
  sourceCityIbge?: string;
}

export interface ArticleAssessment {
  rules: RuleAnalysis;
  location: LocationExtraction;
  confidence: ConfidenceResult | null;
  /** Decisão como se o artigo fosse a única fonte do evento (o agrupamento pode elevá-la depois). */
  decision: PublicationDecision;
}

/**
 * Avaliação de UM artigo isolado: regras → local → confiança → política.
 * O conteúdo é tratado como dado: nenhum texto do artigo altera o fluxo além dos padrões.
 */
export function assessArticle(article: ArticleInput, now: Date = new Date()): ArticleAssessment {
  const rules = analyzeByRules(article, now);
  const location = extractLocation(article.title, article.summary, { sourceCityIbge: article.sourceCityIbge });

  if (!rules.isRelevant) {
    return { rules, location, confidence: null, decision: discarded(rules.irrelevantReason ?? 'irrelevante') };
  }
  if (location.outOfScope) {
    return { rules, location, confidence: null, decision: discarded('fora das regiões monitoradas') };
  }

  const confidence = assessConfidence({
    temporality: rules.temporality,
    precision: location.precision,
    locationAmbiguous: location.ambiguities.length > 0,
    independentSources: [{ reliability: article.reliability }],
    contradiction: false,
  });
  const decision = decidePublication({
    temporality: rules.temporality,
    confidence: confidence.level,
    severity: rules.severity,
    officialSource: confidence.officialSource,
    independentEstablished: confidence.independentEstablished,
    moderatorApproved: false,
  });
  return { rules, location, confidence, decision };
}

function discarded(reason: string): PublicationDecision {
  return { status: 'DISCARDED', level: null, pushAllowed: false, urgentReview: false, reasons: [reason] };
}
