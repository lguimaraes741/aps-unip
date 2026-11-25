import { Body, Controller, Get, Header, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { ReqMeta, RequestMetaValue } from '../common/http/request-meta';
import {
  AdminOccurrencesQuery,
  AuditQuery,
  ChangeStatusDto,
  ContentReportsQuery,
  ExportQuery,
  PeriodQuery,
  ResolveReportDto,
  UpdateUserAdminDto,
} from './admin.dto';
import { GovernanceService } from './governance.service';
import { ModerationService } from './moderation.service';
import { StatisticsService } from './statistics.service';

/** Moderação, indicadores e relatórios: MODERATOR e ADMIN. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('MODERATOR', 'ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly statistics: StatisticsService,
  ) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Indicadores do painel (status, fila de moderação, denúncias, séries de 14 dias)' })
  dashboard() {
    return this.statistics.dashboard();
  }

  @Get('occurrences')
  @ApiOperation({ summary: 'Todas as ocorrências (inclusive rejeitadas) com filtros, autor e denúncias abertas' })
  list(@Query() query: AdminOccurrencesQuery) {
    return this.moderation.list(query);
  }

  @Get('occurrences/:id')
  @ApiOperation({ summary: 'Análise: fotos, histórico com autores, denúncias e transições permitidas' })
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.moderation.detail(user, id);
  }

  @Post('occurrences/:id/status')
  @ApiOperation({ summary: 'Modera (valida, rejeita, resolve…) com controle otimista por versão; reflete no app em tempo real' })
  changeStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ChangeStatusDto,
    @ReqMeta() meta: RequestMetaValue,
  ) {
    return this.moderation.changeStatus(user, id, dto, meta.ip);
  }

  @Get('content-reports')
  @ApiOperation({ summary: 'Denúncias de conteúdo (padrão: abertas, mais antigas primeiro)' })
  reports(@Query() query: ContentReportsQuery) {
    return this.moderation.listReports(query);
  }

  @Post('content-reports/:id/resolve')
  @ApiOperation({ summary: 'Encerra uma denúncia como procedente (REVIEWED) ou improcedente (DISMISSED)' })
  resolveReport(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveReportDto,
    @ReqMeta() meta: RequestMetaValue,
  ) {
    return this.moderation.resolveReport(user, id, dto.status, meta.ip);
  }

  @Get('statistics')
  @ApiOperation({ summary: 'Relatório do período [from, to): totais, por status, gravidade, bairro e dia (fuso America/Sao_Paulo)' })
  stats(@Query() query: PeriodQuery) {
    return this.statistics.statistics(query);
  }

  @Get('exports/occurrences.csv')
  @ApiProduces('text/csv')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exporta as ocorrências do período em CSV (separador ";", UTF-8 com BOM)' })
  async export(@Query() query: ExportQuery, @Res() res: Response) {
    const { filename, content } = await this.statistics.exportCsv(query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(content);
  }
}

/** Governança: somente ADMIN. */
@ApiTags('admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class GovernanceController {
  constructor(private readonly governance: GovernanceService) {}

  @Get('audit')
  @ApiOperation({ summary: 'Trilha de auditoria (quem, o quê, antes/depois, IP)' })
  audit(@Query() query: AuditQuery) {
    return this.governance.auditTrail(query);
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Altera perfil e/ou suspende/reativa uma conta (auditado)' })
  updateUser(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserAdminDto,
    @ReqMeta() meta: RequestMetaValue,
  ) {
    return this.governance.updateUser(user, id, dto, meta.ip);
  }
}
