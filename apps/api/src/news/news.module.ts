import { Module } from '@nestjs/common';
import { NewsAdminController, NewsSourcesAdminController } from './news-admin.controller';
import { NewsAdminService } from './news-admin.service';
import { NewsPublicController } from './news-public.controller';
import { NewsPublicService } from './news-public.service';

/**
 * News Intelligence (Fase 7) na API: moderação e operação das fontes (admin) e leitura dos alertas
 * publicados (app). A coleta e a análise rodam no news-worker.
 */
@Module({
  controllers: [NewsAdminController, NewsSourcesAdminController, NewsPublicController],
  providers: [NewsAdminService, NewsPublicService],
})
export class NewsModule {}
