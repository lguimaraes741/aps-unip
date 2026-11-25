import type { NewsReviewEventPayload } from '@alertacidade/shared-types';
import { useCallback, useState } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { isAdmin, useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/format';
import { useRealtime } from '../realtime/useRealtime';
import { LoadingSkeleton } from './ui';
import { UrgentReviewBanner } from './UrgentReviewBanner';

export const NAV = [
  { to: '/', label: 'Dashboard', adminOnly: false },
  { to: '/occurrences', label: 'Ocorrências', adminOnly: false },
  { to: '/map', label: 'Mapa', adminOnly: false },
  { to: '/news', label: 'Notícias', adminOnly: false },
  { to: '/reports', label: 'Relatórios', adminOnly: false },
  { to: '/users', label: 'Usuários', adminOnly: true },
  { to: '/audit', label: 'Auditoria', adminOnly: true },
  { to: '/settings', label: 'Ambiente', adminOnly: true },
] as const;

const LIVE_TEXT = { online: 'Ao vivo', connecting: 'Conectando…', offline: 'Sem tempo real' } as const;

/** Área autenticada: sem sessão → login. Itens sem permissão nem aparecem (a API recusa de qualquer forma). */
export function Layout() {
  const { user, restoring, logout } = useAuth();
  const [urgent, setUrgent] = useState<NewsReviewEventPayload[]>([]);
  const onUrgent = useCallback((p: NewsReviewEventPayload) => setUrgent((u) => [p, ...u.filter((x) => x.eventId !== p.eventId)].slice(0, 5)), []);
  const live = useRealtime(Boolean(user), onUrgent);
  const location = useLocation();

  if (restoring) return <LoadingSkeleton rows={6} />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">
            ●
          </span>
          AlertaCidade
          <small>Painel</small>
        </div>
        <nav aria-label="Seções do painel">
          {NAV.filter((n) => !n.adminOnly || isAdmin(user)).map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className={`live ${live}`} aria-live="polite">
            <i aria-hidden="true" /> {LIVE_TEXT[live]}
          </span>
          <span className="who">
            {user.name}
            <small>{ROLE_LABEL[user.role]}</small>
          </span>
          <button className="btn ghost" onClick={() => void logout()}>
            Sair
          </button>
        </div>
      </aside>
      <main className="content">
        <UrgentReviewBanner items={urgent} onDismiss={(id) => setUrgent((u) => u.filter((x) => x.eventId !== id))} />
        <Outlet />
      </main>
    </div>
  );
}

/** Rotas exclusivas de ADMIN: moderador que digitar a URL vê o aviso (e a API responderia 403). */
export function AdminOnly({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (!isAdmin(user)) {
    return (
      <div className="page">
        <h1>Acesso restrito</h1>
        <p className="muted">Esta seção é exclusiva de administradores.</p>
      </div>
    );
  }
  return <>{children}</>;
}
