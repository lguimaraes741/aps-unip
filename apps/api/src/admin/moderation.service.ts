import { ConflictException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { RealtimeEvent, STATUS_TRANSITIONS } from '@alertacidade/shared-types';
import { OccurrenceStatus, Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { OutboxService } from '../events/outbox.service';
import { photoUrl } from '../occurrences/occurrence-view';
import { PrismaService } from '../prisma/prisma.service';
import { AdminOccurrencesQuery, ChangeStatusDto, ContentReportsQuery } from './admin.dto';

/** Evento publicado para cada status de destino (o worker avisa o autor nos três finais). */
const EVENT_FOR: Record<OccurrenceStatus, RealtimeEvent> = {
  PENDING: RealtimeEvent.OCCURRENCE_UPDATED,
  UNDER_REVIEW: RealtimeEvent.OCCURRENCE_UPDATED,
  VALIDATED: RealtimeEvent.OCCURRENCE_VALIDATED,
  REJECTED: RealtimeEvent.OCCURRENCE_REJECTED,
  RESOLVED: RealtimeEvent.OCCURRENCE_RESOLVED,
};

const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  VALIDATED: 'Validada',
  REJECTED: 'Rejeitada',
  RESOLVED: 'Resolvida',
};

const LIST_SELECT = {
  id: true,
  code: true,
  title: true,
  address: true,
  neighborhood: true,
  latitude: true,
  longitude: true,
  severity: true,
  status: true,
  version: true,
  confirmCount: true,
  contestCount: true,
  isDemo: true,
  occurredAt: true,
  createdAt: true,
  updatedAt: true,
  createdBy: { select: { id: true, name: true } },
  _count: { select: { reports: { where: { status: 'OPEN' } }, photos: true } },
} satisfies Prisma.OccurrenceSelect;

@Injectable()
export class ModerationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  async list(query: AdminOccurrencesQuery) {
    const q = query.q?.trim();
    const code = q && /^#?\d{1,9}$/.test(q) ? Number(q.replace('#', '')) : undefined;
    const where: Prisma.OccurrenceWhereInput = {
      deletedAt: null,
      ...(query.status?.length && { status: { in: query.status } }),
      ...(query.severity?.length && { severity: { in: query.severity } }),
      ...(query.reported && { reports: { some: { status: 'OPEN' } } }),
      ...((query.from || query.to) && { createdAt: { gte: query.from, lt: query.to } }),
      ...(q && {
        OR: [
          ...(code !== undefined ? [{ code }] : []),
          { title: { contains: q, mode: 'insensitive' as const } },
          { address: { contains: q, mode: 'insensitive' as const } },
          { neighborhood: { contains: q, mode: 'insensitive' as const } },
        ],
      }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.occurrence.findMany({
        where,
        select: LIST_SELECT,
        orderBy: [{ createdAt: 'desc' }], // mais recentes primeiro

        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.occurrence.count({ where }),
    ]);
    return {
      items: rows.map(({ _count, createdBy, ...o }) => ({
        ...o,
        author: createdBy,
        openReports: _count.reports,
        photoCount: _count.photos,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  /** Análise completa. O e-mail do autor só aparece para ADMIN (minimização de dados, LGPD). */
  async detail(viewer: AuthUser, id: string) {
    const o = await this.prisma.occurrence.findFirst({
      where: { id, deletedAt: null },
      include: {
        createdBy: { select: { id: true, name: true, email: true, role: true, status: true } },
        moderatedBy: { select: { id: true, name: true } },
        photos: { orderBy: { position: 'asc' } },
        history: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true, role: true } } } },
        reports: { orderBy: { createdAt: 'desc' }, include: { reporter: { select: { name: true } } } },
      },
    });
    if (!o) throw new NotFoundException('Ocorrência não encontrada');
    const { createdBy, moderatedBy, photos, history, reports, ...rest } = o;
    return {
      ...rest,
      author: {
        id: createdBy.id,
        name: createdBy.name,
        role: createdBy.role,
        status: createdBy.status,
        ...(viewer.role === 'ADMIN' && { email: createdBy.email }),
      },
      moderatedBy,
      photos: photos.map((p) => ({ id: p.id, url: photoUrl(p.id), width: p.width, height: p.height, position: p.position })),
      history: history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        createdAt: h.createdAt,
        actor: h.actor ? { name: h.actor.name, role: h.actor.role } : null,
      })),
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter.name,
      })),
      allowedTransitions: STATUS_TRANSITIONS[o.status],
    };
  }

  /**
   * Muda o status com controle otimista: o UPDATE só acontece se a versão ainda for a que
   * o moderador viu. Na mesma transação: histórico, evento no outbox (tempo real + worker)
   * e auditoria com antes/depois — ou tudo é confirmado, ou nada.
   */
  async changeStatus(actor: AuthUser, id: string, dto: ChangeStatusDto, ip?: string) {
    const note = dto.note?.trim() || null;
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.occurrence.findFirst({ where: { id, deletedAt: null } });
      if (!current) throw new NotFoundException('Ocorrência não encontrada');
      if (current.version !== dto.expectedVersion) {
        throw new ConflictException(
          `Esta ocorrência foi alterada por outra pessoa enquanto você analisava (agora está "${STATUS_LABEL[current.status]}"). Recarregue e tente de novo.`,
        );
      }
      if (!(STATUS_TRANSITIONS[current.status] as readonly OccurrenceStatus[]).includes(dto.status)) {
        throw new UnprocessableEntityException(`Não é possível mudar de "${STATUS_LABEL[current.status]}" para "${STATUS_LABEL[dto.status]}"`);
      }
      if (dto.status === 'REJECTED' && !note) {
        throw new UnprocessableEntityException('Informe o motivo da rejeição');
      }

      const now = new Date();
      const { count } = await tx.occurrence.updateMany({
        where: { id, version: dto.expectedVersion },
        data: {
          status: dto.status,
          version: { increment: 1 },
          moderatedById: actor.id,
          moderationNote: note,
          ...(dto.status === 'VALIDATED' && { validatedAt: now }),
          ...(dto.status === 'RESOLVED' && { resolvedAt: now }),
        },
      });
      // Outra transação mudou a versão entre a leitura e o UPDATE.
      if (count === 0) throw new ConflictException('Esta ocorrência acabou de ser alterada por outra pessoa. Recarregue e tente de novo.');

      const updated = await tx.occurrence.findUniqueOrThrow({ where: { id } });
      await tx.occurrenceStatusHistory.create({
        data: { occurrenceId: id, fromStatus: current.status, toStatus: dto.status, actorId: actor.id, note },
      });
      await this.outbox.recordOccurrenceEvent(tx, EVENT_FOR[dto.status], updated);
      await this.audit.log(tx, {
        actorId: actor.id,
        action: 'occurrence.status_changed',
        entityType: 'occurrence',
        entityId: id,
        before: { status: current.status, version: current.version, moderationNote: current.moderationNote },
        after: { status: updated.status, version: updated.version, moderationNote: updated.moderationNote },
        ipAddress: ip,
      });
      return { id, status: updated.status, version: updated.version, allowedTransitions: STATUS_TRANSITIONS[updated.status] };
    });
  }

  async listReports(query: ContentReportsQuery) {
    const where: Prisma.ContentReportWhereInput = { status: query.status, occurrence: { deletedAt: null } };
    const [rows, total] = await Promise.all([
      this.prisma.contentReport.findMany({
        where,
        orderBy: { createdAt: query.status === 'OPEN' ? 'asc' : 'desc' }, // fila: mais antigas primeiro
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: {
          reporter: { select: { name: true } },
          occurrence: { select: { id: true, code: true, title: true, status: true, severity: true } },
        },
      }),
      this.prisma.contentReport.count({ where }),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt,
        reporter: r.reporter.name,
        occurrence: r.occurrence,
      })),
      total,
      page: query.page,
      limit: query.limit,
    };
  }

  async resolveReport(actor: AuthUser, id: string, status: 'REVIEWED' | 'DISMISSED', ip?: string) {
    return this.prisma.$transaction(async (tx) => {
      const report = await tx.contentReport.findUnique({ where: { id } });
      if (!report) throw new NotFoundException('Denúncia não encontrada');
      const { count } = await tx.contentReport.updateMany({ where: { id, status: 'OPEN' }, data: { status } });
      if (count === 0) throw new ConflictException('Esta denúncia já foi tratada');
      await this.audit.log(tx, {
        actorId: actor.id,
        action: 'content_report.resolved',
        entityType: 'content_report',
        entityId: id,
        before: { status: report.status },
        after: { status, occurrenceId: report.occurrenceId },
        ipAddress: ip,
      });
      return { id, status };
    });
  }
}
