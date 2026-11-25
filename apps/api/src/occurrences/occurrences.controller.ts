import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser } from '../common/auth/decorators';
import { ReqMeta, RequestMetaValue } from '../common/http/request-meta';
import { ConfirmationsService } from './confirmations.service';
import {
  ConfirmationDto,
  CreateOccurrenceDto,
  GeoQuery,
  ListOccurrencesQuery,
  MyOccurrencesQuery,
  OccurrenceSummaryView,
  ReportContentDto,
} from './dto/occurrences.dto';
import { OccurrencesService } from './occurrences.service';

@ApiTags('occurrences')
@ApiBearerAuth()
@Controller('occurrences')
export class OccurrencesController {
  constructor(
    private readonly occurrences: OccurrencesService,
    private readonly confirmations: ConfirmationsService,
  ) {}

  @Post()
  @ApiOperation({
    summary: 'Registra uma ocorrência',
    description: 'Idempotente com clientRequestId: um reenvio retorna 200 e o cabeçalho Idempotent-Replayed: true.',
  })
  @ApiCreatedResponse({ description: 'Ocorrência criada (status PENDING)' })
  async create(@CurrentUser() user: AuthUser, @Body() dto: CreateOccurrenceDto, @Res({ passthrough: true }) res: Response) {
    const { occurrence, replayed } = await this.occurrences.create(user, dto);
    if (replayed) {
      res.status(HttpStatus.OK);
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return this.occurrences.findOne(user, occurrence.id);
  }

  @Get()
  @ApiOperation({ summary: 'Lista ocorrências (mapa): raio geográfico, gravidade, status, período e busca' })
  @ApiOkResponse({ type: OccurrenceSummaryView, isArray: true })
  list(@CurrentUser() user: AuthUser, @Query() query: ListOccurrencesQuery) {
    return this.occurrences.list(user, query);
  }

  @Get('mine')
  @ApiOperation({ summary: 'Meus registros' })
  mine(@CurrentUser() user: AuthUser, @Query() query: MyOccurrencesQuery) {
    return this.occurrences.listMine(user, query);
  }

  @Get('mine/summary')
  @ApiOperation({ summary: 'Totais da tela Meus registros (enviados, ativos, pendentes, resolvidos)' })
  mySummary(@CurrentUser() user: AuthUser) {
    return this.occurrences.mySummary(user);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalhes, fotos, linha do tempo e minha manifestação' })
  findOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() geo: GeoQuery) {
    return this.occurrences.findOne(user, id, geo.lat, geo.lng);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove ocorrência própria pendente (ou qualquer uma, se administrador)' })
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ReqMeta() meta: RequestMetaValue) {
    await this.occurrences.remove(user, id, meta.ip);
  }

  @Put(':id/confirmation')
  @ApiOperation({ summary: 'Confirma ou contesta (substitui a manifestação anterior do usuário)' })
  confirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ConfirmationDto) {
    return this.confirmations.set(user, id, dto.type);
  }

  @Delete(':id/confirmation')
  @ApiOperation({ summary: 'Retira a manifestação do usuário' })
  unconfirm(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.confirmations.set(user, id, null);
  }

  @Put(':id/save')
  @ApiOperation({ summary: 'Salva a ocorrência' })
  save(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.occurrences.setSaved(user, id, true);
  }

  @Delete(':id/save')
  @ApiOperation({ summary: 'Remove dos salvos' })
  unsave(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.occurrences.setSaved(user, id, false);
  }

  @Post(':id/reports')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Denuncia conteúdo inadequado' })
  async report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: ReportContentDto) {
    await this.occurrences.report(user, id, dto);
  }
}
