import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    // Não registra parâmetros de consultas em log (podem conter dados pessoais).
    super({
      log: [{ emit: 'stdout', level: 'warn' }, { emit: 'stdout', level: 'error' }],
      // Transações interativas que disputam a mesma linha (SELECT … FOR UPDATE em confirmações
      // e fotos) ficam na fila do lock segurando conexões do pool. O padrão do Prisma
      // (maxWait 2 s para obter conexão, timeout 5 s) devolvia 500 sob rajadas concorrentes.
      transactionOptions: { maxWait: 10_000, timeout: 15_000 },
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      // A API sobe mesmo com o banco fora do ar; o health check reporta "down"
      // e o Prisma reconecta automaticamente na próxima consulta.
      this.logger.error(`Falha ao conectar ao banco na inicialização: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
