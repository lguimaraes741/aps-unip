/**
 * Avaliação com NOTÍCIAS REAIS (Etapa 11) — conjunto de TESTE, separado do corpus simulado que guiou as regras.
 *
 *   npm run eval-real -w @alertacidade/news-worker -- eval/snapshot-20261124.json            (lista p/ rotular)
 *   npm run eval-real -w @alertacidade/news-worker -- eval/snapshot-20261124.json eval/labels-20261124.json
 *
 * Rótulo por item (chave = URL): `alert` = deveria virar alerta no mapa (alagamento ACONTECENDO agora,
 * numa cidade monitorada); `flood` = o texto é sobre alagamento/enchente (inclui previsão, prevenção,
 * histórico, outra região). A métrica principal é a do alerta: falso alerta é o erro que mais custa.
 */
import { readFileSync } from 'node:fs';
import { isFloodCandidate } from '../analysis/rules';
import { assessArticle } from '../pipeline/analyze-article';
import { SourceReliability } from '../types';

interface SnapshotItem {
  source: string;
  reliability: SourceReliability;
  defaultCityIbge: string | null;
  title: string;
  summary: string | null;
  url: string;
  publishedAt: string | null;
}
interface Label {
  flood: boolean;
  alert: boolean;
  note?: string;
}

const PUBLISHED = new Set(['PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED']);

export function assess(item: SnapshotItem, now: Date) {
  const candidate = isFloodCandidate(item.title, item.summary);
  const a = assessArticle(
    { title: item.title, summary: item.summary, publishedAt: item.publishedAt ? new Date(item.publishedAt) : null, reliability: item.reliability, sourceCityIbge: item.defaultCityIbge ?? undefined },
    now,
  );
  // O coletor só GRAVA candidatos: o que não passa no filtro nunca é analisado.
  const published = candidate && PUBLISHED.has(a.decision.status);
  return { candidate, published, push: candidate && a.decision.pushAllowed, a };
}

function main(): void {
  const [snapPath, labelsPath] = process.argv.slice(2);
  const snap = JSON.parse(readFileSync(snapPath, 'utf-8')) as { takenAt: string; items: SnapshotItem[] };
  const now = new Date(snap.takenAt);
  const rows = snap.items.map((item, i) => ({ i, item, ...assess(item, now) }));

  if (!labelsPath) {
    for (const r of rows) {
      const d = r.a.decision;
      console.log(`${String(r.i).padStart(3)} ${r.item.source.padEnd(22)} ${r.candidate ? 'CAND' : '    '} ${r.candidate ? `${d.status}${d.pushAllowed ? '+push' : ''} sev=${r.a.rules.severity ?? '—'} t=${r.a.rules.temporality}` : ''} | ${r.item.title}`);
    }
    return;
  }

  const { _sobre: about, ...labels } = JSON.parse(readFileSync(labelsPath, 'utf-8')) as Record<string, Label> & { _sobre?: string };
  if (about) console.log(`Rótulos: ${about}`);
  const missing = rows.filter((r) => !labels[r.item.url]);
  if (missing.length) throw new Error(`${missing.length} itens sem rótulo (ex.: ${missing[0].item.url})`);
  const L = (r: (typeof rows)[number]) => labels[r.item.url];

  const count = (f: (r: (typeof rows)[number]) => boolean) => rows.filter(f).length;
  const tp = count((r) => r.published && L(r).alert);
  const fp = count((r) => r.published && !L(r).alert);
  const fn = count((r) => !r.published && L(r).alert);
  const tn = count((r) => !r.published && !L(r).alert);
  const floodTotal = count((r) => L(r).flood);
  const floodCaught = count((r) => L(r).flood && r.candidate);
  const pct = (a: number, b: number) => (b === 0 ? '—' : `${((100 * a) / b).toFixed(1)}% (${a}/${b})`);

  console.log(`Retrato de ${snap.takenAt}: ${rows.length} itens de ${new Set(rows.map((r) => r.item.source)).size} fontes`);
  console.log(`Sobre alagamento (rótulo): ${floodTotal}; deveriam virar alerta: ${tp + fn}`);
  console.log(`Filtro do coletor — recall sobre alagamento: ${pct(floodCaught, floodTotal)}; itens fora do tema descartados: ${pct(count((r) => !L(r).flood && !r.candidate), count((r) => !L(r).flood))}`);
  console.log(`Alerta — VP ${tp} · FP ${fp} · FN ${fn} · VN ${tn}`);
  console.log(`  precisão ${pct(tp, tp + fp)} · recall ${pct(tp, tp + fn)} · falsos alertas ${fp} · push indevido ${count((r) => r.push && !L(r).alert)}`);
  for (const r of rows.filter((x) => (x.published && !L(x).alert) || (!x.published && L(x).alert) || (L(x).flood && !x.candidate))) {
    const kind = r.published && !L(r).alert ? 'FALSO ALERTA' : !r.published && L(r).alert ? 'ALERTA PERDIDO' : 'FILTRO PERDEU (sem alerta devido)';
    console.log(`  - ${kind}: [${r.a.decision.status} sev=${r.a.rules.severity ?? '—'} t=${r.a.rules.temporality}] ${r.item.title}${L(r).note ? ` — ${L(r).note}` : ''}`);
  }
}

if (require.main === module) main();
