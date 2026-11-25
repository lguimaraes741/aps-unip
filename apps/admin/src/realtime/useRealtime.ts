import type { EventEnvelope, NewsAlertEventPayload, NewsReviewEventPayload, RealtimeEvent } from '@alertacidade/shared-types';

// Literal (o pacote compartilhado é CommonJS; o painel importa dele só tipos).
const NEWS_REVIEW_URGENT: RealtimeEvent = 'news.review.urgent';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, API_URL } from '../api/client';

export type LiveStatus = 'connecting' | 'online' | 'offline';

/** O que um evento muda no painel (função pura, testada isoladamente). */
export type EventEffect =
  | { kind: 'occurrence'; id: string }
  | { kind: 'news'; id: string | null }
  | { kind: 'urgent-review'; payload: NewsReviewEventPayload }
  | { kind: 'ignore' };

export function classifyEvent(event: EventEnvelope<unknown>): EventEffect {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  if (event.type === NEWS_REVIEW_URGENT) return { kind: 'urgent-review', payload: payload as unknown as NewsReviewEventPayload };
  if (event.type.startsWith('news.')) return { kind: 'news', id: (payload as Partial<NewsAlertEventPayload>).eventId ?? null };
  if (typeof payload.occurrenceId === 'string') return { kind: 'occurrence', id: payload.occurrenceId };
  return { kind: 'ignore' }; // tipo de uma versão futura da API
}

/**
 * Mantém o painel atualizado sem recarregar a página: cada evento (de qualquer instância da API,
 * via Redis) invalida as consultas afetadas, agrupando rajadas. Na reconexão tudo é recarregado —
 * o estado no banco é a fonte da verdade. `news.review.urgent` (só chega à equipe) também chama
 * `onUrgentReview`, para o destaque na tela.
 */
export function useRealtime(enabled: boolean, onUrgentReview?: (p: NewsReviewEventPayload) => void): LiveStatus {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('connecting');
  const pending = useRef(new Set<string>());
  const pendingNews = useRef(new Set<string>());
  const newsChanged = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const urgentRef = useRef(onUrgentReview);
  urgentRef.current = onUrgentReview;

  useEffect(() => {
    if (!enabled) return;
    const socket = io(API_URL, {
      transports: ['websocket'],
      // Consultado a cada tentativa: reconexões usam o token já renovado.
      auth: (cb) => cb({ token: api.token ?? '' }),
      reconnectionDelay: 1000,
      reconnectionDelayMax: 15000,
    });

    const flush = () => {
      if (pending.current.size > 0) {
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['occurrences'] });
        void queryClient.invalidateQueries({ queryKey: ['content-reports'] });
        for (const id of pending.current) void queryClient.invalidateQueries({ queryKey: ['occurrence', id] });
      }
      if (newsChanged.current) {
        void queryClient.invalidateQueries({ queryKey: ['news-review'] });
        void queryClient.invalidateQueries({ queryKey: ['news-metrics'] });
        for (const id of pendingNews.current) void queryClient.invalidateQueries({ queryKey: ['news-event', id] });
      }
      pending.current.clear();
      pendingNews.current.clear();
      newsChanged.current = false;
    };

    socket.on('connect', () => {
      setStatus('online');
      void queryClient.invalidateQueries(); // pode ter perdido eventos enquanto estava fora
    });
    socket.on('disconnect', (reason) => {
      setStatus('offline');
      // Encerrada pelo servidor (token expirou): renova e reconecta.
      if (reason === 'io server disconnect') void api.refresh().then((ok) => ok && socket.connect());
    });
    socket.on('connect_error', (err) => {
      setStatus('offline');
      if (err.message === 'unauthorized') setTimeout(() => void api.refresh().then((ok) => ok && socket.connect()), 2000);
    });
    socket.on('event', (event: EventEnvelope<unknown>) => {
      const effect = classifyEvent(event);
      if (effect.kind === 'ignore') return;
      if (effect.kind === 'occurrence') pending.current.add(effect.id);
      else {
        newsChanged.current = true;
        const id = effect.kind === 'news' ? effect.id : effect.payload.eventId;
        if (id) pendingNews.current.add(id);
        if (effect.kind === 'urgent-review') urgentRef.current?.(effect.payload);
      }
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, 300);
    });

    return () => {
      clearTimeout(timer.current);
      socket.disconnect();
    };
  }, [enabled, queryClient]);

  return enabled ? status : 'offline';
}
