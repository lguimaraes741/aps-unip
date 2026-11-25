import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Response } from 'express';

const REASON: Partial<Record<number, string>> = {
  404: 'Not Found',
  409: 'Conflict',
  422: 'Unprocessable Entity',
  500: 'Internal Server Error',
  503: 'Service Unavailable',
};

/**
 * Converte erros conhecidos do Prisma em respostas HTTP adequadas,
 * sem expor nomes de tabelas, colunas ou SQL ao cliente.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientInitializationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(
    exception: Prisma.PrismaClientKnownRequestError | Prisma.PrismaClientInitializationError,
    host: ArgumentsHost,
  ): void {
    const response = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Erro interno ao acessar os dados';

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          status = HttpStatus.CONFLICT;
          message = 'Registro duplicado';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          message = 'Registro não encontrado';
          break;
        case 'P2003':
          status = HttpStatus.UNPROCESSABLE_ENTITY;
          message = 'Referência inválida';
          break;
        case 'P2034':
          // Transação serializável abortada por conflito com outra operação simultânea.
          status = HttpStatus.CONFLICT;
          message = 'Outra alteração foi feita ao mesmo tempo. Recarregue e tente de novo.';
          break;
        case 'P1001':
        case 'P1002':
        case 'P2024':
          status = HttpStatus.SERVICE_UNAVAILABLE;
          message = 'Banco de dados temporariamente indisponível. Tente novamente.';
          break;
      }
    } else {
      status = HttpStatus.SERVICE_UNAVAILABLE;
      message = 'Banco de dados temporariamente indisponível. Tente novamente.';
    }

    if (status >= 500) this.logger.error(`${exception.name}: ${exception.message.split('\n').pop()}`);
    response.status(status).json({ statusCode: status, error: REASON[status] ?? 'Error', message });
  }
}
