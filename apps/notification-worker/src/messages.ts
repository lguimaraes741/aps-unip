import { NewsAlertEventPayload, NewsReviewEventPayload, OccurrenceEventPayload, RealtimeEvent, Severity } from '@alertacidade/shared-types';

const SEVERITY_LABEL: Record<Severity, string> = {
  LOW: 'baixa',
  MODERATE: 'moderada',
  HIGH: 'alta',
  CRITICAL: 'crítica',
};

/** "850 m", "1,2 km", "12 km" (mesmo formato do app). */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1).replace('.', ',')} km` : `${Math.round(km)} km`;
}

export interface MessageText {
  title: string;
  body: string;
}

/** Alerta para quem tem a ocorrência dentro da sua área de interesse. */
export function nearbyMessage(payload: OccurrenceEventPayload, distanceMeters: number): MessageText {
  const where = payload.neighborhood ? ` (${payload.neighborhood})` : '';
  return {
    title: `Alagamento de gravidade ${SEVERITY_LABEL[payload.severity]} a ${formatDistance(distanceMeters)}${where}`.slice(0, 120),
    // Sempre deixa claro que é relato de cidadão, não comunicado oficial.
    body: `Ocorrência #${payload.code} registrada por um cidadão, ainda não verificada. Em risco, ligue 199 (Defesa Civil).`,
  };
}

const STATUS_TEXT: Partial<Record<RealtimeEvent, (code: number) => MessageText>> = {
  'occurrence.validated': (code) => ({
    title: `Sua ocorrência #${code} foi validada`,
    body: 'A moderação confirmou o seu relato. Obrigado por ajudar a sua cidade.',
  }),
  'occurrence.rejected': (code) => ({
    title: `Sua ocorrência #${code} não foi aprovada`,
    body: 'A moderação não pôde confirmar o relato. Ele deixou de aparecer no mapa.',
  }),
  'occurrence.resolved': (code) => ({
    title: `Sua ocorrência #${code} foi marcada como resolvida`,
    body: 'O alagamento foi resolvido. Obrigado por acompanhar.',
  }),
};

/** Aviso ao autor quando a moderação muda o status. `undefined` = evento não gera aviso. */
export function statusMessage(type: RealtimeEvent, payload: OccurrenceEventPayload): MessageText | undefined {
  return STATUS_TEXT[type]?.(payload.code);
}

// ---------------------------------------------------------------------------
// Alertas de notícia (Fase 7). Regras de texto:
//  - deixa claro de onde vem a informação (notícia ainda não confirmada × verificada × comunicado oficial);
//  - nunca afirma que uma rua ou trajeto é seguro;
//  - "crítico" só com confirmação (a política nem permite push crítico preliminar).
// ---------------------------------------------------------------------------

/** Consequência relatada (rótulo da evidência) → trecho da frase da notificação. */
const HEADLINE_PHRASE: Record<string, string> = {
  'via interditada': 'interdição de via por alagamento',
  'via parcialmente afetada': 'via parcialmente afetada por alagamento',
  'impacto no trânsito': 'alagamento com impacto no trânsito',
  'via transitável com dificuldade': 'alagamento com dificuldade de circulação',
  'transbordamento de rio ou córrego': 'transbordamento de rio ou córrego',
  'imóveis atingidos': 'imóveis atingidos por alagamento',
  'imóveis interditados': 'imóveis interditados após alagamento',
  desalojados: 'moradores desalojados por alagamento',
  'alagamento extenso': 'alagamento extenso',
  'veículos ilhados ou submersos': 'veículos ilhados ou submersos',
  'pessoas ilhadas': 'pessoas ilhadas',
  'resgate em andamento ou realizado': 'resgates durante alagamento',
  'pessoa arrastada pela água': 'pessoa arrastada pela água',
  desaparecidos: 'pessoas desaparecidas após alagamento',
  mortes: 'vítimas em alagamento',
  evacuação: 'evacuação por alagamento',
  desabrigados: 'moradores desabrigados',
  'emergência ou calamidade decretada': 'emergência decretada por enchentes',
  'acúmulo pontual de água': 'acúmulo pontual de água',
};

function place(p: NewsAlertEventPayload): string {
  if (p.regionName && p.city && p.regionName !== p.city) return `${p.regionName}, ${p.city}`;
  return p.city ?? p.regionName ?? 'região monitorada';
}

/** Texto da notificação de um alerta de notícia. `undefined` = não notificar. */
export function newsAlertMessage(p: NewsAlertEventPayload): MessageText | undefined {
  const where = place(p);
  const sev = p.severity ? SEVERITY_LABEL[p.severity] : null;
  const fact = (p.headline && HEADLINE_PHRASE[p.headline]) ?? 'alagamento';
  const source =
    p.level === 'OFFICIAL' ? 'Comunicado oficial relata' : p.level === 'VERIFIED' ? 'Notícias de fontes independentes relatam' : 'Notícia ainda não confirmada relata';
  const cut = (m: MessageText): MessageText => ({ title: m.title.slice(0, 120), body: m.body.slice(0, 500) });

  switch (p.change) {
    case 'new':
    case 'escalated':
    case 'upgraded': {
      if (!sev) return undefined;
      if (p.severity === 'CRITICAL' && p.level !== 'PRELIMINARY') {
        return cut({
          title: `Alerta crítico de alagamento — ${where}`,
          body: 'Fontes verificadas relatam situação grave na região. Consulte os detalhes e orientações oficiais. Em risco, ligue 199 (Defesa Civil).',
        });
      }
      const prefix = p.change === 'escalated' ? 'Alerta de alagamento atualizado' : p.change === 'upgraded' ? 'Alerta de alagamento confirmado' : 'Alerta de alagamento';
      return cut({ title: `${prefix} — ${where}`, body: `${source} ${fact}. Gravidade ${sev}. Consulte as informações e a fonte.` });
    }
    case 'resolved':
      return cut({
        title: `Alerta encerrado — ${where}`,
        body: 'As fontes indicam que a situação do alagamento foi normalizada. Continue atento às orientações locais.',
      });
    case 'retracted':
      return cut({
        title: `Alerta corrigido — ${where}`,
        body: 'O alerta de alagamento enviado anteriormente foi retirado após revisão. Desconsidere a informação anterior.',
      });
    default:
      return undefined;
  }
}

/**
 * Aviso à MODERAÇÃO (nunca a cidadãos): notícia que precisa de revisão urgente. Diz o que o
 * público está vendo agora, para o moderador saber a pressa.
 */
export function newsReviewMessage(p: NewsReviewEventPayload): MessageText {
  const sev = p.severity ? `gravidade ${SEVERITY_LABEL[p.severity]}` : 'gravidade não informada';
  const where = p.city ?? 'local a confirmar';
  const visibility =
    p.status === 'PUBLISHED_PRELIMINARY'
      ? 'Já aparece no mapa como preliminar, mas SEM push até a moderação conferir.'
      : 'Não aparece no app até a moderação decidir.';
  return {
    title: `Revisão urgente: notícia de ${sev} — ${where}`.slice(0, 120),
    // Corta o título da notícia, nunca a frase sobre o que o público vê (é ela que define a pressa).
    body: `N-${p.code}: ${p.title.length > 200 ? `${p.title.slice(0, 199)}…` : p.title}. ${visibility} Revise no painel de moderação.`,
  };
}
