import { fold, tokens } from '../text/normalize';
import { sourceDomain } from '../text/url';

/**
 * Deduplicação e agrupamento (docs/architecture/07-news-intelligence.md, 7.8).
 *
 * Duas perguntas DIFERENTES:
 *  - mesmo EVENTO? (duas matérias sobre o mesmo alagamento) → agrupa num único alerta;
 *  - fontes INDEPENDENTES? (não são a mesma matéria republicada) → só estas contam como corroboração.
 */

export const SAME_EVENT_WINDOW_HOURS = 6;
export const NEAR_DUPLICATE_TITLE = 0.9;

export function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

export function titleSimilarity(a: string, b: string): number {
  return jaccard(tokens(a), tokens(b));
}

/** Impressão do título: tokens significativos ordenados (coluna `title_fingerprint`). */
export function titleFingerprint(title: string): string {
  return [...new Set(tokens(title))].sort().join(' ');
}

const AGENCY = /(?<![a-z])(agencia brasil|estadao conteudo|agencia estado|folhapress|reuters|afp|associated press|ansa|com informacoes d[ao]s? [a-z ]{3,40}?)(?=[.,;)]|$)/;

/** Agência citada como origem do texto ("Com informações da Agência Brasil"). */
export function citedAgency(text: string): string | null {
  return AGENCY.exec(fold(text))?.[1].replace(/^com informacoes d[ao]s? /, '') ?? null;
}

export interface SourceItem {
  url: string;
  title: string;
  summary: string | null;
}

/**
 * Independentes = domínios diferentes, títulos não quase idênticos e sem a mesma agência citada.
 * Duas publicações derivadas do mesmo comunicado NÃO são duas confirmações.
 */
export function areIndependent(a: SourceItem, b: SourceItem): { independent: boolean; reason: string } {
  if (sourceDomain(a.url) === sourceDomain(b.url)) return { independent: false, reason: 'mesmo veículo' };
  const sim = titleSimilarity(a.title, b.title);
  if (sim >= NEAR_DUPLICATE_TITLE) return { independent: false, reason: `título quase idêntico (${sim.toFixed(2)}): republicação` };
  const agA = citedAgency(`${a.title}. ${a.summary ?? ''}`);
  const agB = citedAgency(`${b.title}. ${b.summary ?? ''}`);
  if (agA && agA === agB) return { independent: false, reason: `mesma agência de origem (${agA})` };
  return { independent: true, reason: 'veículos e textos distintos' };
}

/** Quantas fontes independentes há num conjunto (agrupamento guloso: cada grupo de republicações conta 1). */
export function countIndependent(items: SourceItem[]): number {
  const representatives: SourceItem[] = [];
  for (const item of items) {
    if (representatives.every((r) => areIndependent(r, item).independent)) representatives.push(item);
  }
  return representatives.length;
}

export interface EventKey {
  cityIbges: string[];
  districtIbges: string[];
  places: string[];
  at: Date;
}

/**
 * Mesmo evento quando: cidades em comum, dentro da janela de tempo e sem conflito de local.
 * Conflito = ambos citam distritos (ou logradouros) e nenhum coincide — aí são alagamentos
 * diferentes na mesma cidade. Se um dos lados só cita a cidade, os dois descrevem o mesmo
 * episódio de chuva naquela cidade e são agrupados (exemplo "Osasco" do enunciado).
 */
export function isSameEvent(a: EventKey, b: EventKey, windowHours = SAME_EVENT_WINDOW_HOURS): { same: boolean; reason: string } {
  if (!a.cityIbges.some((c) => b.cityIbges.includes(c))) return { same: false, reason: 'cidades diferentes' };
  const hours = Math.abs(a.at.getTime() - b.at.getTime()) / 3_600_000;
  if (hours > windowHours) return { same: false, reason: `intervalo de ${hours.toFixed(1)} h (> ${windowHours} h)` };
  if (a.districtIbges.length > 0 && b.districtIbges.length > 0 && !a.districtIbges.some((d) => b.districtIbges.includes(d))) {
    return { same: false, reason: 'distritos diferentes' };
  }
  if (a.places.length > 0 && b.places.length > 0 && !a.places.some((p) => b.places.some((q) => samePlace(p, q)))) {
    return { same: false, reason: 'logradouros diferentes' };
  }
  return { same: true, reason: 'mesma área e janela de tempo' };
}

function samePlace(a: string, b: string): boolean {
  const norm = (s: string) => tokens(s.replace(/^(avenida|av\.|rua|r\.|estrada|rodovia|ponte|tunel|túnel|viaduto|praça|praca)\s+/i, ''));
  return jaccard(norm(a), norm(b)) >= 0.5;
}
