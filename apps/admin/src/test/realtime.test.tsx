import type { EventEnvelope, NewsReviewEventPayload } from '@alertacidade/shared-types';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { UrgentReviewBanner } from '../components/UrgentReviewBanner';
import { classifyEvent } from '../realtime/useRealtime';

const envelope = (type: string, payload: unknown): EventEnvelope<unknown> =>
  ({ eventId: 'e1', sequence: '1', type, occurredAt: '2026-11-24T20:00:00.000Z', payload }) as EventEnvelope<unknown>;

const review: NewsReviewEventPayload = {
  eventId: 'ev-1',
  code: 42,
  title: 'Pessoas ilhadas após alagamento',
  city: 'Osasco',
  severity: 'CRITICAL',
  status: 'PUBLISHED_PRELIMINARY',
  reasons: ['crítico sem corroboração'],
};

describe('tempo real do painel', () => {
  it('classifica ocorrência, alerta de notícia, revisão urgente e tipo desconhecido', () => {
    expect(classifyEvent(envelope('occurrence.created', { occurrenceId: 'o1' }))).toEqual({ kind: 'occurrence', id: 'o1' });
    expect(classifyEvent(envelope('news.alert.published', { eventId: 'n1', alertId: 'a1' }))).toEqual({ kind: 'news', id: 'n1' });
    expect(classifyEvent(envelope('news.review.urgent', review))).toEqual({ kind: 'urgent-review', payload: review });
    // Antes desta mudança, eventos de notícia viravam invalidação de ['occurrence', undefined].
    expect(classifyEvent(envelope('algo.futuro', {}))).toEqual({ kind: 'ignore' });
  });

  it('aviso de revisão urgente: o que o público vê agora, link para o evento e dispensar', async () => {
    const onDismiss = vi.fn();
    render(
      <MemoryRouter>
        <UrgentReviewBanner items={[review, { ...review, eventId: 'ev-2', code: 43, severity: null, status: 'AWAITING_VALIDATION', city: null }]} onDismiss={onDismiss} />
      </MemoryRouter>,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('N-42 · Pessoas ilhadas após alagamento · Osasco · gravidade crítica · já no mapa, sem push');
    expect(alert).toHaveTextContent('N-43 · Pessoas ilhadas após alagamento · gravidade não informada · fora do app até a decisão');
    expect(screen.getAllByRole('link', { name: 'Revisar' })[0]).toHaveAttribute('href', '/news/events/ev-1');
    await userEvent.click(screen.getByRole('button', { name: 'Dispensar aviso de N-43' }));
    expect(onDismiss).toHaveBeenCalledWith('ev-2');
  });

  it('sem itens não ocupa espaço', () => {
    const { container } = render(<UrgentReviewBanner items={[]} onDismiss={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });
});
