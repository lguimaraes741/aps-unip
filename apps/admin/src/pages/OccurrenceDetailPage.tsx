import type { OccurrenceStatus } from '@alertacidade/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { CircleMarker, MapContainer, TileLayer } from 'react-leaflet';
import { Link, useParams } from 'react-router';
import { API_URL, ApiError } from '../api/client';
import { http, type OccurrenceAnalysis } from '../api/endpoints';
import { ConfirmDialog, DemoBadge, EmptyState, ErrorState, LoadingSkeleton, SeverityBadge, StatusBadge, useToast } from '../components/ui';
import { ACTION_LABEL, formatDateTime, REPORT_REASON_LABEL, ROLE_LABEL, STATUS_LABEL } from '../lib/format';
import { SEVERITY_MARKER } from '../lib/severity';

export function OccurrenceDetailPage() {
  const { id = '' } = useParams();
  const detail = useQuery({ queryKey: ['occurrence', id], queryFn: () => http.occurrence(id) });

  if (detail.isPending) return <LoadingSkeleton rows={6} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const o = detail.data;

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Link to="/occurrences" className="caption">
            ← Ocorrências
          </Link>
          <h1>
            #{o.code} {o.title}
          </h1>
          <div className="badges">
            <SeverityBadge severity={o.severity} /> <StatusBadge status={o.status} /> {o.isDemo && <DemoBadge />}
          </div>
        </div>
      </header>

      <div className="grid-2 wide-left">
        <div className="stack">
          <section className="card">
            <h2>Relato</h2>
            <p className="pre">{o.description}</p>
            <dl className="facts">
              <dt>Endereço</dt>
              <dd>
                {o.address}
                {o.neighborhood && ` · ${o.neighborhood}`}
              </dd>
              <dt>Observado em</dt>
              <dd>{formatDateTime(o.occurredAt)}</dd>
              <dt>Registrado em</dt>
              <dd>{formatDateTime(o.createdAt)}</dd>
              <dt>Autor</dt>
              <dd>
                {o.author.name} ({ROLE_LABEL[o.author.role]}){o.author.email && <span className="muted"> · {o.author.email}</span>}
                {o.author.status !== 'ACTIVE' && <span className="danger-text"> · conta {o.author.status === 'SUSPENDED' ? 'suspensa' : 'excluída'}</span>}
              </dd>
              <dt>Cidadãos</dt>
              <dd>
                {o.confirmCount} confirmação(ões) · {o.contestCount} contestação(ões)
              </dd>
            </dl>
          </section>

          <section className="card">
            <h2>Fotos ({o.photos.length})</h2>
            {o.photos.length === 0 ? (
              <EmptyState title="Sem fotos" />
            ) : (
              <div className="photos">
                {o.photos.map((p, i) => (
                  <a key={p.id} href={`${API_URL}${p.url}`} target="_blank" rel="noreferrer">
                    <img src={`${API_URL}${p.url}`} alt={`Foto ${i + 1} da ocorrência`} loading="lazy" />
                  </a>
                ))}
              </div>
            )}
          </section>

          <section className="card">
            <h2>Localização</h2>
            <div className="mini-map">
              <MapContainer center={[o.latitude, o.longitude]} zoom={16} scrollWheelZoom={false} style={{ height: '100%' }}>
                <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="© OpenStreetMap contributors" />
                <CircleMarker center={[o.latitude, o.longitude]} radius={10} pathOptions={{ color: '#fff', weight: 2, fillColor: SEVERITY_MARKER[o.severity], fillOpacity: 1 }} />
              </MapContainer>
            </div>
            <p className="caption muted">
              {o.latitude.toFixed(5)}, {o.longitude.toFixed(5)}
            </p>
          </section>
        </div>

        <div className="stack">
          <ModerationPanel occurrence={o} />
          <section className="card">
            <h2>Histórico</h2>
            <ol className="timeline">
              {o.history.map((h, i) => (
                <li key={i}>
                  <strong>{h.fromStatus ? `${STATUS_LABEL[h.fromStatus]} → ${STATUS_LABEL[h.toStatus]}` : 'Registrada'}</strong>
                  <span className="caption muted">
                    {formatDateTime(h.createdAt)} · {h.actor ? `${h.actor.name} (${ROLE_LABEL[h.actor.role]})` : 'conta removida'}
                  </span>
                  {h.note && <span className="note">“{h.note}”</span>}
                </li>
              ))}
            </ol>
          </section>
          <section className="card">
            <h2>Denúncias ({o.reports.length})</h2>
            {o.reports.length === 0 ? (
              <EmptyState title="Nenhuma denúncia" />
            ) : (
              <ul className="reports">
                {o.reports.map((r) => (
                  <li key={r.id}>
                    <strong>{REPORT_REASON_LABEL[r.reason] ?? r.reason}</strong> · {r.reporter} · {formatDateTime(r.createdAt)}
                    <span className={`caption ${r.status === 'OPEN' ? 'danger-text' : 'muted'}`}>
                      {r.status === 'OPEN' ? ' Aberta' : r.status === 'REVIEWED' ? ' Procedente' : ' Descartada'}
                    </span>
                    {r.details && <div className="caption muted">“{r.details}”</div>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function ModerationPanel({ occurrence: o }: { occurrence: OccurrenceAnalysis }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [target, setTarget] = useState<OccurrenceStatus | null>(null);
  const [note, setNote] = useState('');

  const change = useMutation({
    mutationFn: (status: OccurrenceStatus) => http.changeStatus(o.id, { status, expectedVersion: o.version, note: note.trim() || undefined }),
    onSuccess: (res) => {
      toast(`Ocorrência #${o.code}: ${STATUS_LABEL[res.status]}. O app e o autor já foram avisados.`, 'success');
      close();
    },
    onError: (e) => {
      toast(e instanceof ApiError ? e.message : 'Não foi possível salvar a moderação.', 'error');
      // Conflito (outro moderador agiu antes): mostra o estado atual.
      if (e instanceof ApiError && e.isConflict) close();
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['occurrence', o.id] });
      void queryClient.invalidateQueries({ queryKey: ['occurrences'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  const close = () => {
    setTarget(null);
    setNote('');
  };
  const needsNote = target === 'REJECTED';

  return (
    <section className="card">
      <h2>Moderação</h2>
      {o.moderatedBy && (
        <p className="caption muted">
          Última ação de {o.moderatedBy.name}
          {o.moderationNote && <> — “{o.moderationNote}”</>}
        </p>
      )}
      {o.allowedTransitions.length === 0 ? (
        <p className="muted">Status final ({STATUS_LABEL[o.status]}): não há mais ações de moderação.</p>
      ) : (
        <div className="actions wrap">
          {o.allowedTransitions.map((s) => (
            <button key={s} className={`btn ${s === 'REJECTED' ? 'danger' : s === 'VALIDATED' ? 'primary' : 'secondary'}`} onClick={() => setTarget(s)}>
              {ACTION_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        title={target ? `${ACTION_LABEL[target]} a ocorrência #${o.code}?` : ''}
        message={
          target === 'REJECTED'
            ? 'Ela deixará de aparecer no mapa para todos, e o autor será avisado do motivo.'
            : target === 'VALIDATED'
              ? 'Ela aparecerá como validada no app, e o autor será avisado.'
              : target === 'RESOLVED'
                ? 'Ela aparecerá como resolvida no app, e o autor será avisado.'
                : 'O status mudará no app imediatamente.'
        }
        confirmLabel={target ? ACTION_LABEL[target] : ''}
        destructive={target === 'REJECTED'}
        busy={change.isPending}
        confirmDisabled={needsNote && note.trim().length < 3}
        onConfirm={() => target && change.mutate(target)}
        onCancel={close}
      >
        <label className="field">
          {needsNote ? 'Motivo da rejeição (obrigatório, visível no histórico)' : 'Observação (opcional, visível no histórico)'}
          <textarea value={note} maxLength={500} rows={3} onChange={(e) => setNote(e.target.value)} />
        </label>
      </ConfirmDialog>
    </section>
  );
}
