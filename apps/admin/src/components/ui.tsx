import type { NewsConfidence, NewsEventStatus, OccurrenceStatus, Severity } from '@alertacidade/shared-types';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { CONFIDENCE_LABEL, NEWS_STATUS_LABEL, SEVERITY_LABEL, STATUS_LABEL } from '../lib/format';

// ---------------------------------------------------------------------------
// Selos: gravidade e status nunca compartilham o mesmo elemento visual; status sempre com ícone.
// ---------------------------------------------------------------------------

const STATUS_ICON: Record<OccurrenceStatus, string> = { PENDING: '◷', UNDER_REVIEW: '⌕', VALIDATED: '✓', REJECTED: '✕', RESOLVED: '✔' };

export function SeverityBadge({ severity }: { severity: Severity }) {
  return <span className={`badge sev-${severity.toLowerCase()}`}>{SEVERITY_LABEL[severity]}</span>;
}

export function StatusBadge({ status }: { status: OccurrenceStatus }) {
  return (
    <span className={`badge status status-${status.toLowerCase().replace('_', '-')}`}>
      <span aria-hidden="true">{STATUS_ICON[status]}</span> {STATUS_LABEL[status]}
    </span>
  );
}

/** Gravidade de notícia pode ser "não informada" — nunca é mostrada como baixa. */
export function NewsSeverityBadge({ severity }: { severity: Severity | null }) {
  if (!severity) {
    return (
      <span className="badge sev-none" title="A fonte não descreve o impacto: gravidade não informada (não significa baixa)">
        Não informada
      </span>
    );
  }
  return <SeverityBadge severity={severity} />;
}

const NEWS_STATUS_ICON: Record<NewsEventStatus, string> = {
  AWAITING_VALIDATION: '◷',
  PUBLISHED_PRELIMINARY: '◐',
  PUBLISHED_VERIFIED: '✓',
  DISCARDED: '✕',
  OUTDATED: '⌛',
  RESOLVED: '✔',
};

export function NewsStatusBadge({ status }: { status: NewsEventStatus }) {
  return (
    <span className={`badge status news-${status.toLowerCase().replace(/_/g, '-')}`}>
      <span aria-hidden="true">{NEWS_STATUS_ICON[status]}</span> {NEWS_STATUS_LABEL[status]}
    </span>
  );
}

export function ConfidenceBadge({ confidence }: { confidence: NewsConfidence }) {
  return <span className={`badge conf-${confidence.toLowerCase()}`}>Confiança {CONFIDENCE_LABEL[confidence].toLowerCase()}</span>;
}

export function DemoBadge() {
  return (
    <span className="badge demo" title="Registro de demonstração (seed), não é um relato real">
      Demonstração
    </span>
  );
}

// ---------------------------------------------------------------------------
// Estados de tela (toda tela usa os três)
// ---------------------------------------------------------------------------

export function LoadingSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-list" role="status" aria-label="Carregando">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

export function EmptyState({ title, message }: { title: string; message?: string }) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {message && <p className="muted">{message}</p>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof ApiError ? error.message : 'Não foi possível carregar os dados.';
  return (
    <div className="error-state" role="alert">
      <p>{message}</p>
      {onRetry && (
        <button className="btn secondary" onClick={onRetry}>
          Tentar novamente
        </button>
      )}
    </div>
  );
}

export function MetricCard({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: string | null; tone?: 'warning' | 'danger' }) {
  return (
    <div className={`card metric ${tone ?? ''}`}>
      <span className="metric-label">{label}</span>
      <strong className="metric-value">{value}</strong>
      {hint && <span className="metric-hint">{hint}</span>}
    </div>
  );
}

export function Pagination({ page, limit, total, onPage }: { page: number; limit: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / limit));
  if (pages <= 1) return null;
  return (
    <nav className="pagination" aria-label="Paginação">
      <button className="btn secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span>
        Página {page} de {pages}
      </span>
      <button className="btn secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
        Próxima
      </button>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Gráfico de barras em SVG (sem biblioteca): acessível — tabela equivalente para leitores de tela.
// ---------------------------------------------------------------------------

export interface BarSeries {
  key: string;
  label: string;
  color: string;
}

export function BarChart<T extends { label: string }>({ data, series, title }: { data: (T & Record<string, number | string>)[]; series: BarSeries[]; title: string }) {
  const max = Math.max(1, ...data.flatMap((d) => series.map((s) => Number(d[s.key]) || 0)));
  const width = 640;
  const height = 180;
  const groupW = width / Math.max(data.length, 1);
  const barW = Math.max(2, (groupW - 8) / series.length);
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${width} ${height + 24}`} role="img" aria-label={title} preserveAspectRatio="none">
        {data.map((d, i) =>
          series.map((s, j) => {
            const v = Number(d[s.key]) || 0;
            const h = (v / max) * height;
            return (
              <rect key={`${i}-${s.key}`} x={i * groupW + 4 + j * barW} y={height - h} width={barW - 1} height={h} fill={s.color} rx={2}>
                <title>{`${d.label} — ${s.label}: ${v}`}</title>
              </rect>
            );
          }),
        )}
        {data.map((d, i) =>
          data.length <= 16 || i % 2 === 0 ? (
            <text key={d.label} x={i * groupW + groupW / 2} y={height + 16} textAnchor="middle" className="chart-axis">
              {d.label}
            </text>
          ) : null,
        )}
      </svg>
      <figcaption className="chart-legend">
        {series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} aria-hidden="true" /> {s.label}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Período</th>
            {series.map((s) => (
              <th key={s.key}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.label}>
              <td>{d.label}</td>
              {series.map((s) => (
                <td key={s.key}>{d[s.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ---------------------------------------------------------------------------
// Diálogo de confirmação (ações sensíveis de moderação) — <dialog> nativo, com foco preso.
// ---------------------------------------------------------------------------

export function ConfirmDialog(props: {
  open: boolean;
  title: string;
  message: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  busy?: boolean;
  children?: ReactNode;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (props.open && !dialog.open) dialog.showModal?.();
    if (!props.open && dialog.open) dialog.close?.();
  }, [props.open]);
  if (!props.open) return null;
  return (
    <dialog ref={ref} className="dialog" aria-labelledby={titleId} onCancel={props.onCancel} open={props.open}>
      <h2 id={titleId}>{props.title}</h2>
      <div className="dialog-body">{props.message}</div>
      {props.children}
      <div className="dialog-actions">
        <button className="btn secondary" onClick={props.onCancel} disabled={props.busy}>
          Cancelar
        </button>
        <button className={`btn ${props.destructive ? 'danger' : 'primary'}`} onClick={props.onConfirm} disabled={props.busy || props.confirmDisabled}>
          {props.busy ? 'Salvando…' : props.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

type ToastTone = 'success' | 'error' | 'info';
const ToastContext = createContext<(message: string, tone?: ToastTone) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<{ id: number; message: string; tone: ToastTone }[]>([]);
  const show = useCallback((message: string, tone: ToastTone = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.tone}`}>
            {t.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
