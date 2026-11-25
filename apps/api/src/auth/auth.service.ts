import { BadRequestException, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, User } from '@prisma/client';
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthResponse, LoginDto, RegisterDto, ResetPasswordDto } from './dto/auth.dto';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

const RESET_CODE_TTL_MS = 15 * 60_000;
const RESET_MAX_ATTEMPTS = 5;

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResponse> {
    const passwordHash = await this.passwords.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.$transaction(async (tx) => {
        const created = await tx.user.create({ data: { name: dto.name, email: dto.email, passwordHash } });
        await tx.notificationPreference.create({ data: { userId: created.id } });
        await this.audit.log(tx, {
          actorId: created.id,
          action: 'user.registered',
          entityType: 'user',
          entityId: created.id,
          after: { role: created.role },
          ipAddress: meta.ip,
        });
        return created;
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Não foi possível concluir o cadastro com este e-mail');
      }
      throw error;
    }
    return this.buildResponse(user, meta);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    const valid = await this.passwords.verify(user?.deletedAt ? null : user?.passwordHash, dto.password);
    if (!user || !valid || user.status === 'DELETED') {
      throw new UnauthorizedException('E-mail ou senha incorretos');
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('Conta suspensa. Entre em contato com a administração da plataforma.');
    }
    await this.prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    return this.buildResponse(user, meta);
  }

  async refresh(refreshToken: string, meta: RequestMeta): Promise<AuthResponse> {
    const { user, tokens } = await this.tokens.rotate(refreshToken, meta.userAgent);
    return { ...tokens, user: this.view(user) };
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revokeByToken(refreshToken);
  }

  /** Sempre responde igual, exista ou não a conta (não revela e-mails cadastrados). */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.status !== 'ACTIVE') return;

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    await this.prisma.$transaction([
      // Um novo pedido invalida códigos anteriores.
      this.prisma.passwordResetToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } }),
      this.prisma.passwordResetToken.create({
        data: { userId: user.id, codeHash: this.hashCode(user.id, code), expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) },
      }),
    ]);
    await this.mail.send(
      user.email,
      'AlertaCidade — código de recuperação de senha',
      `Seu código de recuperação é ${code}. Ele expira em 15 minutos.\nSe você não solicitou, ignore esta mensagem.`,
    );
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    const invalid = new BadRequestException('Código inválido ou expirado');
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.status !== 'ACTIVE') throw invalid;

    const token = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (!token || token.attempts >= RESET_MAX_ATTEMPTS) throw invalid;

    const expected = Buffer.from(token.codeHash, 'hex');
    const received = Buffer.from(this.hashCode(user.id, dto.code), 'hex');
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      await this.prisma.passwordResetToken.update({ where: { id: token.id }, data: { attempts: { increment: 1 } } });
      throw invalid;
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    await this.prisma.$transaction(async (tx) => {
      // Marca como usado apenas se ainda não foi usado (evita uso duplo concorrente).
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw invalid;
      await tx.user.update({ where: { id: user.id }, data: { passwordHash } });
      await tx.refreshToken.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await this.audit.log(tx, {
        actorId: user.id,
        action: 'user.password_reset',
        entityType: 'user',
        entityId: user.id,
        ipAddress: meta.ip,
      });
    });
  }

  private hashCode(userId: string, code: string): string {
    return createHmac('sha256', this.config.getOrThrow<string>('JWT_ACCESS_SECRET')).update(`${userId}:${code}`).digest('hex');
  }

  private async buildResponse(user: User, meta: RequestMeta): Promise<AuthResponse> {
    const tokens = await this.tokens.issue(user, meta.userAgent);
    return { ...tokens, user: this.view(user) };
  }

  private view(user: User) {
    return { id: user.id, name: user.name, email: user.email, role: user.role };
  }
}
