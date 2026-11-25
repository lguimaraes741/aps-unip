import { NewsReviewEventPayload, RealtimeEvent } from '@alertacidade/shared-types';
import { NewsEvent, Prisma, PrismaClient, Severity } from '@prisma/client';
import { assessConfidence } from '../analysis/confidence';
import { areIndependent, isSameEvent, SAME_EVENT_WINDOW_HOURS, titleSimilarity } from '../dedup/similarity';
import { METRO_NAME } from '../geo/regions';
import { ArticleAssessment, assessArticle } from '../pipeline/analyze-article';
import { decidePublication } from '../policy/publication';
import { syncPublication } from './publication';
import { truncate } from '../text/normalize';
import { LocationPrecision, RULES_VERSION, SEVERITY_ORDER, Temporality } from '../types';

/**
 * Etapas 4–7 do pipeline para UM artigo (docs/architecture/07-news-intelligence.md, 7.5):
 * análise → gravação da análise → agrupamento em evento → recálculo do evento.
 *
 * Tudo numa transação, sob advisory lock por cidade: dois workers processando matérias sobre o
 * mesmo alagamento ao mesmo tempo não criam dois eventos. Idempotente: artigo já ligado a um
 * evento não é processado de novo.
 *
 * NÃO publica nem notifica: a decisão fica gravada no evento (status, motivos, revisão urgente);
 * news_alerts + outbox são da etapa de publicação.
 */

export type BuildOutcome = 'IRRELEVANT' | 'CREATED' | 'LINKED' | 'RESOLVED' | 'NOTHING_TO_RESOLVE' | 'ALREADY_LINKED' | 'MISSING';

export interface BuildResult {
  articleId: string;
  outcome: BuildOutcome;
  eventId?: string;
  status?: NewsEvent['status'];
  reason?: string;
}

const MODEL_VERSION = 'none'; // sem modelo de linguagem (decisão do usuário: nada com custo)
const HOUR = 3_600_000;
export const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

export async function processArticle(prisma: PrismaClient, articleId: string, now: Date = new Date()): Promise<BuildResult> {
  return prisma.$transaction(async (tx) => {
    const article = await tx.newsArticle.findUnique({ where: { id: articleId }, include: { source: true, eventLink: true } });
    if (!article) return { articleId, outcome: 'MISSING' };
    if (article.eventLink) return { articleId, outcome: 'ALREADY_LINKED', eventId: article.eventLink.eventId };

    const a = assessArticle(
      {
        title: article.title,
        summary: article.summary,
        publishedAt: article.publishedAt,
        reliability: article.source.reliability,
        sourceCityIbge: article.source.defaultCityIbge ?? undefined,
      },
      now,
    );
    await saveAnalysis(tx, articleId, a);

    const t = a.rules.temporality;
    if (!a.rules.isRelevant || a.location.outOfScope || t === 'PREVENTION' || t === 'FORECAST' || t === 'HISTORICAL') {
      await tx.newsArticle.update({ where: { id: articleId }, data: { processingStatus: 'IRRELEVANT', attempts: { increment: 1 }, lastError: null } });
      return { articleId, outcome: 'IRRELEVANT', reason: a.decision.reasons[0] ?? t };
    }

    const key = {
      cityIbges: a.location.cities.map((c) => c.ibge),
      districtIbges: a.location.districts.map((d) => d.ibge),
      places: a.location.places,
      at: article.publishedAt ?? article.collectedAt,
    };

    // Serializa o agrupamento por cidade (ordem fixa evita deadlock entre cidades).
    for (const lockKey of (key.cityIbges.length ? [...key.cityIbges].sort() : ['sem-local']).map((c) => `news-event:${c}`)) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    }

    const match = key.cityIbges.length ? await findMatchingEvent(tx, key) : null;
    const done = async (outcome: BuildOutcome, eventId?: string, status?: NewsEvent['status']): Promise<BuildResult> => {
      await tx.newsArticle.update({ where: { id: articleId }, data: { processingStatus: 'ANALYZED', attempts: { increment: 1 }, lastError: null } });
      return { articleId, outcome, eventId, status };
    };

    if (t === 'RESOLVED') {
      if (!match) return done('NOTHING_TO_RESOLVE');
      await link(tx, match.id, article, true, null, null);
      await tx.newsEvent.update({
        where: { id: match.id },
        data: { status: 'RESOLVED', lastEvidenceAt: maxDate(match.lastEvidenceAt, key.at), decisionReasons: { push: `normalização relatada: ${article.title}`.slice(0, 300) }, version: { increment: 1 } },
      });
      await syncPublication(tx, match.id); // alerta encerrado + aviso a quem recebeu (mesma transação)
      return done('RESOLVED', match.id, 'RESOLVED');
    }

    if (match) {
      const existing = await tx.newsEventArticle.findMany({ where: { eventId: match.id }, include: { article: true } });
      let derived: { id: string; sim: number } | null = null;
      for (const e of existing) {
        if (!areIndependent(e.article, article).independent) {
          derived = { id: e.articleId, sim: titleSimilarity(e.article.title, article.title) };
          break;
        }
      }
      await link(tx, match.id, article, derived === null, derived?.id ?? null, derived?.sim ?? null);
      const updated = await recompute(tx, match.id);
      return done('LINKED', match.id, updated.status);
    }

    const event = await tx.newsEvent.create({
      data: {
        eventType: a.rules.eventType ?? 'FLOODING',
        title: truncate(article.title, 200),
        locationPrecision: a.location.precision,
        confidence: 'LOW', // recalculado logo abaixo
        rulesVersion: RULES_VERSION,
        firstEvidenceAt: key.at,
        lastEvidenceAt: key.at,
        cityIbges: key.cityIbges,
        districtIbges: key.districtIbges,
        places: key.places,
      },
    });
    await link(tx, event.id, article, true, null, null);
    const created = await recompute(tx, event.id);
    return done('CREATED', event.id, created.status);
  }, TX_OPTIONS);
}

type Tx = Prisma.TransactionClient;

async function saveAnalysis(tx: Tx, articleId: string, a: ArticleAssessment): Promise<void> {
  const extractedData = {
    location: {
      cities: a.location.cities,
      districts: a.location.districts.map((d) => ({ ibge: d.ibge, name: d.name })),
      places: a.location.places,
      metroRegion: a.location.metroRegion,
      outOfScope: a.location.outOfScope,
      ambiguities: a.location.ambiguities,
      evidence: a.location.evidence,
    },
    severityEvidence: a.rules.severityEvidence,
    discardedEvidence: a.rules.discardedEvidence,
    consequences: a.rules.consequences,
    alarmistLanguage: a.rules.alarmistLanguage,
    timeHints: a.rules.timeHints,
    missing: a.rules.missing,
    temporalityReasons: a.rules.temporalityReasons,
    singleSourceDecision: a.decision,
  } as unknown as Prisma.InputJsonValue;
  const reasoningSummary = truncate(
    [a.rules.irrelevantReason, ...a.rules.temporalityReasons, ...a.decision.reasons, ...a.location.ambiguities].filter(Boolean).join(' · ') || 'sem observações',
    1000,
  );
  const data = {
    isRelevant: a.rules.isRelevant,
    temporality: a.rules.isRelevant ? a.rules.temporality : null,
    eventType: a.rules.eventType,
    estimatedSeverity: a.rules.severity,
    confidence: a.confidence?.level ?? null,
    locationPrecision: a.location.precision,
    needsReview: a.rules.needsReview || a.location.ambiguities.length > 0,
    extractedData,
    reasoningSummary,
    analyzedAt: new Date(),
  };
  await tx.newsAnalysis.upsert({
    where: { articleId_rulesVersion_modelVersion: { articleId, rulesVersion: RULES_VERSION, modelVersion: MODEL_VERSION } },
    create: { articleId, rulesVersion: RULES_VERSION, modelVersion: MODEL_VERSION, ...data },
    update: data,
  });
}

async function findMatchingEvent(tx: Tx, key: { cityIbges: string[]; districtIbges: string[]; places: string[]; at: Date }): Promise<NewsEvent | null> {
  const windowMs = SAME_EVENT_WINDOW_HOURS * HOUR;
  const candidates = await tx.newsEvent.findMany({
    where: {
      cityIbges: { hasSome: key.cityIbges },
      status: { notIn: ['DISCARDED', 'RESOLVED'] },
      lastEvidenceAt: { gte: new Date(key.at.getTime() - windowMs) },
      firstEvidenceAt: { lte: new Date(key.at.getTime() + windowMs) },
    },
    orderBy: { lastEvidenceAt: 'desc' },
  });
  const matches = candidates.filter(
    (e) =>
      isSameEvent({ cityIbges: e.cityIbges, districtIbges: e.districtIbges, places: e.places, at: e.lastEvidenceAt }, key).same ||
      isSameEvent({ cityIbges: e.cityIbges, districtIbges: e.districtIbges, places: e.places, at: e.firstEvidenceAt }, key).same,
  );
  return pickMatch(matches, key.districtIbges);
}

/**
 * Escolha determinística entre eventos compatíveis (antes: o mais recente — arbitrário).
 *  - matéria COM distrito: evento do mesmo distrito; senão, evento só da cidade;
 *  - matéria SÓ com a cidade: evento só da cidade; senão, o evento de distrito apenas se for o ÚNICO
 *    candidato (com vários, não há como saber a qual se refere → abre evento próprio).
 */
export function pickMatch<T extends { districtIbges: string[] }>(matches: T[], districtIbges: string[]): T | null {
  const cityLevel = matches.filter((e) => e.districtIbges.length === 0);
  if (districtIbges.length > 0) {
    return matches.find((e) => e.districtIbges.some((d) => districtIbges.includes(d))) ?? cityLevel[0] ?? null;
  }
  return cityLevel[0] ?? (matches.length === 1 ? matches[0] : null);
}

async function link(tx: Tx, eventId: string, article: { id: string }, isIndependent: boolean, derivedFromArticleId: string | null, similarity: number | null) {
  await tx.newsEventArticle.create({
    data: { eventId, articleId: article.id, isIndependent, derivedFromArticleId, similarity: similarity === null ? null : Math.min(1, Math.max(0, similarity)) },
  });
}

/** Recalcula o evento a partir de TODAS as suas fontes (determinístico: reprocessar dá o mesmo resultado). */
export async function recompute(tx: Tx, eventId: string): Promise<NewsEvent> {
  const event = await tx.newsEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: { articles: { include: { article: { include: { source: true, analyses: { where: { rulesVersion: RULES_VERSION, modelVersion: MODEL_VERSION } } } } } } },
  });
  const rows = event.articles.map((l) => ({ link: l, article: l.article, analysis: l.article.analyses[0] }));
  const extracted = rows.map((r) => (r.analysis?.extractedData ?? {}) as { location?: { cities?: { ibge: string; name: string }[]; districts?: { ibge: string; name: string }[]; places?: string[]; ambiguities?: string[]; metroRegion?: boolean } });

  const cityIbges = uniq([...event.cityIbges, ...extracted.flatMap((x) => x.location?.cities?.map((c) => c.ibge) ?? [])]);
  const districts = uniqBy(extracted.flatMap((x) => x.location?.districts ?? []), (d) => d.ibge);
  const places = uniq([...event.places, ...extracted.flatMap((x) => x.location?.places ?? [])]).slice(0, 20);
  const metro = extracted.some((x) => x.location?.metroRegion);

  let precision: LocationPrecision;
  if (districts.length === 1) precision = 'NEIGHBORHOOD';
  else if (districts.length > 1 || cityIbges.length > 1) precision = 'REGION';
  else if (cityIbges.length === 1) precision = 'CITY';
  else precision = metro ? 'REGION' : 'UNKNOWN';

  const severities = rows.map((r) => r.analysis?.estimatedSeverity).filter((s): s is Severity => !!s);
  const severity = severities.sort((x, y) => SEVERITY_ORDER.indexOf(y) - SEVERITY_ORDER.indexOf(x))[0] ?? null;
  const temporality: Temporality = rows.some((r) => r.analysis?.temporality === 'CURRENT') ? 'CURRENT' : 'UNCERTAIN';
  // Ambíguo só se NENHUMA fonte localizou sem dúvida.
  const ambiguous = extracted.length > 0 && extracted.every((x) => (x.location?.ambiguities?.length ?? 0) > 0);

  // Agrupar ≠ confirmar. Uma fonte só CONFIRMA o evento se: não é republicação, seu local não é
  // ambíguo e, em evento de distrito, cita aquele distrito. Casos reais (24/11/2026): "SP registra
  // 10 mortes em um mês" (estado) e "problemas em SP após temporal" (cidade) viravam confirmação
  // de eventos específicos. As demais ficam ligadas como contexto.
  const eventDistrict = districts.length === 1 ? districts[0].ibge : null;
  const eligible = rows.filter((_, i) => {
    const loc = extracted[i].location;
    if ((loc?.ambiguities?.length ?? 0) > 0) return false;
    return !eventDistrict || (loc?.districts ?? []).some((d) => d.ibge === eventDistrict);
  });
  // Entre as elegíveis, cada grupo de mesma origem (mesmo veículo, republicação, mesma agência)
  // conta uma vez. A ordem de chegada não importa: a 1ª elegível sempre conta.
  const representatives: typeof eligible = [];
  for (const r of eligible) {
    if (representatives.every((x) => areIndependent(x.article, r.article).independent)) representatives.push(r);
  }
  const independent = representatives.map((r) => ({ reliability: r.article.source.reliability }));
  const confidence = assessConfidence({ temporality, precision, locationAmbiguous: ambiguous, independentSources: independent, contradiction: false });
  const decision = decidePublication({
    temporality,
    confidence: confidence.level,
    severity,
    officialSource: confidence.officialSource,
    independentEstablished: confidence.independentEstablished,
    moderatorApproved: event.moderatedById !== null,
  });

  const region = await chooseRegion(tx, cityIbges, districts, metro);
  const times = rows.map((r) => (r.article.publishedAt ?? r.article.collectedAt).getTime());

  const updated = await tx.newsEvent.update({
    where: { id: eventId },
    data: {
      // O que o moderador decidiu/corrigiu prevalece (status, gravidade, local):
      // a automação só atualiza as evidências e a confiança.
      ...(event.moderatedById
        ? {}
        : {
            status: decision.status,
            estimatedSeverity: severity,
            locationPrecision: precision,
            regionId: region?.id ?? null,
            city: region?.city ?? null,
            state: cityIbges.length || metro ? 'SP' : null,
            cityIbges,
            districtIbges: districts.map((d) => d.ibge),
          }),
      confidence: confidence.level,
      independentSources: Math.max(1, independent.length),
      urgentReview: decision.urgentReview,
      decisionReasons: [...confidence.reasons, ...decision.reasons].map((r) => r.slice(0, 300)),
      places,
      placeText: places.length ? truncate(places.join('; '), 255) : null,
      firstEvidenceAt: new Date(Math.min(...times)),
      lastEvidenceAt: new Date(Math.max(...times)),
      rulesVersion: RULES_VERSION,
      version: { increment: 1 },
    },
  });
  // Passou a exigir moderação urgente (ex.: crítico de fonte única): avisa a equipe na hora, pelo
  // outbox (mesma transação). Só na TRANSIÇÃO — recalcular de novo não repete o aviso.
  if (updated.urgentReview && !event.urgentReview) await recordUrgentReview(tx, updated);
  // Decisão de publicação + outbox na MESMA transação do evento.
  await syncPublication(tx, eventId);
  return updated;
}

/** Evento "só equipe" (`news.review.urgent`): a API não o entrega a cidadãos. */
async function recordUrgentReview(tx: Tx, e: NewsEvent): Promise<void> {
  const payload: NewsReviewEventPayload = {
    eventId: e.id,
    code: e.code,
    title: e.title,
    city: e.city,
    severity: e.estimatedSeverity,
    status: e.status,
    reasons: e.decisionReasons.slice(0, 5),
  };
  await tx.domainEvent.create({
    data: { type: RealtimeEvent.NEWS_REVIEW_URGENT, aggregateType: 'news_event', aggregateId: e.id, payload: payload as unknown as Prisma.InputJsonValue },
  });
}

async function chooseRegion(tx: Tx, cityIbges: string[], districts: { ibge: string; name: string }[], metro: boolean): Promise<{ id: string; city: string | null } | null> {
  if (districts.length === 1) {
    const d = await tx.newsRegion.findUnique({ where: { ibgeCode: districts[0].ibge }, include: { parent: true } });
    if (d) return { id: d.id, city: d.parent?.name ?? null };
  }
  if (cityIbges.length === 1) {
    const c = await tx.newsRegion.findUnique({ where: { ibgeCode: cityIbges[0] } });
    if (c) return { id: c.id, city: c.name };
  }
  if (cityIbges.length > 1 || metro) {
    const m = await tx.newsRegion.findUnique({ where: { kind_state_name: { kind: 'METRO', state: 'SP', name: METRO_NAME } } });
    if (m) return { id: m.id, city: null };
  }
  return null;
}

/** Eventos publicados sem evidência nova há mais de `hours` saem do mapa como ativos (DESATUALIZADO). */
export async function expireStaleEvents(prisma: PrismaClient, now: Date = new Date(), hours = 6): Promise<number> {
  const cutoff = new Date(now.getTime() - hours * HOUR);
  const stale = await prisma.newsEvent.findMany({
    where: { status: { in: ['PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED', 'AWAITING_VALIDATION'] }, lastEvidenceAt: { lt: cutoff } },
    select: { id: true, version: true },
  });
  let count = 0;
  for (const e of stale) {
    // Um evento por transação: o alerta expira (outbox `news.alert.expired`) junto com o evento.
    await prisma.$transaction(async (tx) => {
      const { count: n } = await tx.newsEvent.updateMany({
        where: { id: e.id, version: e.version }, // não atropela uma fonte nova que chegou agora
        data: { status: 'OUTDATED', urgentReview: false, version: { increment: 1 } },
      });
      if (n === 0) return;
      count++;
      await syncPublication(tx, e.id, now);
    }, TX_OPTIONS);
  }
  // Urgência não faz sentido em evento desatualizado (visto no painel com dados reais em 24/11/2026).
  await prisma.newsEvent.updateMany({ where: { status: 'OUTDATED', urgentReview: true }, data: { urgentReview: false } });
  return count;
}

/**
 * Reconciliação (manutenção periódica): garante que o alerta reflete o evento mesmo se uma
 * sincronização se perdeu (ex.: decisão do moderador com a fila fora do ar). Idempotente.
 */
export async function reconcilePublications(prisma: PrismaClient, sinceHours = 72): Promise<number> {
  const recent = await prisma.newsEvent.findMany({
    where: { updatedAt: { gte: new Date(Date.now() - sinceHours * HOUR) }, OR: [{ alert: { isNot: null } }, { status: { in: ['PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED'] } }] },
    select: { id: true },
  });
  let changed = 0;
  for (const e of recent) {
    try {
      const r = await prisma.$transaction((tx) => syncPublication(tx, e.id), TX_OPTIONS);
      if (r.change) changed++;
    } catch {
      // Um evento com problema não impede a reconciliação dos demais; a próxima rodada tenta de novo.
    }
  }
  return changed;
}

const uniq = <T>(xs: T[]) => [...new Set(xs)];
function uniqBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const x of xs) if (!seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
}
function maxDate(a: Date, b: Date): Date {
  return a > b ? a : b;
}
