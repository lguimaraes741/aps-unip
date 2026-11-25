import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api, ApiError } from '../api/client';
import { http, type AdminUser, type AuthResponse } from '../api/endpoints';

const PANEL_ROLES = new Set(['MODERATOR', 'ADMIN']);

interface AuthState {
  user: AdminUser | null;
  restoring: boolean;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [restoring, setRestoring] = useState(api.hasStoredSession);

  const accept = useCallback((res: AuthResponse) => {
    // O painel é só para a equipe; a API também recusa as rotas, isto apenas orienta.
    if (!PANEL_ROLES.has(res.user.role)) {
      api.clear();
      throw new ApiError(403, 'Acesso restrito a moderadores e administradores. Cidadãos usam o aplicativo.');
    }
    api.setSession(res);
    setUser(res.user);
  }, []);

  // Recarregar a página: a sessão continua pelo refresh token da aba.
  useEffect(() => {
    if (!api.hasStoredSession) return;
    api
      .refreshSession()
      .then((session) => (session ? accept(session as AuthResponse) : api.clear()))
      .catch(() => api.clear())
      .finally(() => setRestoring(false));
  }, [accept]);

  useEffect(() => api.onSessionExpired(() => setUser(null)), []);

  const login = useCallback(async (email: string, password: string) => accept(await http.login(email, password)), [accept]);

  const logout = useCallback(async () => {
    const refreshToken = sessionStorage.getItem('alertacidade.admin.refresh');
    if (refreshToken) await http.logout(refreshToken).catch(() => undefined);
    api.clear();
    setUser(null);
  }, []);

  const value = useMemo(() => ({ user, restoring, login, logout }), [user, restoring, login, logout]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fora do AuthProvider');
  return ctx;
}

export const isAdmin = (user: AdminUser | null) => user?.role === 'ADMIN';
