/**
 * Cliente HTTP do painel.
 *
 * - Access token só em memória; refresh token em sessionStorage (some ao fechar a aba).
 * - 401 → renova a sessão UMA vez (promessa compartilhada entre requisições simultâneas,
 *   pois a API trata reuso de refresh token como roubo e encerra a sessão) e repete.
 * - Erros viram ApiError com a mensagem em português vinda da API.
 */
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3000';
const REFRESH_KEY = 'alertacidade.admin.refresh';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly fields: Record<string, string[]> = {},
  ) {
    super(message);
  }

  get isConflict() {
    return this.status === 409;
  }
}

export interface Session {
  accessToken: string;
  refreshToken: string;
}

/** Resposta de login/renovação (o usuário vem junto). */
export interface SessionResponse extends Session {
  user: { id: string; name: string; email: string; role: 'CITIZEN' | 'MODERATOR' | 'ADMIN' };
}

type Listener = () => void;

export class ApiClient {
  private accessToken: string | null = null;
  private refreshing: Promise<SessionResponse | null> | null = null;
  private expiredListeners = new Set<Listener>();

  constructor(
    private readonly baseUrl = `${API_URL}/api/v1`,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> = sessionStorage,
    private readonly fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}

  get token(): string | null {
    return this.accessToken;
  }

  get hasStoredSession(): boolean {
    return this.storage.getItem(REFRESH_KEY) !== null;
  }

  setSession(session: Session) {
    this.accessToken = session.accessToken;
    this.storage.setItem(REFRESH_KEY, session.refreshToken);
  }

  clear() {
    this.accessToken = null;
    this.storage.removeItem(REFRESH_KEY);
  }

  onSessionExpired(listener: Listener): () => void {
    this.expiredListeners.add(listener);
    return () => this.expiredListeners.delete(listener);
  }

  /**
   * Renovação única e compartilhada (também usada para restaurar a sessão ao recarregar a
   * página — inclusive com o StrictMode do React executando o efeito duas vezes).
   */
  refreshSession(): Promise<SessionResponse | null> {
    this.refreshing ??= (async () => {
      const refreshToken = this.storage.getItem(REFRESH_KEY);
      if (!refreshToken) return null;
      try {
        const res = await this.fetcher(`${this.baseUrl}/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (!res.ok) return null;
        const session = (await res.json()) as SessionResponse;
        this.setSession(session);
        return session;
      } catch {
        return null;
      }
    })().finally(() => (this.refreshing = null));
    return this.refreshing;
  }

  async refresh(): Promise<boolean> {
    return (await this.refreshSession()) !== null;
  }

  async request<T>(path: string, init: RequestInit & { json?: unknown; raw?: boolean } = {}): Promise<T> {
    const send = () => {
      const headers = new Headers(init.headers);
      if (this.accessToken && !path.startsWith('/auth/')) headers.set('Authorization', `Bearer ${this.accessToken}`);
      if (init.json !== undefined) headers.set('Content-Type', 'application/json');
      return this.fetcher(`${this.baseUrl}${path}`, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
    };

    let res: Response;
    try {
      res = await send();
      if (res.status === 401 && !path.startsWith('/auth/')) {
        if (await this.refresh()) {
          res = await send();
        } else {
          this.clear();
          this.expiredListeners.forEach((l) => l());
          throw new ApiError(401, 'Sua sessão expirou. Entre novamente.');
        }
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(0, 'Não foi possível falar com o servidor. Verifique a conexão.');
    }

    if (!res.ok) throw await toApiError(res);
    if (init.raw) return res as unknown as T;
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: { message?: string | string[]; errors?: Record<string, string[]> } = {};
  try {
    body = await res.json();
  } catch {
    // corpo vazio ou não JSON
  }
  const message = Array.isArray(body.message) ? body.message.join(' ') : body.message;
  const fallback: Record<number, string> = {
    403: 'Seu perfil não tem permissão para esta operação.',
    404: 'Registro não encontrado.',
    429: 'Muitas tentativas. Aguarde um pouco e tente de novo.',
    503: 'Serviço temporariamente indisponível. Tente novamente.',
  };
  return new ApiError(res.status, message ?? fallback[res.status] ?? 'Erro inesperado. Tente novamente.', body.errors ?? {});
}

export const api = new ApiClient();
