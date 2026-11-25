/**
 * `npm run eval -w @alertacidade/news-worker` — imprime as métricas do corpus SIMULADO.
 * Lembrete: é o conjunto de desenvolvimento das regras, não uma avaliação independente.
 */
import { CORPUS } from './corpus';
import { evaluate } from './evaluate';

const now = new Date();
const { results, metrics } = evaluate(CORPUS, now);
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

console.log(`Regras avaliadas em ${now.toISOString()} — corpus SIMULADO com ${metrics.total} casos\n`);
for (const r of results) {
  const a = r.assessment;
  const mark = r.mismatches.length === 0 ? 'ok ' : 'ERRO';
  console.log(
    `${mark} ${r.case.id} [${a.decision.status}${a.decision.pushAllowed ? ', push' : ''}] grav=${a.rules.severity ?? '—'} temp=${a.rules.temporality} local=${a.location.precision} — ${r.case.checks}`,
  );
  for (const m of r.mismatches) console.log(`       ${m}`);
}
console.log(`
Totalmente corretos:    ${metrics.fullyCorrect}/${metrics.total}
Relevância:             ${pct(metrics.relevanceAccuracy)}
Temporalidade:          ${pct(metrics.temporalityAccuracy)}
Gravidade:              ${pct(metrics.severityAccuracy)}
Status de publicação:   ${pct(metrics.statusAccuracy)}
Alertas falsos:         ${metrics.falseAlerts}
Alertas perdidos:       ${metrics.missedAlerts}
Push indevido:          ${metrics.wrongPush}
Tempo médio por artigo: ${metrics.meanMsPerArticle.toFixed(2)} ms`);
