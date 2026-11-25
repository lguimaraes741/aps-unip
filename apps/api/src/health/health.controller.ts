import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/auth/decorators';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';

export interface HealthReport {
  /** degraded: banco ok, mas Redis fora — REST funciona; tempo real e push ficam em espera. */
  status: 'ok' | 'degraded';
  environment: string;
  version: string;
  checks: { database: 'up'; postgis: string; redis: 'up' | 'down' };
  timestamp: string;
}

@ApiTags('health')
@Public()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Verifica a API, a conexão com o PostgreSQL e a extensão PostGIS' })
  async check(): Promise<HealthReport> {
    try {
      const [row] = await this.prisma.$queryRaw<{ postgis: string }[]>`SELECT postgis_lib_version() AS postgis`;
      const redis = await this.pingRedis();
      return {
        status: redis === 'up' ? 'ok' : 'degraded',
        environment: this.config.get<string>('APP_ENV', 'development'),
        version: process.env.npm_package_version ?? '2.0.0',
        checks: { database: 'up', postgis: row.postgis, redis },
        timestamp: new Date().toISOString(),
      };
    } catch {
      // Mensagem genérica: detalhes da falha ficam apenas no log do servidor.
      throw new ServiceUnavailableException({ status: 'error', checks: { database: 'down' } });
    }
  }

  private async pingRedis(): Promise<'up' | 'down'> {
    try {
      const pong = await Promise.race([
        this.redis.ping(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000).unref()),
      ]);
      return pong === 'PONG' ? 'up' : 'down';
    } catch {
      return 'down';
    }
  }
}
