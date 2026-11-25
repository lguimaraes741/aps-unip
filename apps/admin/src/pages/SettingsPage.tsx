import { useQuery } from '@tanstack/react-query';
import { API_URL } from '../api/client';
import { http } from '../api/endpoints';
import { ErrorState, LoadingSkeleton } from '../components/ui';
import { formatDateTime } from '../lib/format';

/**
 * Ambiente da plataforma (somente leitura). As configurações ficam nas variáveis de ambiente
 * do servidor (.env), validadas na inicialização — não há configuração editável pelo painel.
 */
export function SettingsPage() {
  const health = useQuery({ queryKey: ['health'], queryFn: http.health, refetchInterval: 15_000 });
  return (
    <div className="page">
      <header className="page-header">
        <h1>Ambiente</h1>
      </header>
      <section className="card">
        <h2>Saúde dos serviços</h2>
        {health.isPending ? (
          <LoadingSkeleton rows={3} />
        ) : health.isError ? (
          <ErrorState error={health.error} onRetry={() => void health.refetch()} />
        ) : (
          <dl className="facts">
            <dt>Situação</dt>
            <dd className={health.data.status === 'ok' ? 'ok-text' : 'danger-text'}>{health.data.status === 'ok' ? 'Operando normalmente' : 'Degradada (tempo real e push em espera)'}</dd>
            <dt>Banco de dados</dt>
            <dd>
              {health.data.checks.database === 'up' ? 'Disponível' : 'Indisponível'} · PostGIS {health.data.checks.postgis}
            </dd>
            <dt>Redis (filas e tempo real)</dt>
            <dd>{health.data.checks.redis === 'up' ? 'Disponível' : 'Indisponível'}</dd>
            <dt>Ambiente</dt>
            <dd>{health.data.environment}</dd>
            <dt>Versão da API</dt>
            <dd>{health.data.version}</dd>
            <dt>Endereço da API</dt>
            <dd className="mono">{API_URL}</dd>
            <dt>Verificado em</dt>
            <dd>{formatDateTime(health.data.timestamp)}</dd>
          </dl>
        )}
        <p className="caption muted">As configurações da plataforma ficam nas variáveis de ambiente do servidor e são validadas quando ela inicia.</p>
      </section>
    </div>
  );
}
