import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { http } from '../api/endpoints';
import { BarChart, EmptyState, ErrorState, LoadingSkeleton, MetricCard, SeverityBadge, StatusBadge } from '../components/ui';
import { formatDateTime, formatDay, formatMinutes, formatNumber, SEVERITIES, SEVERITY_LABEL, STATUS_LABEL, STATUSES, variation } from '../lib/format';

export function DashboardPage() {
  const dashboard = useQuery({ queryKey: ['dashboard'], queryFn: http.dashboard });
  const queue = useQuery({
    queryKey: ['occurrences', 'queue-preview'],
    queryFn: () => http.occurrences({ status: ['PENDING', 'UNDER_REVIEW'], limit: 6 }),
  });

  if (dashboard.isPending) return <LoadingSkeleton rows={6} />;
  if (dashboard.isError) return <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />;
  const d = dashboard.data;
  const activeTotal = SEVERITIES.reduce((sum, s) => sum + d.activeBySeverity[s], 0);

  return (
    <div className="page">
      <header className="page-header">
        <h1>Dashboard</h1>
        <span className="caption muted">Atualizado {formatDateTime(d.generatedAt)}</span>
      </header>
      {d.demo > 0 && (
        <p className="notice">
          Os números incluem <strong>{d.demo}</strong> registro(s) de demonstração (seed), marcados com o selo “Demonstração”.
        </p>
      )}

      <section className="metrics">
        <MetricCard label="Fila de moderação" value={formatNumber(d.moderationQueue)} hint="Pendentes + em análise" tone={d.moderationQueue > 0 ? 'warning' : undefined} />
        <MetricCard label="Denúncias abertas" value={formatNumber(d.openReports)} tone={d.openReports > 0 ? 'danger' : undefined} />
        <MetricCard label="Registradas nas últimas 24 h" value={formatNumber(d.last24h)} hint={variation(d.last24h, d.previous24h)} />
        <MetricCard label="Tempo médio até validar (30 dias)" value={formatMinutes(d.avgValidationMinutes30d)} />
      </section>

      <div className="grid-2">
        <section className="card">
          <h2>Últimos 14 dias</h2>
          <BarChart
            title="Ocorrências registradas e resolvidas por dia"
            data={d.daily.map((x) => ({ label: formatDay(x.day), created: x.created, resolved: x.resolved }))}
            series={[
              { key: 'created', label: 'Registradas', color: 'var(--ac-color-brand-primary)' },
              { key: 'resolved', label: 'Resolvidas', color: 'var(--ac-status-resolved-base)' },
            ]}
          />
        </section>
        <section className="card">
          <h2>Ativas por gravidade</h2>
          {activeTotal === 0 ? (
            <EmptyState title="Nenhuma ocorrência ativa" />
          ) : (
            <ul className="bars">
              {SEVERITIES.map((s) => (
                <li key={s}>
                  <SeverityBadge severity={s} />
                  <span className="bar-track">
                    <span className={`bar-fill sev-fill-${s.toLowerCase()}`} style={{ width: `${(d.activeBySeverity[s] / activeTotal) * 100}%` }} />
                  </span>
                  <strong aria-label={`${SEVERITY_LABEL[s]}: ${d.activeBySeverity[s]}`}>{d.activeBySeverity[s]}</strong>
                </li>
              ))}
            </ul>
          )}
          <h2>Por status</h2>
          <ul className="status-list">
            {STATUSES.map((s) => (
              <li key={s}>
                <StatusBadge status={s} /> <strong aria-label={`${STATUS_LABEL[s]}: ${d.status[s]}`}>{d.status[s]}</strong>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <div className="grid-2">
        <section className="card">
          <header className="card-header">
            <h2>Fila de moderação</h2>
            <Link to="/occurrences?tab=queue">Ver tudo</Link>
          </header>
          {queue.isPending ? (
            <LoadingSkeleton rows={3} />
          ) : queue.isError ? (
            <ErrorState error={queue.error} onRetry={() => void queue.refetch()} />
          ) : queue.data.items.length === 0 ? (
            <EmptyState title="Fila vazia" message="Nenhuma ocorrência aguardando moderação." />
          ) : (
            <ul className="queue">
              {queue.data.items.map((o) => (
                <li key={o.id}>
                  <Link to={`/occurrences/${o.id}`}>
                    #{o.code} {o.title}
                  </Link>
                  <span>
                    <SeverityBadge severity={o.severity} /> <StatusBadge status={o.status} />
                  </span>
                  <span className="caption muted">
                    {o.neighborhood ?? 'Bairro não informado'} · {formatDateTime(o.createdAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="card">
          <h2>Bairros com mais registros (30 dias)</h2>
          {d.topNeighborhoods30d.length === 0 ? (
            <EmptyState title="Sem registros no período" />
          ) : (
            <table className="table compact">
              <thead>
                <tr>
                  <th>Bairro</th>
                  <th className="num">Ocorrências</th>
                </tr>
              </thead>
              <tbody>
                {d.topNeighborhoods30d.map((n) => (
                  <tr key={n.neighborhood}>
                    <td>{n.neighborhood}</td>
                    <td className="num">{n.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  );
}
