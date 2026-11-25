/**
 * Garante que os enums do pacote compartilhado (usado por painel e worker)
 * coincidem com os enums reais do banco (schema Prisma).
 */
import { Prisma } from '@prisma/client';
import * as shared from '@alertacidade/shared-types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ENUMS = [
  'UserRole',
  'UserStatus',
  'Severity',
  'OccurrenceStatus',
  'ConfirmationType',
  'NotificationType',
  'DeliveryStatus',
  'ReportStatus',
  'DevicePlatform',
  'NewsEventStatus',
  'NewsConfidence',
  'LocationPrecision',
  'NewsSourceReliability',
] as const;

function prismaEnumValues(name: string): string[] {
  const schema = readFileSync(resolve(__dirname, '../prisma/schema.prisma'), 'utf8');
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(schema);
  if (!block) throw new Error(`enum ${name} não encontrado no schema`);
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('@@') && !l.startsWith('//'));
}

describe('Contratos compartilhados x schema do banco', () => {
  it.each(ENUMS)('%s tem os mesmos valores', (name) => {
    const sharedValues = Object.values((shared as unknown as Record<string, Record<string, string>>)[name]);
    expect(sharedValues).toEqual(prismaEnumValues(name));
  });

  it('transições de eventos de notícia cobrem todos os status', () => {
    expect(Object.keys(shared.NEWS_EVENT_TRANSITIONS).sort()).toEqual(Object.values(shared.NewsEventStatus).sort());
  });

  it('transições de status cobrem todos os status', () => {
    expect(Object.keys(shared.STATUS_TRANSITIONS).sort()).toEqual(Object.values(shared.OccurrenceStatus).sort());
  });

  it('o client Prisma gerado conhece todos os modelos obrigatórios', () => {
    const models = Object.values(Prisma.ModelName);
    for (const m of ['User', 'Occurrence', 'OccurrencePhoto', 'Confirmation', 'NotificationPreference', 'Notification', 'AuditLog']) {
      expect(models).toContain(m);
    }
  });
});
