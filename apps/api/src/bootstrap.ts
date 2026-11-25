import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { PrismaExceptionFilter } from './common/filters/prisma-exception.filter';
import { validationExceptionFactory } from './common/http/validation-exception.factory';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

export const API_PREFIX = 'api/v1';

/** Configuração compartilhada entre main.ts e os testes e2e (mesmo comportamento nos dois). */
export function configureApp(app: INestApplication): void {
  const config = app.get(ConfigService);
  app.setGlobalPrefix(API_PREFIX);

  // Cabeçalhos de segurança. As fotos precisam ser exibidas pelo painel em outra origem.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.enableCors({
    origin: config.get<string[]>('CORS_ORIGINS'),
    credentials: true,
    exposedHeaders: ['Idempotent-Replayed'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // remove campos não declarados nos DTOs
      forbidNonWhitelisted: true, // e rejeita a requisição se existirem
      transform: true,
      stopAtFirstError: false,
      exceptionFactory: validationExceptionFactory,
    }),
  );
  app.useGlobalFilters(new PrismaExceptionFilter());
  // Socket.IO com Redis: eventos chegam a clientes conectados em qualquer instância.
  app.useWebSocketAdapter(new RedisIoAdapter(app));
  app.enableShutdownHooks();

  // Documentação interativa só fora de produção (ou se ligada explicitamente): em produção ela
  // exporia o mapa completo da API, inclusive as rotas administrativas.
  if (!config.get<boolean>('SWAGGER_ENABLED')) return;
  const swagger = new DocumentBuilder()
    .setTitle('AlertaCidade API')
    .setDescription(
      'API da plataforma colaborativa de monitoramento de alagamentos urbanos. ' +
        'Relatos de cidadãos não constituem informação oficial nem substituem serviços de emergência (Defesa Civil 199 / Bombeiros 193).',
    )
    .setVersion('2.0.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swagger));
}
