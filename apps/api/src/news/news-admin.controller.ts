import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthUser } from '../common/auth/auth-user';
import { CurrentUser, Roles } from '../common/auth/decorators';
import { ReqMeta, RequestMetaValue } from '../common/http/request-meta';
import {
  CollectionsQuery,
  MergeNewsEventDto,
  NewsDecisionDto,
  NewsReviewQuery,
  RequestCollectionDto,
  UpdateNewsEventDto,
  UpdateNewsSourceDto,
} from './news-admin.dto';
import { NewsAdminService } from './news-admin.service';

/** Monitoramento de notícias — moderação: MODERATOR e ADMIN. */
@ApiTags('admin-news')
@ApiBearerAuth()
@Roles('MODERATOR', 'ADMIN')
@Controller('admin/news')
export class NewsAdminController {
  constructor(private readonly news: NewsAdminService) {}

  @Get('metrics')
  @ApiOperation({ summary: 'Indicadores: notícias coletadas/relevantes, eventos por status, gravidade, fontes e falhas de coleta' })
  metrics() {
    return this.news.metrics();
  }

  @Get('review')
  @ApiOperation({ summary: 'Fila de moderação de eventos (padrão: não finais; urgentes primeiro) com filtros' })
  review(@Query() query: NewsReviewQuery) {
    return this.news.review(query);
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Análise do evento: fontes, evidências literais, decisão automática e auditoria' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.news.detail(id);
  }

  @Patch('events/:id')
  @ApiOperation({ summary: 'Corrige título, gravidade e/ou localização (controle otimista; auditado)' })
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNewsEventDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.update(user, id, dto, meta.ip);
  }

  @Post('events/:id/approve')
  @ApiOperation({ summary: 'Valida (publicado verificado). Exige localização conhecida' })
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewsDecisionDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.approve(user, id, dto, meta.ip);
  }

  @Post('events/:id/reject')
  @ApiOperation({ summary: 'Descarta (exige motivo)' })
  reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewsDecisionDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.reject(user, id, dto, meta.ip);
  }

  @Post('events/:id/resolve')
  @ApiOperation({ summary: 'Encerra o alerta (situação normalizada)' })
  resolve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NewsDecisionDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.resolve(user, id, dto, meta.ip);
  }

  @Post('events/:id/merge')
  @ApiOperation({ summary: 'Marca como duplicado: fontes passam para outro evento, que é recalculado pelo news-worker' })
  merge(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MergeNewsEventDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.merge(user, id, dto, meta.ip);
  }

  @Get('regions')
  @ApiOperation({ summary: 'Cidades e distritos monitorados (para corrigir a localização de um evento)' })
  regions() {
    return this.news.regions();
  }

  @Get('sources')
  @ApiOperation({ summary: 'Fontes monitoradas com saúde (última coleta, falhas seguidas, próxima tentativa)' })
  sources() {
    return this.news.sources();
  }

  @Get('collections')
  @ApiOperation({ summary: 'Histórico de coletas (filtrável por status e fonte)' })
  collections(@Query() query: CollectionsQuery) {
    return this.news.collections(query);
  }

  @Post('collect')
  @ApiOperation({ summary: 'Pede coleta imediata de uma fonte (ou de todas as ligadas) ao news-worker' })
  collect(@CurrentUser() user: AuthUser, @Body() dto: RequestCollectionDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.requestCollection(user, dto.sourceId, meta.ip);
  }
}

/** Liga/desliga fontes: somente ADMIN (decisão sobre termos de uso e carga nas fontes). */
@ApiTags('admin-news')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/news')
export class NewsSourcesAdminController {
  constructor(private readonly news: NewsAdminService) {}

  @Patch('sources/:id')
  @ApiOperation({ summary: 'Liga/desliga uma fonte (exige termos conferidos para ligar; auditado)' })
  updateSource(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNewsSourceDto, @ReqMeta() meta: RequestMetaValue) {
    return this.news.updateSource(user, id, dto.enabled, meta.ip);
  }
}
