import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import type { OccurrenceAnalysis } from '../api/endpoints';
import { createQueryClient } from '../App';

// Sem rede e sem socket nos testes de tela.
vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => 'online' }));
vi.mock('react-leaflet', () => ({ MapContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>, TileLayer: () => null, CircleMarker: () => null, Popup: () => null }));

const http = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  dashboard: vi.fn(),
  occurrences: vi.fn(),
  occurrence: vi.fn(),
  changeStatus: vi.fn(),
}));
vi.mock('../api/endpoints', () => ({ http }));

const { AuthProvider } = await import('../auth/AuthContext');
const { Layout } = await import('../components/Layout');
const { ToastProvider } = await import('../components/ui');
const { LoginPage } = await import('../pages/LoginPage');
const { OccurrenceDetailPage } = await import('../pages/OccurrenceDetailPage');

function renderApp(path: string, routes: ReactNode) {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route element={<Layout />}>{routes}</Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const session = (role: 'CITIZEN' | 'MODERATOR' | 'ADMIN') => ({
  accessToken: 'a',
  refreshToken: 'r',
  user: { id: 'u1', name: 'Equipe Teste', email: 'equipe@test', role },
});

async function loginAs(role: 'CITIZEN' | 'MODERATOR' | 'ADMIN') {
  http.login.mockResolvedValueOnce(session(role));
  const user = userEvent.setup();
  await user.type(screen.getByLabelText('E-mail'), 'equipe@test');
  await user.type(screen.getByLabelText('Senha'), 'Senha@123');
  await user.click(screen.getByRole('button', { name: 'Entrar' }));
  return user;
}

const analysis = (over: Partial<OccurrenceAnalysis> = {}): OccurrenceAnalysis => ({
  id: 'o1',
  code: 42,
  title: 'Alagamento na Av. do Estado',
  description: 'Água na altura do joelho.',
  address: 'Av. do Estado, 100',
  neighborhood: 'Cambuci',
  latitude: -23.56,
  longitude: -46.62,
  severity: 'HIGH',
  status: 'PENDING',
  version: 3,
  confirmCount: 2,
  contestCount: 0,
  isDemo: false,
  occurredAt: '2026-11-23T12:00:00.000Z',
  createdAt: '2026-11-23T12:05:00.000Z',
  moderationNote: null,
  validatedAt: null,
  resolvedAt: null,
  author: { id: 'c1', name: 'Cidadã', role: 'CITIZEN', status: 'ACTIVE' },
  moderatedBy: null,
  photos: [],
  history: [{ fromStatus: null, toStatus: 'PENDING', note: null, createdAt: '2026-11-23T12:05:00.000Z', actor: { name: 'Cidadã', role: 'CITIZEN' } }],
  reports: [],
  allowedTransitions: ['UNDER_REVIEW', 'VALIDATED', 'REJECTED'],
  ...over,
});

beforeEach(() => {
  sessionStorage.clear();
  Object.values(http).forEach((f) => f.mockReset());
});

describe('acesso ao painel', () => {
  it('cidadão é recusado com orientação (a API também recusaria)', async () => {
    renderApp('/login', <Route index element={<p>painel</p>} />);
    await loginAs('CITIZEN');
    expect(await screen.findByRole('alert')).toHaveTextContent('Acesso restrito a moderadores e administradores');
    expect(sessionStorage.length).toBe(0);
  });

  it('moderador não vê Usuários, Auditoria nem Ambiente; administrador vê', async () => {
    const { unmount } = renderApp('/login', <Route index element={<p>painel</p>} />);
    await loginAs('MODERATOR');
    const nav = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(nav).getByText('Ocorrências')).toBeInTheDocument();
    expect(within(nav).queryByText('Usuários')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Auditoria')).not.toBeInTheDocument();
    unmount();
    sessionStorage.clear();

    renderApp('/login', <Route index element={<p>painel</p>} />);
    await loginAs('ADMIN');
    const adminNav = await screen.findByRole('navigation', { name: 'Seções do painel' });
    expect(within(adminNav).getByText('Usuários')).toBeInTheDocument();
    expect(within(adminNav).getByText('Auditoria')).toBeInTheDocument();
  });

  it('sem sessão, qualquer rota leva ao login', async () => {
    renderApp('/occurrences/o1', <Route path="occurrences/:id" element={<OccurrenceDetailPage />} />);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
  });
});

describe('moderação', () => {
  it('rejeitar exige motivo; 409 de outro moderador aparece para quem tentou', async () => {
    http.occurrence.mockResolvedValue(analysis());
    sessionStorage.setItem('alertacidade.admin.refresh', 'r');
    // A restauração da sessão usa o refresh da aba.
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify(session('MODERATOR')), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    );
    renderApp('/occurrences/o1', <Route path="occurrences/:id" element={<OccurrenceDetailPage />} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Rejeitar' }));
    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Rejeitar' });
    expect(confirm).toBeDisabled(); // sem motivo não confirma
    await user.type(within(dialog).getByRole('textbox'), 'Foto de outro local');
    expect(confirm).toBeEnabled();

    http.changeStatus.mockRejectedValueOnce(new ApiError(409, 'Esta ocorrência foi alterada por outra pessoa enquanto você analisava'));
    await user.click(confirm);
    await waitFor(() => expect(http.changeStatus).toHaveBeenCalledWith('o1', { status: 'REJECTED', expectedVersion: 3, note: 'Foto de outro local' }));
    expect(await screen.findByText(/alterada por outra pessoa/)).toBeInTheDocument();
    // Recarrega o estado atual depois do conflito.
    await waitFor(() => expect(http.occurrence.mock.calls.length).toBeGreaterThan(1));
    vi.unstubAllGlobals();
  });

  it('validar envia a versão vista; status final não oferece ações', async () => {
    http.occurrence.mockResolvedValueOnce(analysis()).mockResolvedValue(analysis({ status: 'VALIDATED', version: 4, allowedTransitions: ['RESOLVED'] }));
    http.changeStatus.mockResolvedValueOnce({ status: 'VALIDATED', version: 4 });
    sessionStorage.setItem('alertacidade.admin.refresh', 'r');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session('MODERATOR')), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    renderApp('/occurrences/o1', <Route path="occurrences/:id" element={<OccurrenceDetailPage />} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Validar' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(http.changeStatus).toHaveBeenCalledWith('o1', { status: 'VALIDATED', expectedVersion: 3, note: undefined }));
    expect(await screen.findByText(/O app e o autor já foram avisados/)).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Marcar como resolvida' })).toBeInTheDocument();
    vi.unstubAllGlobals();
  });

  it('status final não oferece ações de moderação', async () => {
    http.occurrence.mockResolvedValue(analysis({ status: 'REJECTED', allowedTransitions: [], moderationNote: 'Duplicada', moderatedBy: { id: 'm', name: 'Mod' } }));
    sessionStorage.setItem('alertacidade.admin.refresh', 'r');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session('ADMIN')), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    renderApp('/occurrences/o1', <Route path="occurrences/:id" element={<OccurrenceDetailPage />} />);
    expect(await screen.findByText(/não há mais ações de moderação/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicada/)).toBeInTheDocument();
    vi.unstubAllGlobals();
  });
});
