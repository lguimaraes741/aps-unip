import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface RequestMetaValue {
  ip?: string;
  userAgent?: string;
}

/** IP e User-Agent da requisição (para auditoria e identificação de sessões). */
export const ReqMeta = createParamDecorator((_: unknown, ctx: ExecutionContext): RequestMetaValue => {
  const req = ctx.switchToHttp().getRequest<Request>();
  return { ip: req.ip, userAgent: req.headers['user-agent'] };
});
