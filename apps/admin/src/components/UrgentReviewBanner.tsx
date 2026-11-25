import type { NewsReviewEventPayload } from '@alertacidade/shared-types';
import { Link } from 'react-router';
import { SEVERITY_LABEL } from '../lib/format';

/**
 * Destaque em tempo real para a moderação: notícia que exige revisão urgente (ex.: crítico de
 * fonte única, publicado no mapa sem push). Fica até o moderador abrir ou dispensar.
 */
export function UrgentReviewBanner({ items, onDismiss }: { items: NewsReviewEventPayload[]; onDismiss: (eventId: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="urgent-reviews" role="alert" aria-live="assertive">
      {items.map((p) => (
        <div key={p.eventId} className="urgent-review">
          <strong>Revisão urgente</strong>
          <span>
            N-{p.code} · {p.title}
            {p.city ? ` · ${p.city}` : ''} · {p.severity ? `gravidade ${SEVERITY_LABEL[p.severity].toLowerCase()}` : 'gravidade não informada'}
            {p.status === 'PUBLISHED_PRELIMINARY' ? ' · já no mapa, sem push' : ' · fora do app até a decisão'}
          </span>
          <Link className="btn primary" to={`/news/events/${p.eventId}`} onClick={() => onDismiss(p.eventId)}>
            Revisar
          </Link>
          <button className="btn ghost" onClick={() => onDismiss(p.eventId)} aria-label={`Dispensar aviso de N-${p.code}`}>
            Dispensar
          </button>
        </div>
      ))}
    </div>
  );
}
