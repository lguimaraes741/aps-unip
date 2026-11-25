import type { NewsEventStatus, Severity } from '@alertacidade/shared-types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ApiError } from '../api/client';
import { http, type NewsAction, type NewsEventDetail } from '../api/endpoints';
import {
  ConfidenceBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  NewsSeverityBadge,
  NewsStatusBadge,
  useToast,
} from '../components/ui';
import {
  ACTION_TEXT,
  formatDateTime,
  NEWS_ACTION_LABEL,
  NEWS_STATUS_LABEL,
  PRECISION_LABEL,
  RELIABILITY_LABEL,
  ROLE_LABEL,
  SEVERITIES,
  SEVERITY_LABEL,
  TEMPORALITY_LABEL,
} from '../lib/format';

const ACTION_FOR: Partial<Record<NewsEventStatus, NewsAction>> = { PUBLISHED_VERIFIED: 'approve', DISCARDED: 'reject', RESOLVED: 'resolve' };

export function NewsEventDetailPage() {
  const { id = '' } = useParams();
  const detail = useQuery({ queryKey: ['news-event', id], queryFn: () => http.newsEvent(id) });

  if (detail.isPending) return <LoadingSkeleton rows={6} />;
  if (detail.isError) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const e = detail.data;
  const official = e.sources.some((s) => s.source.reliability === 'OFFICIAL');

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <Link to="/news" className="caption">
            ← Monitoramento de notícias
          </Link>
          <h1>
            N-{e.code} {e.title}
          </h1>
          <div className="badges">
            <NewsSeverityBadge severity={e.estimatedSeverity} /> <ConfidenceBadge confidence={e.confidence} /> <NewsStatusBadge status={e.status} />
            {e.urgentReview && <span className="badge urgent">Revisão urgente</span>}
          </div>
        </div>
      </header>

      {!official && (
        <p className="notice">
          Evento identificado a partir de notícias jornalísticas — não é comunicado oficial da Defesa Civil. Gravidade = impacto relatado; confiança =
          qualidade das evidências.
        </p>
      )}

      <div className="grid-2 wide-left">
        <div className="stack">
          <section className="card">
            <h2>Resumo</h2>
            <dl className="facts">
              <dt>Local</dt>
              <dd>
                {e.region ? (e.region.kind === 'DISTRICT' ? `${e.region.name}, ${e.city}` : e.region.name) : <span className="danger-text">Não identificado</span>}
                <span className="muted"> · {PRECISION_LABEL[e.locationPrecision]}</span>
                {e.placeText && <div className="caption muted">Citado: {e.placeText}</div>}
              </dd>
              <dt>Primeira notícia</dt>
              <dd>{formatDateTime(e.firstEvidenceAt)}</dd>
              <dt>Última notícia</dt>
              <dd>{formatDateTime(e.lastEvidenceAt)}</dd>
              <dt>Fontes</dt>
              <dd>
                {e.sources.length} ligada(s) · {e.independentSources} contam como confirmação independente
              </dd>
              <dt>Regras</dt>
              <dd>{e.rulesVersion}</dd>
            </dl>
            {e.decisionReasons.length > 0 && (
              <>
                <h3>Decisão automática</h3>
                <ul className="evidence">
                  {e.decisionReasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </>
            )}
          </section>

          <section className="card">
            <h2>Fontes ({e.sources.length})</h2>
            {e.sources.length === 0 ? (
              <EmptyState title="Sem fontes" message="As fontes deste evento foram movidas para outro (duplicidade)." />
            ) : (
              e.sources.map((s) => (
                <article key={s.articleId} className="source-item">
                  <strong>{s.title}</strong>
                  <div className="caption muted">
                    {s.source.name} · {RELIABILITY_LABEL[s.source.reliability]} · publicada {formatDateTime(s.publishedAt)}
                    {!s.isIndependent && <span className="danger-text"> · mesma origem de outra fonte (não conta como confirmação)</span>}
                    {s.linkedBy === 'MODERATOR' && ' · vinculada por moderador'}
                  </div>
                  {s.summary && <p className="caption">{s.summary}</p>}
                  <a href={s.url} target="_blank" rel="noopener noreferrer">
                    Ver notícia original ↗
                  </a>
                  {s.analysis && (
                    <>
                      <ul className="evidence" aria-label="Evidências encontradas no texto">
                        <li>
                          {TEMPORALITY_LABEL[s.analysis.temporality ?? ''] ?? '—'} · gravidade {s.analysis.estimatedSeverity ? SEVERITY_LABEL[s.analysis.estimatedSeverity].toLowerCase() : 'não informada'}
                        </li>
                        {s.analysis.severityEvidence.map((ev, i) => (
                          <li key={`e${i}`}>
                            {ev.label}: <q>{ev.excerpt}</q>
                          </li>
                        ))}
                        {s.analysis.discardedEvidence.map((ev, i) => (
                          <li key={`d${i}`} className="discarded" title={`Ignorada por ${ev.why}`}>
                            {ev.label}: <q>{ev.excerpt}</q> ({ev.why})
                          </li>
                        ))}
                        {(s.analysis.location?.ambiguities ?? []).map((a, i) => (
                          <li key={`a${i}`} className="danger-text">
                            Local ambíguo: {a}
                          </li>
                        ))}
                        {s.analysis.missing.length > 0 && <li className="muted">Ausente na fonte: {s.analysis.missing.join('; ')}</li>}
                      </ul>
                    </>
                  )}
                </article>
              ))
            )}
          </section>
        </div>

        <div className="stack">
          <DecisionPanel event={e} />
          <CorrectionPanel event={e} />
          <MergePanel event={e} />
          <section className="card">
            <h2>Auditoria</h2>
            {e.audit.length === 0 ? (
              <p className="muted">Nenhuma ação de moderação ainda.</p>
            ) : (
              <ol className="timeline">
                {e.audit.map((a, i) => (
                  <li key={i}>
                    <strong>{ACTION_TEXT[a.action] ?? a.action}</strong>
                    <span className="caption muted">
                      {formatDateTime(a.createdAt)} · {a.actor ? `${a.actor.name} (${ROLE_LABEL[a.actor.role]})` : 'sistema'}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function useInvalidate(id: string) {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ['news-event', id] });
    void queryClient.invalidateQueries({ queryKey: ['news-review'] });
    void queryClient.invalidateQueries({ queryKey: ['news-metrics'] });
  };
}

function DecisionPanel({ event: e }: { event: NewsEventDetail }) {
  const toast = useToast();
  const invalidate = useInvalidate(e.id);
  const [target, setTarget] = useState<NewsEventStatus | null>(null);
  const [note, setNote] = useState('');
  const close = () => (setTarget(null), setNote(''));

  const decide = useMutation({
    mutationFn: (to: NewsEventStatus) => http.newsDecision(e.id, ACTION_FOR[to]!, { expectedVersion: e.version, note: note.trim() || undefined }),
    onSuccess: (r) => (toast(`Evento N-${e.code}: ${NEWS_STATUS_LABEL[r.status]}.`, 'success'), close()),
    onError: (err) => {
      toast(err instanceof ApiError ? err.message : 'Não foi possível salvar a decisão.', 'error');
      if (err instanceof ApiError && err.isConflict) close();
    },
    onSettled: invalidate,
  });
  const needsNote = target === 'DISCARDED';
  const blockedByLocation = target === 'PUBLISHED_VERIFIED' && e.locationPrecision === 'UNKNOWN';

  return (
    <section className="card">
      <h2>Decisão</h2>
      {e.moderatedBy && (
        <p className="caption muted">
          Última ação de {e.moderatedBy.name}
          {e.moderationNote && <> — “{e.moderationNote}”</>}
        </p>
      )}
      {e.allowedTransitions.length === 0 ? (
        <p className="muted">Evento encerrado ({NEWS_STATUS_LABEL[e.status]}): não há mais decisões.</p>
      ) : (
        <div className="actions wrap">
          {e.allowedTransitions.map((s) => (
            <button key={s} className={`btn ${s === 'DISCARDED' ? 'danger' : s === 'PUBLISHED_VERIFIED' ? 'primary' : 'secondary'}`} onClick={() => setTarget(s)}>
              {NEWS_ACTION_LABEL[s]}
            </button>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        title={target ? `${NEWS_ACTION_LABEL[target]} o evento N-${e.code}?` : ''}
        message={
          blockedByLocation
            ? 'A localização não foi identificada. Corrija o local antes de validar — um alerta sem local não pode ser publicado.'
            : target === 'PUBLISHED_VERIFIED'
              ? 'O evento passa a "publicado (verificado)" com o seu nome como responsável pela validação.'
              : target === 'DISCARDED'
                ? 'O evento sai das listas e do mapa. Informe o motivo (fica na auditoria).'
                : 'O alerta é encerrado (situação normalizada).'
        }
        confirmLabel={target ? NEWS_ACTION_LABEL[target]! : ''}
        destructive={target === 'DISCARDED'}
        busy={decide.isPending}
        confirmDisabled={blockedByLocation || (needsNote && note.trim().length < 3)}
        onConfirm={() => target && decide.mutate(target)}
        onCancel={close}
      >
        <label className="field">
          {needsNote ? 'Motivo do descarte (obrigatório)' : 'Observação (opcional)'}
          <textarea value={note} maxLength={500} rows={3} onChange={(ev) => setNote(ev.target.value)} />
        </label>
      </ConfirmDialog>
    </section>
  );
}

function CorrectionPanel({ event: e }: { event: NewsEventDetail }) {
  const toast = useToast();
  const invalidate = useInvalidate(e.id);
  const regions = useQuery({ queryKey: ['news-regions'], queryFn: () => http.newsRegions(), staleTime: 3_600_000 });
  const [severity, setSeverity] = useState<Severity | 'NONE' | ''>('');
  const [region, setRegion] = useState('');
  const save = useMutation({
    mutationFn: () => http.newsUpdate(e.id, { expectedVersion: e.version, ...(severity && { severity }), ...(region && { regionIbge: region }) }),
    onSuccess: () => (toast('Correção salva. A automação não sobrescreve o que foi corrigido.', 'success'), setSeverity(''), setRegion('')),
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Não foi possível salvar a correção.', 'error'),
    onSettled: invalidate,
  });
  if (e.allowedTransitions.length === 0) return null;

  return (
    <section className="card">
      <h2>Corrigir</h2>
      <label className="field">
        Gravidade
        <select value={severity} onChange={(ev) => setSeverity(ev.target.value as Severity | 'NONE' | '')}>
          <option value="">Manter ({e.estimatedSeverity ? SEVERITY_LABEL[e.estimatedSeverity] : 'não informada'})</option>
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {SEVERITY_LABEL[s]}
            </option>
          ))}
          <option value="NONE">Não informada</option>
        </select>
      </label>
      <label className="field">
        Localização
        <select value={region} onChange={(ev) => setRegion(ev.target.value)} disabled={!regions.data}>
          <option value="">Manter ({e.region?.name ?? 'não identificada'})</option>
          {regions.data?.map((r) => (
            <option key={r.ibgeCode} value={r.ibgeCode}>
              {r.kind === 'DISTRICT' ? `${r.name} (distrito de ${r.city})` : r.name}
            </option>
          ))}
        </select>
      </label>
      <button className="btn secondary" disabled={(!severity && !region) || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? 'Salvando…' : 'Salvar correção'}
      </button>
    </section>
  );
}

function MergePanel({ event: e }: { event: NewsEventDetail }) {
  const toast = useToast();
  const invalidate = useInvalidate(e.id);
  const [open, setOpen] = useState(false);
  const [into, setInto] = useState('');
  const candidates = useQuery({
    queryKey: ['news-review', { merge: e.id }],
    queryFn: () => http.newsReview({ limit: 50 }),
    enabled: open,
  });
  const merge = useMutation({
    mutationFn: () => http.newsMerge(e.id, { expectedVersion: e.version, intoEventId: into }),
    onSuccess: (r) => (toast(`${r.movedSources} fonte(s) movida(s). Este evento foi descartado como duplicado.`, 'success'), setOpen(false)),
    onError: (err) => toast(err instanceof ApiError ? err.message : 'Não foi possível mesclar.', 'error'),
    onSettled: invalidate,
  });
  if (e.allowedTransitions.length === 0) return null;
  const others = (candidates.data?.items ?? []).filter((c) => c.id !== e.id);

  return (
    <section className="card">
      <h2>Duplicidade</h2>
      <p className="caption muted">Se este evento descreve o mesmo alagamento de outro, mescle: as fontes passam para o outro e este é descartado.</p>
      <button className="btn ghost" onClick={() => setOpen(true)}>
        Marcar como duplicado…
      </button>
      <ConfirmDialog
        open={open}
        title={`Mesclar N-${e.code} em outro evento`}
        message="Escolha o evento que fica. A gravidade e a confiança dele serão recalculadas com as novas fontes."
        confirmLabel="Mesclar"
        busy={merge.isPending}
        confirmDisabled={!into}
        onConfirm={() => merge.mutate()}
        onCancel={() => setOpen(false)}
      >
        <label className="field">
          Evento de destino
          <select value={into} onChange={(ev) => setInto(ev.target.value)}>
            <option value="">Selecione…</option>
            {others.map((c) => (
              <option key={c.id} value={c.id}>
                N-{c.code} · {c.city ?? 'sem local'} · {c.title.slice(0, 60)}
              </option>
            ))}
          </select>
        </label>
      </ConfirmDialog>
    </section>
  );
}
