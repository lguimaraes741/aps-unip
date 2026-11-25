import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { http } from '../api/endpoints';
import { EmptyState, ErrorState, LoadingSkeleton, Pagination } from '../components/ui';
import { ACTION_TEXT, formatDateTime, ROLE_LABEL } from '../lib/format';

/** Campos alterados entre "antes" e "depois" (mostra só o que mudou). */
export function diff(before: Record<string, unknown> | null, after: Record<string, unknown> | null) {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  return [...keys]
    .map((key) => ({ key, before: before?.[key], after: after?.[key] }))
    .filter((c) => JSON.stringify(c.before) !== JSON.stringify(c.after));
}

const show = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

export function AuditPage() {
  const [action, setAction] = useState('');
  const [entityId, setEntityId] = useState('');
  const [page, setPage] = useState(1);
  const filters = { action: action || undefined, entityId: entityId.trim() || undefined, page };
  const trail = useQuery({ queryKey: ['audit', filters], queryFn: () => http.audit(filters), placeholderData: keepPreviousData });

  return (
    <div className="page">
      <header className="page-header">
        <h1>Auditoria</h1>
        <span className="caption muted">Quem fez o quê, quando, de onde — com o antes e o depois. Senhas e tokens nunca são registrados.</span>
      </header>
      <section className="card">
        <div className="filters">
          <select aria-label="Ação" value={action} onChange={(e) => (setAction(e.target.value), setPage(1))}>
            <option value="">Todas as ações</option>
            {Object.entries(ACTION_TEXT).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <input aria-label="Identificador do registro" placeholder="Identificador do registro (opcional)" value={entityId} onChange={(e) => (setEntityId(e.target.value), setPage(1))} />
        </div>
        {trail.isPending ? (
          <LoadingSkeleton rows={6} />
        ) : trail.isError ? (
          <ErrorState error={trail.error} onRetry={() => void trail.refetch()} />
        ) : trail.data.items.length === 0 ? (
          <EmptyState title="Nenhum registro de auditoria" />
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Quando</th>
                  <th>Quem</th>
                  <th>Ação</th>
                  <th>Registro</th>
                  <th>Alterações</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {trail.data.items.map((e) => (
                  <tr key={e.id}>
                    <td>{formatDateTime(e.createdAt)}</td>
                    <td>{e.actor ? `${e.actor.name} (${ROLE_LABEL[e.actor.role]})` : 'Sistema / conta removida'}</td>
                    <td>{ACTION_TEXT[e.action] ?? e.action}</td>
                    <td className="caption">
                      {e.entityType}
                      <div className="muted mono">{e.entityId}</div>
                    </td>
                    <td>
                      <ul className="diff">
                        {diff(e.before, e.after).map((c) => (
                          <li key={c.key}>
                            <code>{c.key}</code>: <del>{show(c.before)}</del> → <ins>{show(c.after)}</ins>
                          </li>
                        ))}
                      </ul>
                    </td>
                    <td className="mono caption">{e.ipAddress ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={page} limit={25} total={trail.data.total} onPage={setPage} />
          </>
        )}
      </section>
    </div>
  );
}
