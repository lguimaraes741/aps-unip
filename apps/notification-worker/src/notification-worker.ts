import { NewsAlertEventPayload, NewsReviewEventPayload, NotificationItem, OccurrenceEventJob, SocketMessage, STAFF_ROLES } from '@alertacidade/shared-types';
import { Prisma, PrismaClient, type Notification } from '@prisma/client';
import type { Emitter } from '@socket.io/redis-emitter';
import { Job, Queue } from 'bullmq';
import { nearbyMessage, newsAlertMessage, newsReviewMessage, statusMessage } from './messages';
import { PushProvider } from './push/push-provider';

export const CONSUMER = 'notification-worker';

/**
 * Opções do Prisma do worker (produção e testes usam as mesmas). Com o padrão do Prisma
 * (espera de 2 s por conexão), jobs simultâneos falhavam com
 * "Unable to start a transaction in the given time" quando a máquina estava sob carga.
 */
export const prismaTransactionOptions = { maxWait: 10_000, timeout: 20_000 };

export interface PushDeliveryJob {
  notificationId: string;
}

export interface Logger {
  log(message: string): void;
  warn(message: string): void;
}

interface Recipient {
  userId: string;
  distanceMeters: number | null;
  title: string;
  body: string;
}

export function toNotificationItem(n: Notification, occurrence: NotificationItem['occurrence']): NotificationItem {
  return {
    id: n.id,
    type: n.type,
    occurrenceId: n.occurrenceId,
    newsEventId: n.newsEventId,
    title: n.title,
    body: n.body,
    distanceMeters: n.distanceMeters,
    occurrence,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * Regras de entrega (ver docs/testing/fase-4.md):
 *  - occurrence.created → quem tem a ocorrência dentro da área de interesse, com gravidade
 *    ≥ mínima escolhida, alertas ligados e conta ativa (exceto o autor);
 *  - occurrence.validated / rejected / resolved → o autor.
 *
 * Garantias contra duplicidade (a entrega do outbox é "pelo menos uma vez"):
 *  1. processed_messages(consumer, eventId): o mesmo evento não é processado duas vezes;
 *  2. UNIQUE(user_id, source_event_id): nunca duas notificações do mesmo evento p/ a mesma pessoa;
 *  3. jobId = notificationId na fila de push.
 */
export class NotificationWorker {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pushQueue: Queue<PushDeliveryJob>,
    private readonly provider: PushProvider,
    private readonly emitter: Emitter | undefined,
    private readonly logger: Logger,
    private readonly pushAttempts: number,
  ) {}

  async processOccurrenceEvent(job: OccurrenceEventJob): Promise<{ duplicate: boolean; notifications: number }> {
    if (job.type.startsWith('news.alert.')) return this.processNewsAlert(job);
    if (job.type.startsWith('news.review.')) return this.processNewsReview(job);
    const created = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$executeRaw`
          INSERT INTO processed_messages (consumer, message_id) VALUES (${CONSUMER}, ${job.eventId}::uuid)
          ON CONFLICT DO NOTHING`;
        if (claimed === 0) return null;

        const recipients = await this.recipientsFor(tx, job);
        if (recipients.length === 0) return [];

        const notifications = await tx.notification.createManyAndReturn({
          data: recipients.map((r) => ({
            userId: r.userId,
            occurrenceId: job.aggregateId,
            sourceEventId: job.eventId,
            type: job.type === 'occurrence.created' ? 'OCCURRENCE_NEARBY' : 'OCCURRENCE_STATUS_CHANGED',
            title: r.title,
            body: r.body,
            distanceMeters: r.distanceMeters,
          })),
          skipDuplicates: true,
        });
        // Enfileira DENTRO da transação: se falhar, nada é confirmado e o BullMQ repete o evento.
        await this.pushQueue.addBulk(
          notifications.map((n) => ({ name: 'push', data: { notificationId: n.id }, opts: { jobId: n.id } })),
        );
        return notifications;
      },
      { timeout: 20_000 },
    );

    if (created === null) return { duplicate: true, notifications: 0 };
    // Caixa de alertas em tempo real (via Redis direto para as salas do Socket.IO da API).
    for (const n of created) {
      try {
        this.emitter?.to(`user:${n.userId}`).emit(SocketMessage.NOTIFICATION, toNotificationItem(n, { code: job.payload.code, severity: job.payload.severity, status: job.payload.status }));
      } catch (error) {
        this.logger.warn(`Falha ao avisar ${n.userId} em tempo real: ${(error as Error).message}`);
      }
    }
    return { duplicate: false, notifications: created.length };
  }

  private async recipientsFor(tx: Prisma.TransactionClient, job: OccurrenceEventJob): Promise<Recipient[]> {
    if (job.type === 'occurrence.created') {
      const rows = await tx.$queryRaw<{ user_id: string; distance: number }[]>`
        SELECT p.user_id, ROUND(ST_Distance(p.location, o.location))::int AS distance
        FROM occurrences o
        JOIN notification_preferences p
          ON p.push_enabled
         AND p.location IS NOT NULL
         AND ST_DWithin(p.location, o.location, p.radius_meters)
         AND o.severity >= p.min_severity          -- enum ordenado: LOW < MODERATE < HIGH < CRITICAL
         AND p.user_id <> o.created_by_id
        JOIN users u ON u.id = p.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
        WHERE o.id = ${job.aggregateId}::uuid
          AND o.deleted_at IS NULL
          AND o.status <> 'REJECTED'`;
      return rows.map((r) => ({ userId: r.user_id, distanceMeters: r.distance, ...nearbyMessage(job.payload, r.distance) }));
    }

    const text = statusMessage(job.type, job.payload);
    if (!text) return [];
    const rows = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT u.id AS user_id
      FROM occurrences o JOIN users u ON u.id = o.created_by_id
      WHERE o.id = ${job.aggregateId}::uuid AND u.status = 'ACTIVE' AND u.deleted_at IS NULL`;
    return rows.map((r) => ({ userId: r.user_id, distanceMeters: null, ...text }));
  }

  /**
   * Alerta de notícia (Fase 7). A DECISÃO de notificar já vem no payload (`notify`), gravada pelo
   * news-worker junto com o alerta; aqui só se calcula QUEM recebe:
   *  - publicado/atualizado: preferências cuja área de interesse cruza a área do evento — o ponto,
   *    se houver; senão o contorno oficial (IBGE) da cidade ou da região; distrito sem contorno usa
   *    o da cidade. Gravidade ≥ mínima de cada pessoa. Sem área conhecida, ninguém (nunca "todo mundo");
   *  - encerrado/retirado: somente quem recebeu o alerta original.
   * Mesmas garantias de duplicidade das ocorrências (processed_messages, UNIQUE, jobId).
   */
  async processNewsAlert(job: OccurrenceEventJob): Promise<{ duplicate: boolean; notifications: number }> {
    const p = job.payload as unknown as NewsAlertEventPayload;
    const created = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$executeRaw`
          INSERT INTO processed_messages (consumer, message_id) VALUES (${CONSUMER}, ${job.eventId}::uuid)
          ON CONFLICT DO NOTHING`;
        if (claimed === 0) return null;
        if (!p.notify) return [];
        const text = newsAlertMessage(p);
        if (!text) return [];

        const update = p.change === 'resolved' || p.change === 'retracted';
        const recipients = update ? await this.previousNewsRecipients(tx, p.eventId) : await this.newsAreaRecipients(tx, p);
        if (recipients.length === 0) return [];

        const notifications = await tx.notification.createManyAndReturn({
          data: recipients.map((r) => ({
            userId: r.userId,
            newsEventId: p.eventId,
            sourceEventId: job.eventId,
            type: update ? ('NEWS_ALERT_UPDATE' as const) : ('NEWS_ALERT' as const),
            title: text.title,
            body: text.body,
            distanceMeters: r.distanceMeters,
          })),
          skipDuplicates: true,
        });
        await this.pushQueue.addBulk(notifications.map((n) => ({ name: 'push', data: { notificationId: n.id }, opts: { jobId: n.id } })));
        return notifications;
      },
      { timeout: 20_000 },
    );
    if (created === null) return { duplicate: true, notifications: 0 };
    for (const n of created) {
      try {
        this.emitter?.to(`user:${n.userId}`).emit(SocketMessage.NOTIFICATION, toNotificationItem(n, null));
      } catch (error) {
        this.logger.warn(`Falha ao avisar ${n.userId} em tempo real: ${(error as Error).message}`);
      }
    }
    return { duplicate: false, notifications: created.length };
  }

  /**
   * Revisão urgente de notícia: avisa TODA a equipe (MODERATOR e ADMIN ativos), sem filtro de área —
   * quem modera cuida da região inteira. Caixa de alertas + tempo real sempre; push só para quem não
   * desligou os alertas (os demais ficam `SKIPPED`). Mesmas garantias de duplicidade.
   */
  async processNewsReview(job: OccurrenceEventJob): Promise<{ duplicate: boolean; notifications: number }> {
    const p = job.payload as unknown as NewsReviewEventPayload;
    const created = await this.prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$executeRaw`
          INSERT INTO processed_messages (consumer, message_id) VALUES (${CONSUMER}, ${job.eventId}::uuid)
          ON CONFLICT DO NOTHING`;
        if (claimed === 0) return null;
        const staff = await tx.user.findMany({
          where: { role: { in: [...STAFF_ROLES] }, status: 'ACTIVE', deletedAt: null },
          select: { id: true, notificationPreference: { select: { pushEnabled: true } } },
        });
        if (staff.length === 0) return [];
        const text = newsReviewMessage(p);
        const pushOff = new Set(staff.filter((u) => u.notificationPreference?.pushEnabled === false).map((u) => u.id));
        const notifications = await tx.notification.createManyAndReturn({
          data: staff.map((u) => ({
            userId: u.id,
            newsEventId: p.eventId,
            sourceEventId: job.eventId,
            type: 'NEWS_REVIEW_URGENT' as const,
            title: text.title,
            body: text.body,
            ...(pushOff.has(u.id) && { pushStatus: 'SKIPPED' as const, lastError: 'Alertas desligados nas preferências' }),
          })),
          skipDuplicates: true,
        });
        const toPush = notifications.filter((n) => !pushOff.has(n.userId));
        await this.pushQueue.addBulk(toPush.map((n) => ({ name: 'push', data: { notificationId: n.id }, opts: { jobId: n.id } })));
        return notifications;
      },
      { timeout: 20_000 },
    );
    if (created === null) return { duplicate: true, notifications: 0 };
    for (const n of created) {
      try {
        this.emitter?.to(`user:${n.userId}`).emit(SocketMessage.NOTIFICATION, toNotificationItem(n, null));
      } catch (error) {
        this.logger.warn(`Falha ao avisar ${n.userId} em tempo real: ${(error as Error).message}`);
      }
    }
    return { duplicate: false, notifications: created.length };
  }

  private async newsAreaRecipients(tx: Prisma.TransactionClient, p: NewsAlertEventPayload): Promise<{ userId: string; distanceMeters: number | null }[]> {
    if (!p.severity) return [];
    const rows = await tx.$queryRaw<{ user_id: string; distance: number | null }[]>`
      WITH area AS (
        SELECT COALESCE(e.location::geography, r.boundary::geography, parent.boundary::geography) AS geo
        FROM news_events e
        LEFT JOIN news_regions r ON r.id = e.region_id
        LEFT JOIN news_regions parent ON parent.id = r.parent_id
        WHERE e.id = ${p.eventId}::uuid
      )
      SELECT pref.user_id, ROUND(ST_Distance(pref.location, a.geo))::int AS distance
      FROM area a
      JOIN notification_preferences pref
        ON pref.push_enabled
       AND pref.location IS NOT NULL
       AND ST_DWithin(pref.location, a.geo, pref.radius_meters)
       AND ${p.severity}::severity >= pref.min_severity
      JOIN users u ON u.id = pref.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      WHERE a.geo IS NOT NULL`;
    return rows.map((r) => ({ userId: r.user_id, distanceMeters: r.distance }));
  }

  private async previousNewsRecipients(tx: Prisma.TransactionClient, eventId: string): Promise<{ userId: string; distanceMeters: null }[]> {
    const rows = await tx.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT n.user_id
      FROM notifications n JOIN users u ON u.id = n.user_id AND u.status = 'ACTIVE' AND u.deleted_at IS NULL
      WHERE n.news_event_id = ${eventId}::uuid AND n.type = 'NEWS_ALERT'`;
    return rows.map((r) => ({ userId: r.user_id, distanceMeters: null }));
  }

  /**
   * Entrega o push de UMA notificação em todos os aparelhos do usuário.
   * Falha temporária → lança erro e o BullMQ repete com backoff; na última tentativa vira FAILED.
   */
  async processPushDelivery(job: Pick<Job<PushDeliveryJob>, 'data' | 'attemptsMade'>): Promise<Notification['pushStatus'] | 'MISSING'> {
    const notification = await this.prisma.notification.findUnique({ where: { id: job.data.notificationId } });
    if (!notification) return 'MISSING'; // transação de origem desfeita ou conta excluída
    if (notification.pushStatus !== 'PENDING') return notification.pushStatus; // já finalizada (job repetido)

    const devices = await this.prisma.deviceToken.findMany({ where: { userId: notification.userId } });
    const finish = async (status: 'SENT' | 'SKIPPED' | 'FAILED', lastError: string | null) => {
      await this.prisma.notification.update({
        where: { id: notification.id },
        data: { pushStatus: status, pushAttempts: { increment: 1 }, lastError: lastError?.slice(0, 500) ?? null },
      });
      return status;
    };

    if (devices.length === 0) return finish('SKIPPED', 'Nenhum aparelho registrado');

    const data = { notificationId: notification.id, occurrenceId: notification.occurrenceId ?? '', newsEventId: notification.newsEventId ?? '', type: notification.type };
    const results = await Promise.all(
      devices.map(async (d) => ({ device: d, result: await this.provider.send({ token: d.token, title: notification.title, body: notification.body, data }) })),
    );

    const dead = results.filter((r) => !r.result.ok && r.result.permanent && r.result.removeToken).map((r) => r.device.id);
    if (dead.length > 0) await this.prisma.deviceToken.deleteMany({ where: { id: { in: dead } } });

    if (!this.provider.delivers) return finish('SKIPPED', 'Provedor de push de desenvolvimento (FCM não configurado)');
    if (results.some((r) => r.result.ok)) return finish('SENT', null);

    const reasons = results.map((r) => (r.result.ok ? '' : r.result.reason)).join(' | ');
    const transient = results.some((r) => !r.result.ok && !r.result.permanent);
    const lastAttempt = job.attemptsMade + 1 >= this.pushAttempts;
    if (!transient || lastAttempt) return finish('FAILED', reasons);

    await this.prisma.notification.update({
      where: { id: notification.id },
      data: { pushAttempts: { increment: 1 }, lastError: reasons.slice(0, 500) },
    });
    throw new Error(`Falha temporária no push: ${reasons}`);
  }
}

export function pushQueueOptions(prefix: string, attempts: number) {
  return {
    prefix,
    defaultJobOptions: {
      attempts,
      backoff: { type: 'exponential' as const, delay: 5_000 },
      removeOnComplete: { age: 7 * 24 * 3600 },
      removeOnFail: { age: 30 * 24 * 3600 },
    },
  };
}

