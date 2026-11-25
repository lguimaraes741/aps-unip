import type { OccurrenceStatus, Severity } from '@alertacidade/shared-types';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ApiError } from '../api/client';
import { http } from '../api/endpoints';
import { DemoBadge, EmptyState, ErrorState, LoadingSkeleton, Pagination, SeverityBadge, StatusBadge, useToast } from '../components/ui';
import { formatDateTime, REPORT_REASON_LABEL, SEVERITIES, SEVERITY_LABEL, STATUS_LABEL, STATUSES } from '../lib/format';

type Tab = 'all' | 'queue' | 'reports';
const TABS: { id: Tab; label: string }[] = [
  { id: 'queue', label: 'Fila de moderação' },
  { id: 'all', label: 'Todas' },
  { id: 'reports', label: 'Denúncias' },
];

export function OccurrencesPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'queue';
  return (
    <div className="page">
      <header className="page-header">
        <h1>Ocorrências</h1>
      </header>
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? 'active' : ''} onClick={() => setParams({ tab: t.id })}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'reports' ? <ReportsQueue /> : <OccurrenceTable key={tab} queue={tab === 'queue'} />}
    </div>
  );
}

function OccurrenceTable({ queue }: { queue: boolean }) {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<OccurrenceStatus | ''>('');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [reported, setReported] = useState(false);

  // Busca com debounce de 300 ms.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const filters = {
    status: queue ? (['PENDING', 'UNDER_REVIEW'] as OccurrenceStatus[]) : status ? [status] : undefined,
    severity: severity ? [severity] : undefined,
    q: q || undefined,
    reported,
    page,
    limit: 20,
  };
  const list = useQuery({ queryKey: ['occurrences', filters], queryFn: () => http.occurrences(filters), placeholderData: keepPreviousData });

  return (
    <section className="card">
      <div className="filters">
        <input type="search" placeholder="Buscar por título, endereço, bairro ou nº" aria-label="Buscar ocorrências" value={search} onChange={(e) => setSearch(e.target.value)} />
        {!queue && (
          <select aria-label="Status" value={status} onChange={(e) => (setStatus(e.target.value as OccurrenceStatus | ''), setPage(1))}>
            <option value="">Todos os status</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        )}
        <select aria-label="Gravidade" value={severity} onChange={(e) => (setSeverity(e.target.value as Severity | ''), setPage(1))}>
          <option value="">Todas as gravidades</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={reported} onChange={(e) => (setReported(e.target.checked), setPage(1))} /> Só com denúncias abertas
        </label>
      </div>

      {list.isPending ? (
        <LoadingSkeleton rows={6} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : list.data.items.length === 0 ? (
        <EmptyState title={queue ? 'Fila vazia' : 'Nenhuma ocorrência encontrada'} message={queue ? 'Nada aguardando moderação.' : 'Ajuste os filtros.'} />
      ) : (
        <>
          <p className="caption muted">{list.data.total} ocorrência(s)</p>
          <table className="table">
            <thead>
              <tr>
                <th>Nº</th>
                <th>Ocorrência</th>
                <th>Gravidade</th>
                <th>Status</th>
                <th className="num">Confirmações</th>
                <th className="num">Denúncias</th>
                <th>Registrada em</th>
              </tr>
            </thead>
            <tbody>
              {list.data.items.map((o) => (
                <tr key={o.id}>
                  <td>#{o.code}</td>
                  <td>
                    <Link to={`/occurrences/${o.id}`}>{o.title}</Link>
                    <div className="caption muted">
                      {o.neighborhood ?? 'Bairro não informado'} · por {o.author.name} {o.isDemo && <DemoBadge />}
                    </div>
                  </td>
                  <td>
                    <SeverityBadge severity={o.severity} />
                  </td>
                  <td>
                    <StatusBadge status={o.status} />
                  </td>
                  <td className="num">
                    {o.confirmCount} / <span title="Contestações">{o.contestCount}</span>
                  </td>
                  <td className="num">{o.openReports > 0 ? <strong className="danger-text">{o.openReports}</strong> : 0}</td>
                  <td>{formatDateTime(o.createdAt)}</td>
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

function ReportsQueue() {
  const [page, setPage] = useState(1);
  const toast = useToast();
  const queryClient = useQueryClient();
  const reports = useQuery({ queryKey: ['content-reports', page], queryFn: () => http.contentReports('OPEN', page), placeholderData: keepPreviousData });
  const resolve = useMutation({
    mutationFn: ({ id, status }: { id: string; status: 'REVIEWED' | 'DISMISSED' }) => http.resolveReport(id, status),
    onSuccess: (_, v) => {
      toast(v.status === 'REVIEWED' ? 'Denúncia marcada como procedente.' : 'Denúncia descartada.', 'success');
      void queryClient.invalidateQueries({ queryKey: ['content-reports'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['occurrences'] });
    },
    onError: (e) => toast(e instanceof ApiError ? e.message : 'Não foi possível encerrar a denúncia.', 'error'),
  });

  if (reports.isPending) return <LoadingSkeleton rows={4} />;
  if (reports.isError) return <ErrorState error={reports.error} onRetry={() => void reports.refetch()} />;
  if (reports.data.items.length === 0) return <EmptyState title="Nenhuma denúncia aberta" message="Denúncias feitas pelos cidadãos no app aparecem aqui." />;

  return (
    <section className="card">
      <p className="caption muted">{reports.data.total} denúncia(s) aberta(s), mais antigas primeiro</p>
      <table className="table">
        <thead>
          <tr>
            <th>Ocorrência</th>
            <th>Motivo</th>
            <th>Denunciante</th>
            <th>Recebida em</th>
            <th>Ações</th>
          </tr>
        </thead>
        <tbody>
          {reports.data.items.map((r) => (
            <tr key={r.id}>
              <td>
                <Link to={`/occurrences/${r.occurrence.id}`}>
                  #{r.occurrence.code} {r.occurrence.title}
                </Link>
                <div>
                  <StatusBadge status={r.occurrence.status} />
                </div>
              </td>
              <td>
                {REPORT_REASON_LABEL[r.reason] ?? r.reason}
                {r.details && <div className="caption muted">“{r.details}”</div>}
              </td>
              <td>{r.reporter}</td>
              <td>{formatDateTime(r.createdAt)}</td>
              <td className="actions">
                <button className="btn secondary" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'REVIEWED' })}>
                  Procedente
                </button>
                <button className="btn ghost" disabled={resolve.isPending} onClick={() => resolve.mutate({ id: r.id, status: 'DISMISSED' })}>
                  Descartar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <Pagination page={page} limit={20} total={reports.data.total} onPage={setPage} />
    </section>
  );
}
