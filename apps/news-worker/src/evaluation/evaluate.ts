import { assessArticle, ArticleAssessment } from '../pipeline/analyze-article';
import { CorpusCase } from './corpus';

const PUBLISHED = new Set(['PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED']);

export interface CaseResult {
  case: CorpusCase;
  assessment: ArticleAssessment;
  mismatches: string[];
}

export interface Metrics {
  total: number;
  fullyCorrect: number;
  relevanceAccuracy: number;
  temporalityAccuracy: number;
  severityAccuracy: number;
  statusAccuracy: number;
  /** Publicado sem dever ser publicado. */
  falseAlerts: number;
  /** Deveria ser publicado e não foi. */
  missedAlerts: number;
  /** Push indevido (o erro mais caro para o usuário). */
  wrongPush: number;
  meanMsPerArticle: number;
}

export function evaluateCase(c: CorpusCase, now: Date): CaseResult {
  const publishedAt = new Date(now.getTime() - c.hoursAgo * 3_600_000);
  const a = assessArticle({ title: c.title, summary: c.summary ?? null, publishedAt, reliability: c.reliability }, now);
  const e = c.expected;
  const m: string[] = [];
  const cmp = (label: string, expected: unknown, actual: unknown) => {
    if (expected !== undefined && JSON.stringify(expected) !== JSON.stringify(actual)) {
      m.push(`${label}: esperado ${JSON.stringify(expected)}, obtido ${JSON.stringify(actual)}`);
    }
  };
  cmp('relevante', e.relevant, a.rules.isRelevant);
  cmp('temporalidade', e.temporality, a.rules.temporality);
  cmp('gravidade', e.severity, a.rules.severity);
  cmp('precisão', e.precision, a.location.precision);
  cmp('cidades', e.cities, a.location.cities.map((x) => x.name));
  cmp('distritos', e.districts, a.location.districts.map((x) => x.name));
  cmp('status', e.status, a.decision.status);
  cmp('push', e.push, a.decision.pushAllowed);
  return { case: c, assessment: a, mismatches: m };
}

export function evaluate(corpus: CorpusCase[], now: Date): { results: CaseResult[]; metrics: Metrics } {
  const started = process.hrtime.bigint();
  const results = corpus.map((c) => evaluateCase(c, now));
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;

  const ratio = (pred: (r: CaseResult) => boolean | undefined, applies: (r: CaseResult) => boolean = () => true) => {
    const pool = results.filter(applies);
    return pool.length === 0 ? 1 : pool.filter((r) => pred(r)).length / pool.length;
  };
  const metrics: Metrics = {
    total: results.length,
    fullyCorrect: results.filter((r) => r.mismatches.length === 0).length,
    relevanceAccuracy: ratio((r) => r.case.expected.relevant === r.assessment.rules.isRelevant),
    temporalityAccuracy: ratio((r) => r.case.expected.temporality === r.assessment.rules.temporality, (r) => r.case.expected.temporality !== undefined),
    severityAccuracy: ratio((r) => r.case.expected.severity === r.assessment.rules.severity, (r) => r.case.expected.severity !== undefined),
    statusAccuracy: ratio((r) => r.case.expected.status === r.assessment.decision.status),
    falseAlerts: results.filter((r) => PUBLISHED.has(r.assessment.decision.status) && !PUBLISHED.has(r.case.expected.status)).length,
    missedAlerts: results.filter((r) => !PUBLISHED.has(r.assessment.decision.status) && PUBLISHED.has(r.case.expected.status)).length,
    wrongPush: results.filter((r) => r.assessment.decision.pushAllowed && r.case.expected.push === false).length,
    meanMsPerArticle: elapsedMs / results.length,
  };
  return { results, metrics };
}
