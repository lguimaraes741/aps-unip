import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { isStaffOnlyEvent, SyncResponse } from '@alertacidade/shared-types';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AuthUser, isPrivileged } from '../common/auth/auth-user';
import { CurrentUser } from '../common/auth/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { toEnvelope } from './outbox-publisher.service';

export class SyncQuery {
  @ApiPropertyOptional({ description: 'Último sequence processado pelo cliente. Omitir para obter só o cursor atual.' })
  @IsOptional()
  @Matches(/^\d{1,18}$/, { message: 'since deve ser um número inteiro não negativo' })
  since?: string;

  @ApiPropertyOptional({ default: 200, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit = 200;
}

@ApiTags('sync')
@ApiBearerAuth()
@Controller('sync')
export class SyncController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Eventos publicados depois de um cursor (ressincronização após desconexão)',
    description:
      'Sem `since`, devolve apenas o cursor atual. Com `since`, devolve os eventos com sequence maior, em ordem. ' +
      '`reset = true` indica que o cursor do cliente é maior que o do servidor (banco recriado): recarregue tudo. ' +
      'Eventos de moderação (`news.review.*`) só aparecem para MODERATOR/ADMIN; para os demais o cursor avança sobre eles.',
  })
  async sync(@CurrentUser() user: AuthUser, @Query() query: SyncQuery): Promise<SyncResponse & { reset: boolean }> {
    const [{ head }] = await this.prisma.$queryRaw<{ head: bigint }[]>`
      SELECT COALESCE(MAX(published_sequence), 0)::bigint AS head FROM domain_events`;
    if (query.since === undefined) return { events: [], cursor: head.toString(), hasMore: false, reset: false };

    const since = BigInt(query.since);
    if (since > head) return { events: [], cursor: head.toString(), hasMore: false, reset: true };

    const rows = await this.prisma.$queryRaw<{ id: string; type: string; payload: unknown; occurred_at: Date; published_sequence: bigint }[]>`
      SELECT id, type, payload, occurred_at, published_sequence
      FROM domain_events
      WHERE published_sequence > ${since}
      ORDER BY published_sequence
      LIMIT ${query.limit + 1}`;
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    // O cursor vem da página COMPLETA: quem não vê os eventos de moderação também avança sobre eles
    // (senão ficaria preso pedindo a mesma lacuna).
    const cursor = page.length > 0 ? page[page.length - 1].published_sequence.toString() : since.toString();
    const visible = isPrivileged(user) ? page : page.filter((r) => !isStaffOnlyEvent(r.type));
    return { events: visible.map(toEnvelope), cursor, hasMore, reset: false };
  }
}
