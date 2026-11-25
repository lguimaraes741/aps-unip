/**
 * `npm run news:build-events` — carrega o gazetteer (news_regions) e processa os artigos ainda
 * não analisados (COLLECTED) do banco de desenvolvimento: grava análises e agrupa em eventos.
 * Depois marca como DESATUALIZADOS os eventos sem evidência nova há mais de 6 h.
 * Não publica nem notifica nada. `-- --rebuild` apaga os eventos e reprocessa todos os artigos
 * (útil depois de mudar regras; só no banco de desenvolvimento).
 */
import { PrismaClient } from '@prisma/client';
import { expireStaleEvents, processArticle, TX_OPTIONS } from '../events/event-builder';
import { seedRegions } from '../geo/regions';

async function main(): Promise<void> {
  const prisma = new PrismaClient({ transactionOptions: TX_OPTIONS });
  try {
    const seeded = await seedRegions(prisma);
    console.log(`gazetteer: ${seeded.cities} cidades (com contorno IBGE), ${seeded.districts} distritos`);

    if (process.argv.includes('--rebuild')) {
      if (new URL(process.env.DATABASE_URL!).pathname !== '/alertacidade') throw new Error('--rebuild só no banco de desenvolvimento');
      const del = await prisma.newsEvent.deleteMany({});
      const reset = await prisma.newsArticle.updateMany({ where: { processingStatus: { in: ['ANALYZED', 'IRRELEVANT'] } }, data: { processingStatus: 'COLLECTED' } });
      console.log(`rebuild: ${del.count} eventos apagados, ${reset.count} artigos voltam a COLLECTED`);
    }
    const pending = await prisma.newsArticle.findMany({ where: { processingStatus: 'COLLECTED' }, orderBy: [{ publishedAt: 'asc' }, { collectedAt: 'asc' }] });
    for (const a of pending) {
      const r = await processArticle(prisma, a.id);
      console.log(`  ${r.outcome.padEnd(18)} ${r.status ?? ''} ${r.reason ? `(${r.reason}) ` : ''}— ${a.title.slice(0, 90)}`);
    }

    const events = await prisma.newsEvent.findMany({
      orderBy: { firstEvidenceAt: 'asc' },
      include: { region: true, articles: { include: { article: { include: { source: true } } } } },
    });
    console.log(`\n${events.length} evento(s):`);
    for (const e of events) {
      console.log(
        `  N-${e.code} [${e.status}] grav=${e.estimatedSeverity ?? 'não informada'} conf=${e.confidence} fontes=${e.articles.length} (independentes ${e.independentSources})` +
          ` local=${e.locationPrecision} ${e.region ? `${e.region.kind}:${e.region.name}` : 'sem região'}${e.urgentReview ? ' REVISÃO URGENTE' : ''}`,
      );
      for (const l of e.articles) console.log(`      ${l.isIndependent ? '•' : '↳ mesma origem'} ${l.article.source.key}: ${l.article.title.slice(0, 80)}`);
    }

    const expired = await expireStaleEvents(prisma);
    console.log(`\n${expired} evento(s) marcados como DESATUALIZADOS (sem evidência nova há > 6 h).`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
