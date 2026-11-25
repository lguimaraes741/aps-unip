import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { GovernanceService } from './governance.service';
import { csvCell } from './statistics.service';

describe('csvCell (exportação CSV)', () => {
  it('neutraliza fórmulas no início da célula', () => {
    for (const evil of ['=1+1', '+5+cmd|x', '-2+3+cmd|\' /C calc\'!A0', '@SUM(A1)', '\tx', '\rx']) {
      expect(csvCell(evil).replace(/^"|"$/g, '').startsWith("'")).toBe(true);
    }
  });

  it('números puros (latitude negativa) continuam números', () => {
    expect(csvCell('-23.550520')).toBe('-23.550520');
    expect(csvCell(-46.6333)).toBe('-46.6333');
    expect(csvCell('+5')).toBe('+5');
  });

  it('escapa aspas e protege separador e quebras de linha', () => {
    expect(csvCell('Rua "A"; 10')).toBe('"Rua ""A""; 10"');
    expect(csvCell('linha1\nlinha2')).toBe('"linha1\nlinha2"');
    expect(csvCell('Sé')).toBe('Sé');
    expect(csvCell(null)).toBe('');
  });
});

describe('GovernanceService: último administrador', () => {
  const build = (target: { role: string; status: string }, activeAdmins: number) => {
    const tx = {
      user: {
        findUnique: jest.fn().mockResolvedValue({ id: 'alvo', ...target }),
        count: jest.fn().mockResolvedValue(activeAdmins),
        update: jest.fn().mockResolvedValue({ id: 'alvo', role: 'CITIZEN', status: 'ACTIVE' }),
      },
      refreshToken: { updateMany: jest.fn() },
    };
    const prisma = { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) } as unknown as PrismaService;
    const audit = { log: jest.fn() } as unknown as AuditService;
    return { service: new GovernanceService(prisma, audit), tx, audit };
  };
  const actor = { id: 'admin-1', role: 'ADMIN' as const };

  it('não rebaixa nem suspende o último ADMIN ativo', async () => {
    await expect(build({ role: 'ADMIN', status: 'ACTIVE' }, 1).service.updateUser(actor, 'alvo', { role: 'MODERATOR' })).rejects.toBeInstanceOf(ConflictException);
    await expect(build({ role: 'ADMIN', status: 'ACTIVE' }, 1).service.updateUser(actor, 'alvo', { status: 'SUSPENDED' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('com outro ADMIN ativo, permite e audita', async () => {
    const { service, tx, audit } = build({ role: 'ADMIN', status: 'ACTIVE' }, 2);
    await service.updateUser(actor, 'alvo', { role: 'CITIZEN' });
    expect(tx.user.update).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(tx, expect.objectContaining({ action: 'user.updated_by_admin', before: { role: 'ADMIN', status: 'ACTIVE' } }));
  });

  it('suspender revoga as sessões; alterar a si mesmo é proibido', async () => {
    const { service, tx } = build({ role: 'CITIZEN', status: 'ACTIVE' }, 5);
    await service.updateUser(actor, 'alvo', { status: 'SUSPENDED' });
    expect(tx.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'alvo', revokedAt: null } }));
    await expect(service.updateUser(actor, 'admin-1', { role: 'CITIZEN' })).rejects.toBeInstanceOf(ForbiddenException);
  });
});
