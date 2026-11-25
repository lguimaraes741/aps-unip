import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Db } from '../common/prisma-tx';

export interface AuditEntry {
  actorId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  ipAddress?: string | null;
}

/** Campos que nunca devem aparecer na trilha de auditoria. */
const SENSITIVE_KEYS = new Set(['passwordHash', 'password', 'tokenHash', 'codeHash', 'token']);

function redact(value: Record<string, unknown> | null | undefined): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  if (!value) return Prisma.JsonNull;
  const clean: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (!SENSITIVE_KEYS.has(k)) clean[k] = v instanceof Date ? v.toISOString() : v;
  }
  return clean as Prisma.InputJsonValue;
}

@Injectable()
export class AuditService {
  /** Grava na transação do chamador: a auditoria só existe se a operação for confirmada. */
  async log(db: Db, entry: AuditEntry): Promise<void> {
    await db.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        before: redact(entry.before),
        after: redact(entry.after),
        ipAddress: entry.ipAddress ?? null,
      },
    });
  }
}
