/**
 * `npm run snapshot-feeds -w @alertacidade/news-worker -- eval/snapshot-AAAAMMDD.json`
 *
 * Etapa 11 (avaliação com dados reais): baixa os feeds RSS COMPLETOS das fontes ligadas (banco de
 * desenvolvimento) e grava um retrato em JSON — TODOS os itens, inclusive os que o coletor descartaria,
 * para medir também o que o filtro deixa passar. Nada é gravado no banco. Guarda só o que o próprio
 * feed publica (título, resumo ≤ 500, link, data).
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync } from 'node:fs';
import { adapterFor } from '../sources/adapters';

async function main(): Promise<void> {
  const out = process.argv[2];
  if (!out) throw new Error('Informe o arquivo de saída');
  const prisma = new PrismaClient();
  try {
    const sources = await prisma.newsSource.findMany({ where: { enabled: true, type: 'RSS' }, orderBy: { key: 'asc' } });
    const items: unknown[] = [];
    for (const s of sources) {
      try {
        const r = await adapterFor('RSS').collect({ id: s.id, key: s.key, type: 'RSS', feedUrl: s.feedUrl, minRequestIntervalMs: s.minRequestIntervalMs, config: {} }, { timeoutMs: 20_000 });
        for (const i of r.items) {
          items.push({ source: s.key, reliability: s.reliability, defaultCityIbge: s.defaultCityIbge, title: i.title, summary: i.summary, url: i.url, publishedAt: i.publishedAt?.toISOString() ?? null });
        }
        console.log(`${s.key}: ${r.items.length} itens`);
      } catch (error) {
        console.log(`${s.key}: FALHOU — ${(error as Error).message}`);
      }
    }
    writeFileSync(out, JSON.stringify({ takenAt: new Date().toISOString(), items }, null, 2));
    console.log(`${items.length} itens → ${out}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
