import { Injectable, NotFoundException } from '@nestjs/common';
import { NotificationFilter, NotificationItem } from '@alertacidade/shared-types';
import { DevicePlatform, Notification, Occurrence, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type WithOccurrence = Notification & { occurrence: Pick<Occurrence, 'code' | 'severity' | 'status' | 'deletedAt'> | null };

const occurrenceSelect = { select: { code: true, severity: true, status: true, deletedAt: true } } as const;

const FILTERS: Record<NotificationFilter, Prisma.NotificationWhereInput> = {
  all: {},
  unread: { readAt: null },
  critical: { occurrence: { severity: 'CRITICAL' } },
  nearby: { type: 'OCCURRENCE_NEARBY' },
  resolved: { occurrence: { status: 'RESOLVED' } },
};

export function toNotificationItem(n: WithOccurrence): NotificationItem {
  const o = n.occurrence && !n.occurrence.deletedAt ? n.occurrence : null;
  return {
    id: n.id,
    type: n.type,
    occurrenceId: n.occurrenceId,
    newsEventId: n.newsEventId,
    title: n.title,
    body: n.body,
    distanceMeters: n.distanceMeters,
    occurrence: o ? { code: o.code, severity: o.severity, status: o.status } : null,
    readAt: n.readAt?.toISOString() ?? null,
    createdAt: n.createdAt.toISOString(),
  };
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * O token é único por aparelho: se outra conta entrar no mesmo celular, o token passa
   * para ela (a anterior deixa de receber push nesse aparelho).
   */
  async registerDevice(userId: string, token: string, platform: DevicePlatform): Promise<void> {
    await this.prisma.deviceToken.upsert({
      where: { token },
      create: { userId, token, platform },
      update: { userId, platform, lastSeenAt: new Date() },
    });
  }

  async removeDevice(userId: string, token: string): Promise<void> {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
  }

  async list(userId: string, page: number, limit: number, filter: NotificationFilter = 'all') {
    const where: Prisma.NotificationWhereInput = { userId, ...FILTERS[filter] };
    const [items, total, unread] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        include: { occurrence: occurrenceSelect },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    // `unread` é sempre o total de não lidas (badge da aba), independentemente do filtro.
    return { items: items.map(toNotificationItem), total, unread, page, limit };
  }

  async markRead(userId: string, id: string): Promise<void> {
    const { count } = await this.prisma.notification.updateMany({
      where: { id, userId },
      data: { readAt: new Date() },
    });
    // Não revela se o alerta existe para outro usuário.
    if (count === 0) throw new NotFoundException('Alerta não encontrado');
  }

  async markAllRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
  }
}
