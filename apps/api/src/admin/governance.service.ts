import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuthUser } from '../common/auth/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import { AuditQuery, UpdateUserAdminDto } from './admin.dto';

/** Trilha de auditoria e gestão de perfis/suspensões (somente ADMIN). */
@Injectable()
export class GovernanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async auditTrail(query: AuditQuery) {
    const where: Prisma.AuditLogWhereInput = {
      entityType: query.entityType,
      entityId: query.entityId,
      actorId: query.actorId,
      action: query.action,
      ...((query.from || query.to) && { createdAt: { gte: query.from, lt: query.to } }),
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        include: { actor: { select: { id: true, name: true, role: true } } },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { items: rows, total, page: query.page, limit: query.limit };
  }

  /**
   * Altera perfil e/ou situação de uma conta.
   * Regras: ninguém altera a própria conta por aqui (evita se trancar fora); o último
   * administrador ativo não pode ser rebaixado nem suspenso; suspender encerra as sessões
   * (refresh tokens revogados — o access token expira em até JWT_ACCESS_TTL).
   */
  async updateUser(actor: AuthUser, id: string, dto: UpdateUserAdminDto, ip?: string) {
    if (dto.role === undefined && dto.status === undefined) throw new UnprocessableEntityException('Nada para alterar');
    if (id === actor.id) throw new ForbiddenException('Você não pode alterar o próprio perfil ou a própria situação');

    return this.prisma.$transaction(
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id } });
        if (!user || user.status === 'DELETED') throw new NotFoundException('Usuário não encontrado');

        const losesAdmin = user.role === 'ADMIN' && user.status === 'ACTIVE' && ((dto.role && dto.role !== 'ADMIN') || dto.status === 'SUSPENDED');
        if (losesAdmin) {
          const activeAdmins = await tx.user.count({ where: { role: 'ADMIN', status: 'ACTIVE' } });
          if (activeAdmins <= 1) throw new ConflictException('Não é possível remover o último administrador ativo');
        }

        const updated = await tx.user.update({
          where: { id },
          data: { role: dto.role, status: dto.status },
          select: { id: true, name: true, email: true, role: true, status: true, createdAt: true, lastLoginAt: true },
        });
        if (dto.status === 'SUSPENDED' && user.status !== 'SUSPENDED') {
          await tx.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
        }
        await this.audit.log(tx, {
          actorId: actor.id,
          action: 'user.updated_by_admin',
          entityType: 'user',
          entityId: id,
          before: { role: user.role, status: user.status },
          after: { role: updated.role, status: updated.status },
          ipAddress: ip,
        });
        return updated;
      },
      // Serializável: dois admins rebaixando um ao outro ao mesmo tempo não podem zerar os administradores.
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }
}
