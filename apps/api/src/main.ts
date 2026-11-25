import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = app.get(ConfigService).get<number>('API_PORT', 3000);
  await app.listen(port);
  const logger = new Logger('Bootstrap');
  logger.log(`API em http://localhost:${port}/api/v1 — Swagger em http://localhost:${port}/api/docs`);
}

void bootstrap();
