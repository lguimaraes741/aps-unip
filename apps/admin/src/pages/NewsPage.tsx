import type { NewsConfidence, NewsEventStatus, Severity } from '@alertacidade/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { http, type CollectionJob, type NewsSourceItem } from '../api/endpoints';
import { isAdmin, useAuth } from '../auth/AuthContext';
import {
  ConfidenceBadge,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  MetricCard,
  NewsSeverityBadge,
  NewsStatusBadge,
  Pagination,
  useToast,
} from '../components/ui';
import {
  CONFIDENCE_LABEL,
  formatDateTime,
  formatNumber,
  NEWS_STATUS_LABEL,
  NEWS_STATUSES,
  PRECISION_LABEL,
  RELIABILITY_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
} from '../lib/format';

type Tab = 'queue' | 'sources' | 'collections';
const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Eventos' },
  { id: 'sources', label: 'Fontes' },
  { id: 'collections', label: 'Coletas' },
];

/**
 * Monitoramento de notícias: notícias viram EVENTOS (agrupados pelo news-worker); aqui o moderador
 * revisa, valida, corrige e descarta. Notícia nunca é apresentada como comunicado oficial.
 */
export function NewsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'queue';
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Monitoramento de notícias</h1>
          <p className="muted">Alertas identificados automaticamente em fontes jornalísticas e institucionais. Revise antes de confiar.</p>
        </div>
      </header>
      <Metrics />
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setParams({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'queue' && <EventsTable />}
      {tab === 'sources' && <SourcesTable />}
      {tab === 'collections' && <CollectionsTable />}
    </div>
  );
}

function Metrics() {
  const m = useQuery({ queryKey: ['news-metrics'], queryFn: () => http.newsMetrics(), refetchInterval: 60_000 });
  if (m.isPending) return <LoadingSkeleton rows={1} />;
  if (m.isError) return <ErrorState error={m.error} onRetry={() => void m.refetch()} />;
  const d = m.data;
  const sev = (k: Severity | 'NONE') => d.activeBySeverity[k] ?? 0;
  return (
    <div className="metrics-grid" aria-label="Indicadores de notícias">
      <MetricCard label="Notícias coletadas" value={formatNumber(d.articles.total)} hint={`${formatNumber(d.articles.relevant)} relevantes · ${formatNumber(d.articles.irrelevant)} descartadas`} />
      <MetricCard label="Eventos identificados" value={formatNumber(d.events.total)} hint={`${d.events.published} publicados · ${d.events.discarded} descartados`} />
      <MetricCard label="Aguardando moderação" value={d.events.awaitingModeration} tone={d.events.awaitingModeration > 0 ? 'warning' : undefined} />
      <MetricCard label="Revisão urgente" value={d.events.urgent} tone={d.events.urgent > 0 ? 'danger' : undefined} hint="Gravidade crítica sem confirmação" />
      <MetricCard
        label="Ativos por gravidade"
        value={`${sev('CRITICAL')} · ${sev('HIGH')} · ${sev('MODERATE')} · ${sev('LOW')}`}
        hint={`crítica · alta · moderada · baixa — ${sev('NONE')} sem gravidade informada`}
      />
      <MetricCard
        label="Fontes"
        value={`${d.sources.enabled}/${d.sources.total} ligadas`}
        tone={d.sources.failing > 0 ? 'warning' : undefined}
        hint={d.sources.failing > 0 ? `${d.sources.failing} com falha recente` : 'Nenhuma com falha'}
      />
      <MetricCard
        label="Falhas de coleta (24 h)"
        value={d.collectionFailures24h}
        hint={`Última coleta bem-sucedida: ${formatDateTime(d.lastSuccessfulCollectionAt)}`}
      />
    </div>
  );
}

function EventsTable() {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<NewsEventStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | 'NONE' | ''>('');
  const [confidence, setConfidence] = useState<NewsConfidence | ''>('');
  const [urgent, setUrgent] = useState(false);
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = {
    status: status ? [status] : undefined,
    severity: severity ? [severity] : undefined,
    confidence: confidence ? [confidence] : undefined,
    urgent,
    q: q || undefined,
    page,
    limit: 20,
  };
  const list = useQuery({ queryKey: ['news-review', filters], queryFn: () => http.newsReview(filters), placeholderData: keepPreviousData });
  const reset = <T,>(set: (v: T) => void) => (v: T) => (set(v), setPage(1));

  return (
    <section className="card">
      <div className="filters">
        <input type="search" placeholder="Buscar por título ou nº (N-12)" aria-label="Buscar eventos" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select aria-label="Status" value={status} onChange={(e) => reset(setStatus)(e.target.value as NewsEventStatus | '')}>
          <option value="">Em aberto (padrão)</option>
          {NEWS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {NEWS_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select aria-label="Gravidade" value={severity} onChange={(e) => reset(setSeverity)(e.target.value as Severity | 'NONE' | '')}>
          <option value="">Todas as gravidades</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
          <option value="NONE">Não informada</option>
        </select>
        <select aria-label="Confiança" value={confidence} onChange={(e) => reset(setConfidence)(e.target.value as NewsConfidence | '')}>
          <option value="">Qualquer confiança</option>
          {(['HIGH', 'MEDIUM', 'LOW'] as NewsConfidence[]).map((c) => (
            <option key={c} value={c}>
              {CONFIDENCE_LABEL[c]}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={urgent} onChange={(e) => reset(setUrgent)(e.target.checked)} /> Só revisão urgente
        </label>
      </div>

      {list.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title="Nenhum evento" message="Quando as fontes publicarem notícias sobre alagamentos nas cidades monitoradas, elas aparecem aqui." />
      ) : (
        <>
          <p className="caption muted">{list.data.total} evento(s) · urgentes primeiro</p>
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Título</th>
                <th>Portal</th>
                <th>Cidade</th>
                <th>Última notícia</th>
                <th>Gravidade estimada</th>
                <th>Confiança</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((e) => (
                <tr key={e.id}>
                  <td>N-{e.code}</td>
                  <td>
                    <Link to={`/news/events/${e.id}`}>{e.title}</Link>
                    {e.urgentReview && (
                      <div>
                        <span className="badge urgent">Revisão urgente</span>
                      </div>
                    )}
                  </td>
                  <td>
                    {e.firstSource ?? '—'}
                    {e.sourceCount > 1 && <div className="caption muted">+{e.sourceCount - 1} fonte(s)</div>}
                  </td>
                  <td>
                    {e.region?.kind === 'DISTRICT' ? `${e.region.name}, ${e.city}` : (e.city ?? <span className="muted">—</span>)}
                    <div className="caption muted">{PRECISION_LABEL[e.locationPrecision]}</div>
                  </td>
                  <td>{formatDateTime(e.lastEvidenceAt)}</td>
                  <td>
                    <NewsSeverityBadge severity={e.estimatedSeverity} />
                  </td>
                  <td>
                    <ConfidenceBadge confidence={e.confidence} />
                    <div className="caption muted">{e.independentSources} fonte(s) independente(s)</div>
                  </td>
                  <td>
                    <NewsStatusBadge status={e.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} limit={20} total={list.data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}

function SourcesTable() {
  const { user } = useAuth();
  const admin = isAdmin(user);
  const toast = useToast();
  const queryClient = useQueryClient();
  const sources = useQuery({ queryKey: ['news-sources'], queryFn: () => http.newsSources() });
  const collect = useMutation({
    mutationFn: (sourceId?: string) => http.newsCollect(sourceId),
    onSuccess: (r) => toast(`Coleta solicitada (${r.queued.map((q) => q.key).join(', ') || 'nenhuma fonte ligada'}). O resultado aparece em "Coletas".`, 'success'),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível solicitar a coleta.', 'error'),
  });
  const toggle = useMutation({
    mutationFn: (s: NewsSourceItem) => http.newsUpdateSource(s.id, !s.enabled),
    onSuccess: (r) => toast(r.enabled ? 'Fonte ligada. O agendamento começa em até 5 minutos.' : 'Fonte desligada.', 'success'),
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível alterar a fonte.', 'error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['news-sources'] }),
  });

  if (sources.isPending) return <LoadingSkeleton rows={4} />;
  if (sources.isError) return <ErrorState error={sources.error} onRetry={() => void sources.refetch()} />;
  if (sources.data.length === 0) return <EmptyState title="Nenhuma fonte cadastrada" message="Rode npm run news:seed-sources." />;

  return (
    <section className="card">
      <div className="card-header">
        <p className="caption muted">Somente fontes com acesso automatizado permitido. Guardamos título, link e o resumo do próprio feed.</p>
        <button className="btn secondary" disabled={collect.isPending} onClick={() => collect.mutate(undefined)}>
          Coletar todas agora
        </button>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Fonte</th>
            <th>Tipo</th>
            <th>Situação</th>
            <th>Última coleta</th>
            <th className="num">Notícias</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {sources.data.map((s) => (
            <tr key={s.id}>
              <td>
                <a href={s.baseUrl} target="_blank" rel="noopener noreferrer">
                  {s.name}
                </a>
                <div className="caption muted">{RELIABILITY_LABEL[s.reliability]}</div>
                {s.termsNote && <div className="caption muted" title="O que foi conferido nos termos de uso">{s.termsNote}</div>}
              </td>
              <td>
                {s.type} · a cada {Math.round(s.collectionIntervalSec / 60)} min
              </td>
              <td>
                {!s.enabled ? (
                  <span className="muted">Desligada</span>
                ) : s.consecutiveFailures > 0 ? (
                  <span className="danger-text">
                    {s.consecutiveFailures} falha(s) seguida(s)
                    <div className="caption">nova tentativa {formatDateTime(s.nextAttemptAt)}</div>
                  </span>
                ) : (
                  'Funcionando'
                )}
                {s.lastJob?.errorMessage && <div className="caption muted">{s.lastJob.errorMessage}</div>}
              </td>
              <td>{formatDateTime(s.lastSuccessfulCollectionAt)}</td>
              <td className="num">{formatNumber(s.articleCount)}</td>
              <td className="actions">
                <button className="btn secondary" disabled={!s.enabled || collect.isPending} onClick={() => collect.mutate(s.id)}>
                  Coletar agora
                </button>
                {admin && (
                  <button className={`btn ${s.enabled ? 'ghost' : 'secondary'}`} disabled={toggle.isPending} onClick={() => toggle.mutate(s)}>
                    {s.enabled ? 'Desligar' : 'Ligar'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

const JOB_STATUS: Record<CollectionJob['status'], string> = { RUNNING: 'Em andamento', SUCCEEDED: 'Concluída', FAILED: 'Falhou', SKIPPED: 'Ignorada' };
const TRIGGER: Record<CollectionJob['trigger'], string> = { SCHEDULE: 'Agendada', MANUAL: 'Manual', RETRY: 'Reprocessamento' };

function CollectionsTable() {
  const [page, setPage] = useState(1);
  const [onlyFailed, setOnlyFailed] = useState(false);
  const filters = { status: onlyFailed ? ('FAILED' as const) : undefined, page };
  const list = useQuery({ queryKey: ['news-collections', filters], queryFn: () => http.newsCollections(filters), placeholderData: keepPreviousData, refetchInterval: 30_000 });

  return (
    <section className="card">
      <div className="filters">
        <label className="check">
          <input type="checkbox" checked={onlyFailed} onChange={(e) => (setOnlyFailed(e.target.checked), setPage(1))} /> Só falhas
        </label>
      </div>
      {list.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={onlyFailed ? 'Nenhuma falha de coleta' : 'Nenhuma coleta registrada'} />
      ) : (
        <>
          <table className="table compact">
            <thead>
              <tr>
                <th>Início</th>
                <th>Fonte</th>
                <th>Disparo</th>
                <th>Resultado</th>
                <th className="num">Itens</th>
                <th className="num">Novos</th>
                <th className="num">Duração</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((j) => (
                <tr key={j.id}>
                  <td>{formatDateTime(j.startedAt)}</td>
                  <td>{j.source?.name ?? '—'}</td>
                  <td>{TRIGGER[j.trigger]}</td>
                  <td>
                    <span className={j.status === 'FAILED' ? 'danger-text' : undefined}>
                      {JOB_STATUS[j.status]}
                      {j.httpStatus ? ` (HTTP ${j.httpStatus})` : ''}
                    </span>
                    {j.errorMessage && <div className="caption muted">{j.errorMessage}</div>}
                  </td>
                  <td className="num">{j.itemsFound}</td>
                  <td className="num">{j.itemsNew}</td>
                  <td className="num">{j.durationMs !== null ? `${(j.durationMs / 1000).toFixed(1)} s` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} limit={20} total={list.data.total} onPage={setPage} />
        </>
      )}
    </section>
  );
}
