import { Injectable } from '@nestjs/common';
import { Occurrence, Prisma } from '@prisma/client';
import { OccurrenceEventPayload, RealtimeEvent } from '@alertacidade/shared-types';
import { Db } from '../common/prisma-tx';

/**
 * Transactional Outbox: o evento é gravado NA MESMA transação da alteração de negócio.
 * A publicação para Socket.IO e BullMQ é feita pelo publicador (Fase 4), lendo os
 * registros com published_at nulo — nenhuma alteração confirmada fica sem evento.
 */
@Injectable()
export class OutboxService {
  async recordOccurrenceEvent(db: Db, type: RealtimeEvent, occurrence: Occurrence): Promise<void> {
    const payload: OccurrenceEventPayload = {
      occurrenceId: occurrence.id,
      code: occurrence.code,
      severity: occurrence.severity,
      status: occurrence.status,
      latitude: occurrence.latitude,
      longitude: occurrence.longitude,
      neighborhood: occurrence.neighborhood,
      version: occurrence.version,
    };
    await db.domainEvent.create({
      data: {
        type,
        aggregateType: 'occurrence',
        aggregateId: occurrence.id,
        payload: payload as unknown as Prisma.InputJsonValue,
      },
    });
  }
}
