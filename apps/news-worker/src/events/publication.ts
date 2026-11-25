import { NewsAlertEventPayload, RealtimeEvent } from '@alertacidade/shared-types';
import { NewsAlertLevel, NewsAlertStatus, NewsEvent, Prisma, Severity } from '@prisma/client';
import { isRelevantChange } from '../policy/publication';
import { SEVERITY_ORDER } from '../types';

/**
 * Publicação de alertas de notícia (docs/architecture/07-news-intelligence.md, 7.7 e Etapa 10).
 *
 * Deriva o estado do alerta (news_alerts) a partir do evento e, se algo relevante mudou, grava NA
 * MESMA TRANSAÇÃO: o alerta, a DECISÃO de push (notified_severity/last_notified_at) e o evento
 * `news.alert.*` no outbox. Nenhuma notificação existe antes de a decisão estar persistida — o
 * publicador do outbox (API) entrega ao Socket.IO/sync e ao worker de notificações depois do commit.
 *
 * Idempotente: chamar de novo sem mudança no evento não grava nada.
 */

type Tx = Prisma.TransactionClient;

export const ALERT_TTL_HOURS = 6;

/** Push permitido para o nível/gravidade (as preferências de cada pessoa ainda filtram depois). */
export function pushAllowed(level: NewsAlertLevel, severity: Severity | null): boolean {
  if (severity === null) return false; // impacto não informado: não alarmar
  if (level === 'PRELIMINARY') return severity === 'HIGH'; // crítico preliminar nunca; moderado/baixo não
  return true;
}

const STATUS_FOR: Partial<Record<NewsEvent['status'], NewsAlertStatus>> = {
  PUBLISHED_PRELIMINARY: 'ACTIVE',
  PUBLISHED_VERIFIED: 'ACTIVE',
  RESOLVED: 'RESOLVED',
  DISCARDED: 'RETRACTED',
  OUTDATED: 'EXPIRED',
};

const EVENT_FOR: Record<NewsAlertEventPayload['change'], RealtimeEvent> = {
  new: RealtimeEvent.NEWS_ALERT_PUBLISHED,
  escalated: RealtimeEvent.NEWS_ALERT_UPDATED,
  upgraded: RealtimeEvent.NEWS_ALERT_UPDATED,
  sources: RealtimeEvent.NEWS_ALERT_UPDATED,
  resolved: RealtimeEvent.NEWS_ALERT_RESOLVED,
  retracted: RealtimeEvent.NEWS_ALERT_RETRACTED,
  expired: RealtimeEvent.NEWS_ALERT_EXPIRED,
};

const LEVEL_ORDER: NewsAlertLevel[] = ['PRELIMINARY', 'VERIFIED', 'OFFICIAL'];
const rank = (s: Severity | null) => (s ? SEVERITY_ORDER.indexOf(s) : -1);

export interface PublicationResult {
  alertId: string | null;
  change: NewsAlertEventPayload['change'] | null;
  notify: boolean;
}

export async function syncPublication(tx: Tx, eventId: string, now: Date = new Date()): Promise<PublicationResult> {
  // Trava a linha do evento: a reconciliação periódica e o processamento de uma notícia podem
  // sincronizar o mesmo evento ao mesmo tempo (visto no teste ponta a ponta em 24/11/2026: os dois
  // tentavam criar o alerta). Com a trava, o segundo espera o primeiro e vê o alerta já criado.
  await tx.$queryRaw`SELECT id FROM news_events WHERE id = ${eventId}::uuid FOR UPDATE`;
  const event = await tx.newsEvent.findUniqueOrThrow({
    where: { id: eventId },
    include: {
      alert: true,
      region: { select: { name: true } },
      articles: {
        include: {
          article: { select: { source: { select: { reliability: true } }, analyses: { orderBy: { analyzedAt: 'desc' }, take: 1, select: { extractedData: true } } } },
        },
      },
    },
  });
  const current = event.alert;
  const official = event.articles.some((l) => l.isIndependent && l.article.source.reliability === 'OFFICIAL');
  const level: NewsAlertLevel = event.status === 'PUBLISHED_PRELIMINARY' ? 'PRELIMINARY' : official ? 'OFFICIAL' : 'VERIFIED';

  let desired = STATUS_FOR[event.status];
  // Voltou para validação (ex.: fonte nova trouxe ambiguidade) depois de publicado: retira.
  if (!desired && current?.status === 'ACTIVE') desired = 'RETRACTED';
  if (!desired) return { alertId: current?.id ?? null, change: null, notify: false };
  // Nunca publicado: só há o que fazer se for para publicar.
  if (!current && desired !== 'ACTIVE') return { alertId: null, change: null, notify: false };

  let change: NewsAlertEventPayload['change'] | null = null;
  let notify = false;
  const data: Prisma.NewsAlertUncheckedUpdateInput = {};

  if (desired === 'ACTIVE') {
    const severity = event.estimatedSeverity;
    const reactivating = !current || current.status !== 'ACTIVE';
    if (reactivating) change = 'new';
    else if (LEVEL_ORDER.indexOf(level) > LEVEL_ORDER.indexOf(current!.level)) change = 'upgraded';
    else if (rank(severity) > rank(current!.publishedSeverity)) change = 'escalated';
    else if (level !== current!.level || severity !== current!.publishedSeverity) change = 'sources';
    if (!change) return { alertId: current!.id, change: null, notify: false };

    // "Não repetir alertas sem motivo relevante": só avisa de novo se a gravidade subir acima do
    // último aviso ou se o alerta deixar de ser preliminar.
    const previous = current?.lastNotifiedAt ? { severity: current.notifiedSeverity, level: current.level } : null;
    notify = pushAllowed(level, severity) && isRelevantChange(previous, { severity, level });
    Object.assign(data, {
      status: 'ACTIVE',
      level,
      publishedSeverity: severity,
      expiresAt: new Date(Math.max(now.getTime(), event.lastEvidenceAt.getTime()) + ALERT_TTL_HOURS * 3_600_000),
      retractionReason: null,
      ...(notify && { notifiedSeverity: severity, lastNotifiedAt: now }),
      ...(event.moderatedById && { reviewedById: event.moderatedById }),
    });
  } else {
    if (current!.status === desired) return { alertId: current!.id, change: null, notify: false };
    change = desired === 'RESOLVED' ? 'resolved' : desired === 'RETRACTED' ? 'retracted' : 'expired';
    // Encerramento/correção: avisa quem recebeu o alerta original. Expirar é silencioso.
    notify = change !== 'expired' && current!.lastNotifiedAt !== null && current!.status === 'ACTIVE';
    Object.assign(data, {
      status: desired,
      ...(desired === 'RETRACTED' && { retractionReason: (event.moderationNote ?? 'Retirado após revisão').slice(0, 500) }),
    });
  }

  const alert = current
    ? await tx.newsAlert.update({ where: { id: current.id }, data: { ...data, revision: { increment: 1 } } })
    : await tx.newsAlert.create({
        data: {
          eventId: event.id,
          level,
          status: 'ACTIVE',
          publishedAt: now,
          expiresAt: data.expiresAt as Date,
          publishedSeverity: event.estimatedSeverity,
          notifiedSeverity: notify ? event.estimatedSeverity : null,
          lastNotifiedAt: notify ? now : null,
          reviewedById: event.moderatedById,
        },
      });

  const payload: NewsAlertEventPayload = {
    alertId: alert.id,
    eventId: event.id,
    code: event.code,
    title: event.title,
    status: alert.status,
    level: alert.level,
    severity: event.estimatedSeverity,
    city: event.city,
    regionId: event.regionId,
    regionName: event.region?.name ?? null,
    locationPrecision: event.locationPrecision,
    latitude: event.latitude,
    longitude: event.longitude,
    headline: headlineOf(event),
    revision: alert.revision,
    notify,
    change,
  };
  await tx.domainEvent.create({
    data: { type: EVENT_FOR[change], aggregateType: 'news_alert', aggregateId: alert.id, payload: payload as unknown as Prisma.InputJsonValue },
  });
  return { alertId: alert.id, change, notify };

  function headlineOf(e: typeof event): string | null {
    for (const l of e.articles) {
      const ev = ((l.article.analyses[0]?.extractedData ?? {}) as { severityEvidence?: { label: string; severity: Severity }[] }).severityEvidence ?? [];
      const top = ev.find((x) => x.severity === e.estimatedSeverity);
      if (top) return top.label;
    }
    return null;
  }
}
