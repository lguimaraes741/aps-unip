/**
 * `npm run news:seed-sources` — grava/atualiza o catálogo de fontes em news_sources (idempotente).
 * Não altera o estado operacional (falhas, próxima tentativa) de fontes já existentes.
 */
import { PrismaClient } from '@prisma/client';
import { SOURCE_CATALOG, TERMS_CHECKED_AT } from '../sources/catalog';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    for (const s of SOURCE_CATALOG) {
      const data = {
        name: s.name,
        type: s.type,
        reliability: s.reliability,
        baseUrl: s.baseUrl,
        feedUrl: s.feedUrl,
        collectionIntervalSec: s.collectionIntervalSec,
        minRequestIntervalMs: s.minRequestIntervalMs,
        defaultCityIbge: s.defaultCityIbge ?? null,
        config: s.config ?? {},
        enabled: s.enabled,
        termsCheckedAt: TERMS_CHECKED_AT,
        termsNote: s.termsNote,
      };
      await prisma.newsSource.upsert({ where: { key: s.key }, create: { key: s.key, ...data }, update: data });
      console.log(`fonte ${s.key}: ${s.enabled ? 'ligada' : 'desligada'}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
