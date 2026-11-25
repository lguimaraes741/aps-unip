import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { AccessTokenPayload } from '../common/auth/jwt-auth.guard';
import { PrismaService } from '../prisma/prisma.service';

export interface TokenPair {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Tokens de acesso (JWT curto) + refresh tokens opacos e rotativos.
 * - Apenas o SHA-256 do refresh token é armazenado.
 * - Cada renovação revoga o token usado e emite outro da mesma "família".
 * - Reuso de um token já revogado indica roubo: a família inteira é revogada.
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async issue(user: Pick<User, 'id' | 'role'>, userAgent?: string, familyId: string = randomUUID()): Promise<TokenPair> {
    const expiresIn = this.config.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS');
    const payload: AccessTokenPayload = { sub: user.id, role: user.role, typ: 'access' };
    const accessToken = await this.jwt.signAsync(payload, { expiresIn });
    const refreshToken = randomBytes(48).toString('base64url');
    const days = this.config.getOrThrow<number>('JWT_REFRESH_TTL_DAYS');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        userAgent: userAgent?.slice(0, 255),
        expiresAt: new Date(Date.now() + days * 86_400_000),
      },
    });
    return { accessToken, expiresIn, refreshToken };
  }

  /** Valida e rotaciona o refresh token. Retorna o usuário dono e o novo par. */
  async rotate(refreshToken: string, userAgent?: string): Promise<{ user: User; tokens: TokenPair }> {
    const invalid = new UnauthorizedException('Sessão expirada. Faça login novamente.');
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!stored) throw invalid;

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw invalid;
    }
    if (stored.expiresAt <= new Date() || stored.user.status !== 'ACTIVE') throw invalid;

    // Revogação condicional e atômica: se duas renovações concorrentes usarem o mesmo
    // token, apenas uma vence; a outra é tratada como reuso.
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count === 0) {
      await this.revokeFamily(stored.familyId);
      throw invalid;
    }
    const tokens = await this.issue(stored.user, userAgent, stored.familyId);
    return { user: stored.user, tokens };
  }

  async revokeByToken(refreshToken: string): Promise<void> {
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(refreshToken) } });
    if (stored) await this.revokeFamily(stored.familyId);
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }
}
