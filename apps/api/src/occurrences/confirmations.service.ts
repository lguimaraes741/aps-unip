import { ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ConfirmationType, OccurrenceStatus, Prisma } from '@prisma/client';
import { RealtimeEvent } from '@alertacidade/shared-types';
import { AuthUser } from '../common/auth/auth-user';
import { OutboxService } from '../events/outbox.service';
import { PrismaService } from '../prisma/prisma.service';

const OPEN_FOR_CONFIRMATION: OccurrenceStatus[] = ['PENDING', 'UNDER_REVIEW', 'VALIDATED'];

export interface ConfirmationState {
  confirmCount: number;
  contestCount: number;
  myConfirmation: ConfirmationType | null;
}

/**
 * Confirmar/contestar. Cada usuário mantém no máximo UMA manifestação ativa por ocorrência
 * (UNIQUE no banco). A linha da ocorrência é bloqueada (SELECT … FOR UPDATE) durante a
 * transação, serializando manifestações concorrentes e mantendo os contadores exatos.
 */
@Injectable()
export class ConfirmationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async set(user: AuthUser, occurrenceId: string, type: ConfirmationType | null): Promise<ConfirmationState> {
    return this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<{ created_by_id: string; status: OccurrenceStatus }[]>`
        SELECT created_by_id, status::text AS status FROM occurrences
        WHERE id = ${occurrenceId}::uuid AND deleted_at IS NULL
        FOR UPDATE`;
      if (!locked || locked.status === 'REJECTED') throw new NotFoundException('Ocorrência não encontrada');
      if (locked.created_by_id === user.id) {
        throw new ForbiddenException('Você não pode confirmar ou contestar a própria ocorrência');
      }
      if (type && !OPEN_FOR_CONFIRMATION.includes(locked.status)) {
        throw new UnprocessableEntityException('Esta ocorrência não aceita mais confirmações');
      }

      const existing = await tx.confirmation.findUnique({
        where: { occurrenceId_userId: { occurrenceId, userId: user.id } },
      });
      const delta = { confirm: 0, contest: 0 };
      const bump = (t: ConfirmationType, n: number) => (t === 'CONFIRM' ? (delta.confirm += n) : (delta.contest += n));

      if (existing?.type === type) {
        // Idempotente: repetir a mesma manifestação não altera nada.
      } else {
        if (existing) {
          bump(existing.type, -1);
          if (type) await tx.confirmation.update({ where: { id: existing.id }, data: { type } });
          else await tx.confirmation.delete({ where: { id: existing.id } });
        } else if (type) {
          await tx.confirmation.create({ data: { occurrenceId, userId: user.id, type } });
        }
        if (type) bump(type, 1);
      }

      const data: Prisma.OccurrenceUpdateInput = {};
      if (delta.confirm) data.confirmCount = { increment: delta.confirm };
      if (delta.contest) data.contestCount = { increment: delta.contest };
      const occurrence =
        Object.keys(data).length > 0
          ? await tx.occurrence.update({ where: { id: occurrenceId }, data })
          : await tx.occurrence.findUniqueOrThrow({ where: { id: occurrenceId } });

      if (Object.keys(data).length > 0) {
        await this.outbox.recordOccurrenceEvent(tx, RealtimeEvent.OCCURRENCE_UPDATED, occurrence);
      }
      return { confirmCount: occurrence.confirmCount, contestCount: occurrence.contestCount, myConfirmation: type };
    });
  }
}
