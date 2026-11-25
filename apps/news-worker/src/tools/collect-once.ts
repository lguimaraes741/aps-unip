/**
 * `npm run news:collect-once` — coleta UMA vez cada fonte ligada (banco de desenvolvimento) e mostra
 * como o núcleo de regras avaliaria os artigos novos. Não grava análises nem publica nada
 * (isso é das Etapas 4–5). Serve para validar conectores contra as fontes reais.
 * `-- --all` reavalia também os artigos já guardados (útil depois de mudar as regras).
 */
import { PrismaClient } from '@prisma/client';
import { collectSource } from '../collector/collector';
import { assessArticle } from '../pipeline/analyze-article';
import { HostRateLimiter } from '../sources/rate-limit';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const logger = {
    log: (m: string, f?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'info', msg: m, ...f })),
    warn: (m: string, f?: Record<string, unknown>) => console.log(JSON.stringify({ level: 'warn', msg: m, ...f })),
  };
  const limiter = new HostRateLimiter();
  const all = process.argv.includes('--all');
  try {
    const sources = await prisma.newsSource.findMany({ where: { enabled: true }, orderBy: { key: 'asc' } });
    for (const s of sources) {
      const r = await collectSource({ prisma, limiter, logger }, s.id, 'MANUAL');
      const articles = await prisma.newsArticle.findMany({ where: all ? { sourceId: s.id } : { id: { in: r.newArticleIds } }, orderBy: { publishedAt: 'desc' } });
      if (articles.length === 0) continue;
      console.log(`${s.key}:`);
      for (const a of articles) {
        const x = assessArticle({ title: a.title, summary: a.summary, publishedAt: a.publishedAt, reliability: s.reliability, sourceCityIbge: s.defaultCityIbge ?? undefined });
        console.log(
          `  [${x.decision.status}${x.decision.pushAllowed ? ' +push' : ''}] grav=${x.rules.severity ?? '—'} temp=${x.rules.temporality} ` +
            `local=${x.location.precision}${x.location.cities.length ? ` (${x.location.cities.map((c) => c.name).join(', ')})` : ''} — ${a.title}`,
        );
      }
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
