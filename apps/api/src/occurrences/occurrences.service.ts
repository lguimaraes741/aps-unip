import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Occurrence, OccurrenceStatus, Prisma } from '@prisma/client';
import { RealtimeEvent } from '@alertacidade/shared-types';
import { AuditService } from '../audit/audit.service';
import { AuthUser, isPrivileged } from '../common/auth/auth-user';
import { OutboxService } from '../events/outbox.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOccurrenceDto, ListOccurrencesQuery, MyOccurrencesQuery, ReportContentDto } from './dto/occurrences.dto';
import { likePattern, OccurrenceRow, photoUrl, toSummary } from './occurrence-view';

const ACTIVE_STATUSES: OccurrenceStatus[] = ['PENDING', 'UNDER_REVIEW', 'VALIDATED'];

const MINE_STATUS: Record<MyOccurrencesQuery['filter'], OccurrenceStatus[] | null> = {
  all: null,
  pending: ['PENDING', 'UNDER_REVIEW'],
  validated: ['VALIDATED'],
  resolved: ['RESOLVED'],
  rejected: ['REJECTED'],
};

const SUMMARY_COLUMNS = Prisma.sql`
  o.id, o.code, o.title, o.address, o.neighborhood, o.latitude, o.longitude,
  o.severity::text AS severity, o.status::text AS status,
  o.occurred_at, o.created_at, o.updated_at, o.confirm_count, o.contest_count, o.is_demo,
  (SELECT p.id FROM occurrence_photos p WHERE p.occurrence_id = o.id ORDER BY p.position, p.created_at LIMIT 1) AS cover_photo_id`;

export interface CreateResult {
  occurrence: Occurrence;
  replayed: boolean;
}

@Injectable()
export class OccurrencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Cria a ocorrência, o primeiro item da linha do tempo e o evento `occurrence.created`
   * numa única transação. Com `clientRequestId`, reenvios devolvem o registro original.
   */
  async create(user: AuthUser, dto: CreateOccurrenceDto): Promise<CreateResult> {
    if (dto.clientRequestId) {
      const existing = await this.findByClientRequest(user.id, dto.clientRequestId);
      if (existing) return { occurrence: existing, replayed: true };
    }
    try {
      const occurrence = await this.prisma.$transaction(async (tx) => {
        const created = await tx.occurrence.create({
          data: {
            title: dto.title,
            description: dto.description,
            address: dto.address,
            neighborhood: dto.neighborhood || null,
            latitude: dto.latitude,
            longitude: dto.longitude,
            severity: dto.severity,
            occurredAt: dto.occurredAt,
            clientRequestId: dto.clientRequestId,
            createdById: user.id,
          },
        });
        await tx.occurrenceStatusHistory.create({
          data: { occurrenceId: created.id, fromStatus: null, toStatus: 'PENDING', actorId: user.id },
        });
        await this.outbox.recordOccurrenceEvent(tx, RealtimeEvent.OCCURRENCE_CREATED, created);
        return created;
      });
      return { occurrence, replayed: false };
    } catch (error) {
      // Duas requisições idênticas simultâneas: a segunda perde na UNIQUE e devolve a primeira.
      if (dto.clientRequestId && error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.findByClientRequest(user.id, dto.clientRequestId);
        if (existing) return { occurrence: existing, replayed: true };
      }
      throw error;
    }
  }

  private findByClientRequest(userId: string, clientRequestId: string) {
    return this.prisma.occurrence.findUnique({
      where: { createdById_clientRequestId: { createdById: userId, clientRequestId } },
    });
  }

  /** Consulta do mapa: filtros + raio geográfico (PostGIS) + paginação. */
  async list(user: AuthUser, query: ListOccurrencesQuery) {
    const hasPoint = query.lat !== undefined && query.lng !== undefined;
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      throw new BadRequestException('Informe lat e lng juntos');
    }
    if (query.sort === 'distance' && !hasPoint) {
      throw new BadRequestException('Ordenação por distância requer lat e lng');
    }

    let statuses = query.status ?? ACTIVE_STATUSES;
    // Registros rejeitados só são visíveis para a moderação.
    if (!isPrivileged(user)) statuses = statuses.filter((s) => s !== 'REJECTED');
    if (statuses.length === 0) return { items: [], total: 0, page: query.page, limit: query.limit };

    const point = hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography` : null;
    const conditions: Prisma.Sql[] = [
      Prisma.sql`o.deleted_at IS NULL`,
      Prisma.sql`o.status::text = ANY(${statuses}::text[])`,
    ];
    if (point) conditions.push(Prisma.sql`ST_DWithin(o.location, ${point}, ${query.radius})`);
    if (query.severity?.length) conditions.push(Prisma.sql`o.severity::text = ANY(${query.severity}::text[])`);
    if (query.periodHours) {
      conditions.push(Prisma.sql`o.created_at >= now() - make_interval(hours => ${query.periodHours}::int)`);
    }
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(
        Prisma.sql`(o.title ILIKE ${pattern} OR o.address ILIKE ${pattern} OR o.neighborhood ILIKE ${pattern})`,
      );
    }
    const where = Prisma.join(conditions, ' AND ');
    const distance = point ? Prisma.sql`ST_Distance(o.location, ${point})` : Prisma.sql`NULL::float8`;
    const sort = query.sort ?? (hasPoint ? 'distance' : 'recent');
    const orderBy = sort === 'distance' ? Prisma.sql`distance_meters ASC, o.created_at DESC` : Prisma.sql`o.created_at DESC`;

    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<OccurrenceRow[]>`
        SELECT ${SUMMARY_COLUMNS}, ${distance} AS distance_meters
        FROM occurrences o
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM occurrences o WHERE ${where}`,
    ]);

    return { items: rows.map(toSummary), total: Number(total), page: query.page, limit: query.limit };
  }

  async findOne(user: AuthUser, id: string, lat?: number, lng?: number) {
    const o = await this.prisma.occurrence.findFirst({
      where: { id, deletedAt: null },
      include: {
        photos: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }] },
        history: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { role: true } } } },
        createdBy: { select: { name: true, status: true } },
        confirmations: { where: { userId: user.id }, select: { type: true } },
        savedBy: { where: { userId: user.id }, select: { userId: true } },
      },
    });
    const isMine = o?.createdById === user.id;
    if (!o || (o.status === 'REJECTED' && !isMine && !isPrivileged(user))) {
      throw new NotFoundException('Ocorrência não encontrada');
    }

    let distanceMeters: number | undefined;
    if (lat !== undefined && lng !== undefined) {
      const [row] = await this.prisma.$queryRaw<{ d: number }[]>`
        SELECT ST_Distance(location, ST_SetSRID(ST_MakePoint(${lng}, ${lat}), 4326)::geography) AS d
        FROM occurrences WHERE id = ${id}::uuid`;
      distanceMeters = Math.round(row.d);
    }

    return {
      id: o.id,
      code: o.code,
      title: o.title,
      description: o.description,
      address: o.address,
      neighborhood: o.neighborhood,
      latitude: o.latitude,
      longitude: o.longitude,
      severity: o.severity,
      status: o.status,
      occurredAt: o.occurredAt,
      createdAt: o.createdAt,
      updatedAt: o.updatedAt,
      validatedAt: o.validatedAt,
      resolvedAt: o.resolvedAt,
      confirmCount: o.confirmCount,
      contestCount: o.contestCount,
      isDemo: o.isDemo,
      isMine,
      isSaved: o.savedBy.length > 0,
      myConfirmation: o.confirmations[0]?.type ?? null,
      ...(distanceMeters !== undefined && { distanceMeters }),
      // Privacidade: apenas o primeiro nome de quem registrou.
      reporter: { firstName: o.createdBy.status === 'DELETED' ? null : o.createdBy.name.split(' ')[0] },
      moderationNote: isMine || isPrivileged(user) ? o.moderationNote : null,
      photos: o.photos.map((p) => ({ id: p.id, url: photoUrl(p.id), width: p.width, height: p.height })),
      history: o.history.map((h) => ({
        fromStatus: h.fromStatus,
        toStatus: h.toStatus,
        note: h.note,
        createdAt: h.createdAt,
        actor: h.actor && h.actor.role !== 'CITIZEN' ? 'MODERATION' : 'CITIZEN',
      })),
    };
  }

  async listMine(user: AuthUser, query: MyOccurrencesQuery) {
    const conditions: Prisma.Sql[] = [Prisma.sql`o.deleted_at IS NULL`, Prisma.sql`o.created_by_id = ${user.id}::uuid`];
    const statuses = MINE_STATUS[query.filter];
    if (statuses) conditions.push(Prisma.sql`o.status::text = ANY(${statuses}::text[])`);
    if (query.q) {
      const pattern = likePattern(query.q);
      conditions.push(Prisma.sql`(o.title ILIKE ${pattern} OR o.address ILIKE ${pattern} OR o.neighborhood ILIKE ${pattern})`);
    }
    const where = Prisma.join(conditions, ' AND ');
    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<OccurrenceRow[]>`
        SELECT ${SUMMARY_COLUMNS}, NULL::float8 AS distance_meters
        FROM occurrences o WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total FROM occurrences o WHERE ${where}`,
    ]);
    return { items: rows.map(toSummary), total: Number(total), page: query.page, limit: query.limit };
  }

  /** Cards de resumo da tela "Meus registros". */
  async mySummary(user: AuthUser) {
    const groups = await this.prisma.occurrence.groupBy({
      by: ['status'],
      where: { createdById: user.id, deletedAt: null },
      _count: { _all: true },
    });
    const count = (statuses: OccurrenceStatus[]) =>
      groups.filter((g) => statuses.includes(g.status)).reduce((sum, g) => sum + g._count._all, 0);
    return {
      total: groups.reduce((sum, g) => sum + g._count._all, 0),
      active: count(ACTIVE_STATUSES),
      pending: count(['PENDING', 'UNDER_REVIEW']),
      resolved: count(['RESOLVED']),
    };
  }

  /** O autor pode remover enquanto está pendente; o administrador, a qualquer momento. */
  async remove(user: AuthUser, id: string, ip?: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const o = await tx.occurrence.findFirst({ where: { id, deletedAt: null } });
      if (!o) throw new NotFoundException('Ocorrência não encontrada');
      const isAdmin = user.role === 'ADMIN';
      if (!isAdmin && (o.createdById !== user.id || o.status !== 'PENDING')) {
        throw new ForbiddenException('Somente ocorrências próprias e pendentes podem ser removidas');
      }
      const removed = await tx.occurrence.update({
        where: { id },
        data: { deletedAt: new Date(), version: { increment: 1 } },
      });
      await this.outbox.recordOccurrenceEvent(tx, RealtimeEvent.OCCURRENCE_REMOVED, removed);
      if (isAdmin && o.createdById !== user.id) {
        await this.audit.log(tx, {
          actorId: user.id,
          action: 'occurrence.removed',
          entityType: 'occurrence',
          entityId: id,
          before: { status: o.status, deletedAt: null },
          after: { deletedAt: removed.deletedAt },
          ipAddress: ip,
        });
      }
    });
  }

  async setSaved(user: AuthUser, id: string, saved: boolean): Promise<{ saved: boolean }> {
    await this.ensureVisible(user, id);
    if (saved) {
      await this.prisma.savedOccurrence.upsert({
        where: { userId_occurrenceId: { userId: user.id, occurrenceId: id } },
        update: {},
        create: { userId: user.id, occurrenceId: id },
      });
    } else {
      await this.prisma.savedOccurrence.deleteMany({ where: { userId: user.id, occurrenceId: id } });
    }
    return { saved };
  }

  /** Denúncia idempotente: repetir não cria duplicata. */
  async report(user: AuthUser, id: string, dto: ReportContentDto): Promise<void> {
    await this.ensureVisible(user, id);
    await this.prisma.contentReport.upsert({
      where: { occurrenceId_reporterId: { occurrenceId: id, reporterId: user.id } },
      update: { reason: dto.reason, details: dto.details ?? null },
      create: { occurrenceId: id, reporterId: user.id, reason: dto.reason, details: dto.details ?? null },
    });
  }

  private async ensureVisible(user: AuthUser, id: string): Promise<Occurrence> {
    const o = await this.prisma.occurrence.findFirst({ where: { id, deletedAt: null } });
    if (!o || (o.status === 'REJECTED' && o.createdById !== user.id && !isPrivileged(user))) {
      throw new NotFoundException('Ocorrência não encontrada');
    }
    return o;
  }
}
