import { Controller, Get, Header, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ListNewsAlertsQuery } from './news-public.dto';
import { NewsPublicService } from './news-public.service';

/** Alertas de notícia publicados, para o app (qualquer usuário autenticado). */
@ApiTags('news')
@ApiBearerAuth()
@Controller('news')
export class NewsPublicController {
  constructor(private readonly news: NewsPublicService) {}

  @Get('events')
  @ApiOperation({
    summary: 'Alertas de notícia publicados (mapa e tela de notícias)',
    description: 'Só alertas publicados; retirados nunca aparecem. scope=active (padrão) = em vigor; scope=all inclui encerrados e expirados.',
  })
  list(@Query() query: ListNewsAlertsQuery) {
    return this.news.list(query);
  }

  @Get('filters')
  @ApiOperation({ summary: 'Opções dos filtros da tela de notícias: cidades monitoradas e fontes ativas' })
  filters() {
    return this.news.filters();
  }

  @Get('events/:id')
  @ApiOperation({ summary: 'Detalhes de um alerta de notícia com todas as fontes (inclui o motivo, se foi retirado)' })
  findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.news.findOne(id);
  }

  @Get('regions/:id/boundary')
  @Header('Cache-Control', 'private, max-age=86400')
  @ApiOperation({ summary: 'Contorno oficial (IBGE, simplificado) de uma região, em GeoJSON' })
  boundary(@Param('id', ParseUUIDPipe) id: string) {
    return this.news.boundary(id);
  }
}
