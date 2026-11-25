import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError } from '../api/client';
import { http } from '../api/endpoints';
import { BarChart, EmptyState, ErrorState, LoadingSkeleton, MetricCard, SeverityBadge, StatusBadge, useToast } from '../components/ui';
import { formatDay, formatMinutes, formatNumber, SEVERITIES, STATUSES, toDateInput } from '../lib/format';

/** [início, fim] escolhidos como datas locais → intervalo [from, to) em ISO (fim inclusivo para o usuário). */
export function periodToRange(start: string, end: string): { from: string; to: string } {
  const from = new Date(`${start}T00:00:00`);
  const to = new Date(`${end}T00:00:00`);
  to.setDate(to.getDate() + 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export function ReportsPage() {
  const today = new Date();
  const [start, setStart] = useState(toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)));
  const [end, setEnd] = useState(toDateInput(today));
  const [includeDemo, setIncludeDemo] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const toast = useToast();
  const range = periodToRange(start, end);
  const valid = start <= end;

  const stats = useQuery({ queryKey: ['statistics', range], queryFn: () => http.statistics(range.from, range.to), enabled: valid });

  const download = async () => {
    setDownloading(true);
    try {
      const res = await http.exportCsv({ ...range, includeDemo });
      const blob = await res.blob();
      const name = /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'ocorrencias.csv';
      const url = URL.createObjectURL(blob);
      const a = Object.assign(document.createElement('a'), { href: url, download: name });
      a.click();
      URL.revokeObjectURL(url);
      toast('CSV gerado.', 'success');
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Não foi possível exportar.', 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="page">
      <header className="page-header">
        <h1>Relatórios</h1>
      </header>
      <section className="card filters">
        <label>
          De
          <input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} />
        </label>
        <label>
          Até
          <input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} /> Incluir registros de demonstração no CSV
        </label>
        <button className="btn primary" onClick={() => void download()} disabled={!valid || downloading}>
          {downloading ? 'Gerando…' : 'Exportar CSV'}
        </button>
        <span className="caption muted">Dias contados no horário de Brasília.</span>
      </section>

      {!valid ? (
        <ErrorState error={new ApiError(400, 'A data final deve ser igual ou posterior à inicial.')} />
      ) : stats.isPending ? (
        <LoadingSkeleton rows={5} />
      ) : stats.isError ? (
        <ErrorState error={stats.error} onRetry={() => void stats.refetch()} />
      ) : stats.data.total === 0 ? (
        <EmptyState title="Nenhuma ocorrência no período" />
      ) : (
        <>
          {stats.data.demo > 0 && <p className="notice">O relatório inclui {stats.data.demo} registro(s) de demonstração (o CSV só os inclui se marcado acima).</p>}
          <section className="metrics">
            <MetricCard label="Ocorrências no período" value={formatNumber(stats.data.total)} />
            <MetricCard label="Taxa de resolução" value={stats.data.resolutionRate === null ? '—' : `${Math.round(stats.data.resolutionRate * 100)}%`} hint="Resolvidas ÷ validadas" />
            <MetricCard label="Tempo médio até validar" value={formatMinutes(stats.data.avgValidationMinutes)} />
            <MetricCard label="Críticas" value={formatNumber(stats.data.bySeverity.CRITICAL)} tone={stats.data.bySeverity.CRITICAL > 0 ? 'danger' : undefined} />
          </section>
          <div className="grid-2">
            <section className="card">
              <h2>Por dia</h2>
              <BarChart title="Ocorrências por dia" data={stats.data.byDay.map((d) => ({ label: formatDay(d.day), total: d.total }))} series={[{ key: 'total', label: 'Ocorrências', color: 'var(--ac-color-brand-primary)' }]} />
            </section>
            <section className="card">
              <h2>Por status e gravidade</h2>
              <table className="table compact">
                <tbody>
                  {STATUSES.map((s) => (
                    <tr key={s}>
                      <td>
                        <StatusBadge status={s} />
                      </td>
                      <td className="num">{stats.data.byStatus[s]}</td>
                    </tr>
                  ))}
                  {SEVERITIES.map((s) => (
                    <tr key={s}>
                      <td>
                        <SeverityBadge severity={s} />
                      </td>
                      <td className="num">{stats.data.bySeverity[s]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
          <section className="card">
            <h2>Por bairro</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Bairro</th>
                  <th className="num">Total</th>
                  <th className="num">Críticas</th>
                  <th className="num">Altas</th>
                  <th className="num">Resolvidas</th>
                </tr>
              </thead>
              <tbody>
                {stats.data.byNeighborhood.map((n) => (
                  <tr key={n.neighborhood}>
                    <td>{n.neighborhood}</td>
                    <td className="num">{n.total}</td>
                    <td className="num">{n.critical}</td>
                    <td className="num">{n.high}</td>
                    <td className="num">{n.resolved}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
