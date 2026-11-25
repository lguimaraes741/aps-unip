import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { EventEnvelope, isStaffOnlyEvent, SocketMessage, STAFF_ROLES } from '@alertacidade/shared-types';
import { Server, Socket } from 'socket.io';
import { AuthUser } from '../common/auth/auth-user';
import { AccessTokenPayload } from '../common/auth/jwt-auth.guard';

interface SocketData {
  user: AuthUser;
  expiryTimer?: NodeJS.Timeout;
}

export const userRoom = (userId: string) => `user:${userId}`;
export const roleRoom = (role: string) => `role:${role}`;

/**
 * Canal servidor → cliente. Somente clientes com JWT de acesso válido conectam
 * (token em `auth.token` no handshake). Cada socket entra nas salas do próprio usuário
 * e do seu perfil; eventos de domínio vão para todos os autenticados, exceto os "só equipe"
 * (moderação de notícias), que vão apenas às salas de MODERATOR e ADMIN.
 *
 * Quando o token expira, o servidor encerra a conexão: o cliente renova o token e
 * reconecta, e a sessão revogada/suspensa deixa de receber eventos.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly jwt: JwtService) {}

  afterInit(server: Server): void {
    server.use((socket, next) => {
      const token = this.extractToken(socket);
      if (!token) return next(new Error('unauthorized'));
      this.jwt
        .verifyAsync<AccessTokenPayload & { exp: number }>(token)
        .then((payload) => {
          if (payload.typ !== 'access') return next(new Error('unauthorized'));
          const data = socket.data as SocketData;
          data.user = { id: payload.sub, role: payload.role };
          const msLeft = payload.exp * 1000 - Date.now();
          data.expiryTimer = setTimeout(() => socket.disconnect(true), Math.max(msLeft, 0));
          data.expiryTimer.unref();
          next();
        })
        .catch(() => next(new Error('unauthorized')));
    });
  }

  async handleConnection(socket: Socket): Promise<void> {
    const { user } = socket.data as SocketData;
    await socket.join([userRoom(user.id), roleRoom(user.role)]);
  }

  handleDisconnect(socket: Socket): void {
    const data = socket.data as Partial<SocketData>;
    if (data.expiryTimer) clearTimeout(data.expiryTimer);
  }

  /** Evento de domínio para os clientes autenticados (todas as instâncias, via Redis). */
  broadcastEvent(envelope: EventEnvelope): void {
    try {
      if (isStaffOnlyEvent(envelope.type)) {
        // Dados ainda não publicados: nunca para a sala de cidadãos.
        this.server.to(STAFF_ROLES.map(roleRoom)).emit(SocketMessage.EVENT, envelope);
      } else {
        this.server.emit(SocketMessage.EVENT, envelope);
      }
    } catch (error) {
      // O estado está no banco: quem perder o evento recupera por GET /sync.
      this.logger.warn(`Falha ao emitir evento ${envelope.sequence}: ${(error as Error).message}`);
    }
  }

  private extractToken(socket: Socket): string | undefined {
    const fromAuth = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth.replace(/^Bearer\s+/i, '');
    const [type, token] = socket.handshake.headers.authorization?.split(' ') ?? [];
    return type === 'Bearer' && token ? token : undefined;
  }
}
