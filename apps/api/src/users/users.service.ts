import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { PasswordService } from '../auth/password.service';
import { PrismaService } from '../prisma/prisma.service';
import { ChangePasswordDto, ListUsersQuery, NotificationPreferencesDto } from './dto/users.dto';

const PROFILE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  status: true,
  createdAt: true,
  lastLoginAt: true,
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async me(userId: string) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null }, select: PROFILE_SELECT });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
  }

  async updateProfile(userId: string, name: string) {
    await this.me(userId);
    return this.prisma.user.update({ where: { id: userId }, data: { name }, select: PROFILE_SELECT });
  }

  async changePassword(userId: string, dto: ChangePasswordDto, ip?: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user || !(await this.passwords.verify(user.passwordHash, dto.currentPassword))) {
      throw new UnauthorizedException('Senha atual incorreta');
    }
    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Encerra as demais sessões; o app obtém novos tokens com login.
      await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, { actorId: userId, action: 'user.password_changed', entityType: 'user', entityId: userId, ipAddress: ip });
    });
  }

  async getPreferences(userId: string) {
    const pref = await this.prisma.notificationPreference.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: { pushEnabled: true, radiusMeters: true, minSeverity: true, latitude: true, longitude: true, updatedAt: true },
    });
    return pref;
  }

  async updatePreferences(userId: string, dto: NotificationPreferencesDto) {
    const data = {
      pushEnabled: dto.pushEnabled,
      radiusMeters: dto.radiusMeters,
      minSeverity: dto.minSeverity,
      latitude: dto.latitude ?? null,
      longitude: dto.longitude ?? null,
    };
    return this.prisma.notificationPreference.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
      select: { pushEnabled: true, radiusMeters: true, minSeverity: true, latitude: true, longitude: true, updatedAt: true },
    });
  }

  /** LGPD art. 18 — portabilidade: todos os dados pessoais do titular em formato estruturado. */
  async exportData(userId: string) {
    const [profile, preferences, occurrences, confirmations, saved, notifications] = await Promise.all([
      this.me(userId),
      this.prisma.notificationPreference.findUnique({ where: { userId } }),
      this.prisma.occurrence.findMany({
        where: { createdById: userId },
        select: { id: true, code: true, title: true, description: true, address: true, latitude: true, longitude: true, severity: true, status: true, occurredAt: true, createdAt: true },
      }),
      this.prisma.confirmation.findMany({ where: { userId }, select: { occurrenceId: true, type: true, createdAt: true } }),
      this.prisma.savedOccurrence.findMany({ where: { userId }, select: { occurrenceId: true, createdAt: true } }),
      this.prisma.notification.findMany({ where: { userId }, select: { title: true, body: true, createdAt: true, readAt: true } }),
    ]);
    return {
      exportedAt: new Date().toISOString(),
      profile,
      notificationPreferences: preferences && {
        pushEnabled: preferences.pushEnabled,
        radiusMeters: preferences.radiusMeters,
        minSeverity: preferences.minSeverity,
        latitude: preferences.latitude,
        longitude: preferences.longitude,
      },
      occurrences,
      confirmations,
      savedOccurrences: saved,
      notifications,
    };
  }

  /**
   * LGPD art. 18 — eliminação: anonimiza a conta imediatamente.
   * Os relatos permanecem (interesse público) sem autoria identificável.
   */
  async deleteAccount(userId: string, password: string, ip?: string): Promise<void> {
    const user = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null } });
    if (!user || !(await this.passwords.verify(user.passwordHash, password))) {
      throw new UnauthorizedException('Senha incorreta');
    }
    const unusableHash = await this.passwords.hash(randomBytes(32).toString('hex'));
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: 'Usuário removido',
          email: `removido-${userId}@anonimo.invalid`,
          passwordHash: unusableHash,
          avatarUrl: null,
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });
      await tx.refreshToken.deleteMany({ where: { userId } });
      await tx.passwordResetToken.deleteMany({ where: { userId } });
      await tx.deviceToken.deleteMany({ where: { userId } });
      await tx.notificationPreference.deleteMany({ where: { userId } });
      await tx.notification.deleteMany({ where: { userId } });
      await tx.savedOccurrence.deleteMany({ where: { userId } });
      await this.audit.log(tx, { actorId: userId, action: 'user.deleted_self', entityType: 'user', entityId: userId, ipAddress: ip });
    });
  }

  async list(query: ListUsersQuery) {
    const where: Prisma.UserWhereInput = {
      role: query.role,
      status: query.status,
      ...(query.q && {
        OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }],
      }),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: PROFILE_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }
}
