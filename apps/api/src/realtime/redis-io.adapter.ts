import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import { Server, ServerOptions } from 'socket.io';
import { closeRedis, REDIS_PUB, REDIS_SUB } from '../redis/redis.module';

/**
 * Adaptador Socket.IO com Redis pub/sub: um evento emitido por qualquer instância da API
 * chega aos clientes conectados em todas as outras (escala horizontal).
 * Se o Redis cair, cada instância continua entregando aos próprios clientes.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly config: ConfigService;
  private readonly pub: Redis;
  private readonly sub: Redis;

  constructor(app: INestApplicationContext) {
    super(app);
    this.config = app.get(ConfigService);
    this.pub = app.get<Redis>(REDIS_PUB);
    this.sub = app.get<Redis>(REDIS_SUB);
  }

  override createIOServer(port: number, options?: ServerOptions): Server {
    const server: Server = super.createIOServer(port, {
      ...options,
      cors: { origin: this.config.get<string[]>('CORS_ORIGINS'), credentials: true },
      // Detecta conexões mortas (ex.: celular perdeu sinal) em ~45 s.
      pingInterval: 20_000,
      pingTimeout: 25_000,
    });
    server.adapter(createAdapter(this.pub, this.sub, { key: `${this.config.getOrThrow<string>('REDIS_PREFIX')}#socket.io` }));
    return server;
  }

  /** Chamado pelo Nest depois de fechar o servidor Socket.IO: agora é seguro encerrar o pub/sub. */
  override async dispose(): Promise<void> {
    await super.dispose();
    await Promise.all([closeRedis(this.pub), closeRedis(this.sub)]);
  }
}
