import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewsEventDetail, NewsEventItem, NewsMetrics, NewsSourceItem } from '../api/endpoints';
import { createQueryClient } from '../App';

vi.mock('../realtime/useRealtime', () => ({ useRealtime: () => 'online' }));

const http = vi.hoisted(() => ({
  login: vi.fn(),
  logout: vi.fn(),
  newsMetrics: vi.fn(),
  newsReview: vi.fn(),
  newsEvent: vi.fn(),
  newsDecision: vi.fn(),
  newsUpdate: vi.fn(),
  newsMerge: vi.fn(),
  newsRegions: vi.fn(),
  newsSources: vi.fn(),
  newsUpdateSource: vi.fn(),
  newsCollect: vi.fn(),
  newsCollections: vi.fn(),
}));
vi.mock('../api/endpoints', () => ({ http }));

const { AuthProvider } = await import('../auth/AuthContext');
const { Layout } = await import('../components/Layout');
const { ToastProvider } = await import('../components/ui');
const { NewsPage } = await import('../pages/NewsPage');
const { NewsEventDetailPage } = await import('../pages/NewsEventDetailPage');

const session = (role: 'MODERATOR' | 'ADMIN') => ({ accessToken: 'a', refreshToken: 'r', user: { id: 'u1', name: 'Equipe', email: 'e@test', role } });

/** Sessão restaurada pelo refresh da aba (como nos testes de ocorrências). */
function renderAs(role: 'MODERATOR' | 'ADMIN', path: string) {
  sessionStorage.setItem('alertacidade.admin.refresh', 'r');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(session(role)), { status: 200, headers: { 'Content-Type': 'application/json' } })));
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <AuthProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="news" element={<NewsPage />} />
                <Route path="news/events/:id" element={<NewsEventDetailPage />} />
              </Route>
            </Routes>
          </MemoryRouter>
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const metrics: NewsMetrics = {
  articles: { total: 15, relevant: 9, irrelevant: 6, failed: 0, pending: 0 },
  events: { total: 6, published: 4, awaitingModeration: 1, discarded: 0, urgent: 2, byStatus: {} },
  activeBySeverity: { CRITICAL: 2, HIGH: 1, NONE: 1 },
  sources: { total: 6, enabled: 6, failing: 1 },
  collectionFailures24h: 3,
  lastSuccessfulCollectionAt: '2026-11-24T12:59:00.000Z',
};

const item = (over: Partial<NewsEventItem> = {}): NewsEventItem => ({
  id: 'e1',
  code: 15,
  title: 'Enxurrada arrasta três pessoas na zona sul',
  status: 'PUBLISHED_PRELIMINARY',
  estimatedSeverity: 'CRITICAL',
  confidence: 'MEDIUM',
  independentSources: 1,
  urgentReview: true,
  locationPrecision: 'NEIGHBORHOOD',
  city: 'São Paulo',
  state: 'SP',
  placeText: null,
  firstEvidenceAt: '2026-11-23T10:00:00.000Z',
  lastEvidenceAt: '2026-11-23T11:00:00.000Z',
  version: 4,
  region: { kind: 'DISTRICT', name: 'Jabaquara', ibgeCode: '355030839' },
  sourceCount: 2,
  firstSource: 'Folha de S.Paulo — Cotidiano',
  ...over,
});

const detail = (over: Partial<NewsEventDetail> = {}): NewsEventDetail => {
  const { sourceCount: _s, firstSource: _f, region: _r, ...base } = item();
  return {
    ...base,
    region: { id: 'r1', kind: 'DISTRICT', name: 'Jabaquara', ibgeCode: '355030839' },
    statusLabel: 'Publicado (preliminar)',
    allowedTransitions: ['PUBLISHED_VERIFIED', 'DISCARDED', 'RESOLVED'],
    decisionReasons: ['um veículo de imprensa estabelecido, ainda sem confirmação independente', 'sem push crítico: falta fonte oficial'],
    moderationNote: null,
    rulesVersion: 'rules-2',
    moderatedBy: null,
    audit: [],
    sources: [
      {
        articleId: 'a1',
        title: 'Enxurrada arrasta três pessoas para dentro de rio',
        url: 'https://portal.example/noticia',
        summary: 'Caso ocorreu no Jabaquara.',
        author: null,
        publishedAt: '2026-11-23T10:00:00.000Z',
        collectedAt: '2026-11-23T10:05:00.000Z',
        source: { id: 's1', key: 'folha', name: 'Folha de S.Paulo — Cotidiano', reliability: 'ESTABLISHED_PRESS', type: 'RSS' },
        isIndependent: true,
        derivedFromArticleId: null,
        linkedBy: 'AUTO',
        analysis: {
          rulesVersion: 'rules-2',
          modelVersion: 'none',
          temporality: 'CURRENT',
          estimatedSeverity: 'CRITICAL',
          confidence: 'MEDIUM',
          locationPrecision: 'NEIGHBORHOOD',
          needsReview: false,
          reasoningSummary: 'relata ocorrência',
          severityEvidence: [{ label: 'pessoa arrastada pela água', excerpt: 'arrastadas pela enxurrada', severity: 'CRITICAL' }],
          discardedEvidence: [{ label: 'mortes', excerpt: 'mortes', why: 'negação' }],
          location: { ambiguities: [] },
          missing: ['horário do evento'],
        },
      },
    ],
    ...over,
  };
};

beforeEach(() => {
  sessionStorage.clear();
  Object.values(http).forEach((f) => f.mockReset());
  http.newsMetrics.mockResolvedValue(metrics);
  http.newsRegions.mockResolvedValue([
    { ibgeCode: '3534401', name: 'Osasco', kind: 'CITY', city: 'Osasco' },
    { ibgeCode: '355030848', name: 'Lapa', kind: 'DISTRICT', city: 'São Paulo' },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe('Monitoramento de notícias', () => {
  it('indicadores e fila: urgente sinalizado, gravidade "não informada" nunca vira baixa', async () => {
    http.newsReview.mockResolvedValue({ items: [item(), item({ id: 'e2', code: 16, title: 'Ruas alagadas em Cotia', estimatedSeverity: null, urgentReview: false, region: { kind: 'CITY', name: 'Cotia', ibgeCode: '3513009' }, city: 'Cotia' })], total: 2, page: 1, limit: 20 });
    renderAs('MODERATOR', '/news');
    expect(await screen.findByText('Revisão urgente', { selector: '.metric-label' })).toBeInTheDocument();
    expect(screen.getByText('Falhas de coleta (24 h)')).toBeInTheDocument();
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Enxurrada arrasta três pessoas na zona sul' })).toHaveAttribute('href', '/news/events/e1');
    expect(within(table).getByText('Jabaquara, São Paulo')).toBeInTheDocument();
    expect(within(table).getByText('Revisão urgente')).toBeInTheDocument();
    expect(within(table).getByText('Não informada')).toBeInTheDocument();
    expect(within(table).queryByText('Baixa')).not.toBeInTheDocument();
  });

  it('fila vazia mostra estado vazio', async () => {
    http.newsReview.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
    renderAs('MODERATOR', '/news');
    expect(await screen.findByText('Nenhum evento')).toBeInTheDocument();
  });

  it('fontes: moderador pede coleta, mas só administrador liga/desliga', async () => {
    const src: NewsSourceItem = {
      id: 's1', key: 'g1-sao-paulo', name: 'g1 São Paulo', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: 'https://g1.globo.com', feedUrl: 'https://g1.globo.com/rss',
      enabled: true, collectionIntervalSec: 900, termsCheckedAt: '2026-11-24T15:00:00.000Z', termsNote: 'robots.txt sem bloqueio', lastSuccessfulCollectionAt: null,
      consecutiveFailures: 0, nextAttemptAt: null, articleCount: 7, lastJob: null,
    };
    http.newsSources.mockResolvedValue([src]);
    http.newsCollect.mockResolvedValue({ queued: [{ sourceId: 's1', key: 'g1-sao-paulo' }] });
    const { unmount } = renderAs('MODERATOR', '/news?tab=sources');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Coletar agora' }));
    await waitFor(() => expect(http.newsCollect).toHaveBeenCalledWith('s1'));
    expect(screen.queryByRole('button', { name: 'Desligar' })).not.toBeInTheDocument();
    unmount();
    sessionStorage.clear();
    renderAs('ADMIN', '/news?tab=sources');
    expect(await screen.findByRole('button', { name: 'Desligar' })).toBeInTheDocument();
  });
});

describe('análise de um evento', () => {
  it('mostra evidências literais, aviso de que não é comunicado oficial e link seguro para a notícia original', async () => {
    http.newsEvent.mockResolvedValue(detail());
    renderAs('MODERATOR', '/news/events/e1');
    expect(await screen.findByText(/não é comunicado oficial da Defesa Civil/)).toBeInTheDocument();
    expect(screen.getByText('arrastadas pela enxurrada')).toBeInTheDocument();
    expect(screen.getByText(/Ausente na fonte: horário do evento/)).toBeInTheDocument();
    expect(screen.getByText('mortes').closest('li')).toHaveClass('discarded');
    const link = screen.getByRole('link', { name: /Ver notícia original/ });
    expect(link).toHaveAttribute('href', 'https://portal.example/noticia');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('validar envia a versão vista; descartar exige motivo', async () => {
    http.newsEvent.mockResolvedValue(detail());
    http.newsDecision.mockResolvedValue({ status: 'PUBLISHED_VERIFIED', version: 5 });
    renderAs('MODERATOR', '/news/events/e1');
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Descartar' }));
    let dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Descartar' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await user.click(screen.getByRole('button', { name: 'Validar' }));
    dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Validar' }));
    await waitFor(() => expect(http.newsDecision).toHaveBeenCalledWith('e1', 'approve', { expectedVersion: 4, note: undefined }));
    expect(await screen.findByText(/N-15: Publicado \(verificado\)/)).toBeInTheDocument();
  });

  it('sem local identificado, validar fica bloqueado até corrigir a localização', async () => {
    http.newsEvent.mockResolvedValue(detail({ locationPrecision: 'UNKNOWN', region: null, city: null }));
    http.newsUpdate.mockResolvedValue({ version: 5 });
    renderAs('MODERATOR', '/news/events/e1');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Validar' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Corrija o local antes de validar/)).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Validar' })).toBeDisabled();
    await user.click(within(dialog).getByRole('button', { name: 'Cancelar' }));

    await screen.findByRole('option', { name: 'Lapa (distrito de São Paulo)' });
    await user.selectOptions(screen.getByLabelText('Localização'), '355030848');
    await user.selectOptions(screen.getByLabelText('Gravidade'), 'NONE');
    await user.click(screen.getByRole('button', { name: 'Salvar correção' }));
    await waitFor(() => expect(http.newsUpdate).toHaveBeenCalledWith('e1', { expectedVersion: 4, severity: 'NONE', regionIbge: '355030848' }));
  });

  it('evento encerrado não oferece decisões nem correções', async () => {
    http.newsEvent.mockResolvedValue(detail({ status: 'DISCARDED', allowedTransitions: [], moderationNote: 'Duplicado de N-3', moderatedBy: { id: 'm', name: 'Mod' } }));
    renderAs('MODERATOR', '/news/events/e1');
    expect(await screen.findByText(/não há mais decisões/)).toBeInTheDocument();
    expect(screen.getByText(/Duplicado de N-3/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salvar correção' })).not.toBeInTheDocument();
  });
});
