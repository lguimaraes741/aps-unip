/**
 * O BANCO também garante as regras de publicação (migration 20261124120000_news_intelligence):
 * mesmo que o código tenha um bug, estas gravações são recusadas.
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const tag = `t${Date.now().toString(36)}`;
let sourceId: string;
let moderatorId: string;

const now = new Date();
const later = new Date(now.getTime() + 6 * 3_600_000);

function eventData(patch: Partial<Prisma.NewsEventUncheckedCreateInput> = {}): Prisma.NewsEventUncheckedCreateInput {
  return {
    eventType: 'FLOODING',
    title: `Alagamento de teste ${tag}`,
    city: 'Osasco',
    state: 'SP',
    locationPrecision: 'CITY',
    confidence: 'MEDIUM',
    rulesVersion: 'rules-1',
    firstEvidenceAt: now,
    lastEvidenceAt: now,
    ...patch,
  };
}

function articleData(n: number): Prisma.NewsArticleUncheckedCreateInput {
  const canonical = `https://portal.example/${tag}/${n}`;
  return {
    sourceId,
    title: `Notícia ${n} ${tag}`,
    url: canonical,
    canonicalUrl: canonical,
    urlHash: (tag + String(n)).padEnd(64, '0').replace(/[^0-9a-f]/g, 'a').slice(0, 64),
    titleFingerprint: `noticia ${tag}`,
  };
}

async function rejects(p: Promise<unknown>, constraint: string): Promise<void> {
  await expect(p).rejects.toThrow(new RegExp(constraint));
}

beforeAll(async () => {
  const source = await prisma.newsSource.create({
    data: { key: `teste-${tag}`, name: 'Fonte de teste', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: 'https://portal.example', feedUrl: 'https://portal.example/rss' },
  });
  sourceId = source.id;
  const user = await prisma.user.create({
    data: { name: 'Moderação Teste', email: `mod-${tag}@teste.example`, passwordHash: 'x', role: 'MODERATOR' },
  });
  moderatorId = user.id;
});

afterAll(async () => {
  await prisma.newsEvent.deleteMany({ where: { title: { contains: tag } } });
  await prisma.newsSource.deleteMany({ where: { key: { contains: tag } } }); // cascata: artigos, análises, coletas
  await prisma.user.deleteMany({ where: { id: moderatorId } });
  await prisma.$disconnect();
});

describe('news_sources', () => {
  it('nasce desligada', async () => {
    expect((await prisma.newsSource.findUniqueOrThrow({ where: { id: sourceId } })).enabled).toBe(false);
  });

  it('não pode ser ligada sem a conferência dos termos de uso', async () => {
    await rejects(prisma.newsSource.update({ where: { id: sourceId }, data: { enabled: true } }), 'news_sources_terms_before_enable');
    await prisma.newsSource.update({ where: { id: sourceId }, data: { enabled: true, termsCheckedAt: now, termsNote: 'teste' } });
  });

  it('recusa intervalo de coleta menor que 5 minutos', async () => {
    await rejects(prisma.newsSource.update({ where: { id: sourceId }, data: { collectionIntervalSec: 60 } }), 'news_sources_interval');
  });
});

describe('news_articles', () => {
  it('a mesma URL canônica nunca é gravada duas vezes (recoleta idempotente)', async () => {
    await prisma.newsArticle.create({ data: articleData(1) });
    await expect(prisma.newsArticle.create({ data: articleData(1) })).rejects.toMatchObject({ code: 'P2002' });
    const again = await prisma.newsArticle.createMany({ data: [articleData(1)], skipDuplicates: true });
    expect(again.count).toBe(0);
  });

  it('recusa URL que não é http(s)', async () => {
    await rejects(prisma.newsArticle.create({ data: { ...articleData(2), url: 'javascript:alert(1)' } }), 'news_articles_urls_http');
  });

  it('DUPLICATE exige apontar o original (e vice-versa)', async () => {
    await rejects(prisma.newsArticle.create({ data: { ...articleData(3), processingStatus: 'DUPLICATE' } }), 'news_articles_duplicate_consistency');
  });
});

describe('news_analyses', () => {
  it('uma análise por artigo e versão de regras; versão nova convive com a antiga', async () => {
    const article = await prisma.newsArticle.create({ data: articleData(4) });
    const base = { articleId: article.id, isRelevant: false, extractedData: {}, reasoningSummary: 'irrelevante' };
    await prisma.newsAnalysis.create({ data: { ...base, rulesVersion: 'rules-1' } });
    await expect(prisma.newsAnalysis.create({ data: { ...base, rulesVersion: 'rules-1' } })).rejects.toMatchObject({ code: 'P2002' });
    await prisma.newsAnalysis.create({ data: { ...base, rulesVersion: 'rules-2' } });
  });

  it('artigo relevante precisa de temporalidade', async () => {
    const article = await prisma.newsArticle.create({ data: articleData(5) });
    await rejects(
      prisma.newsAnalysis.create({ data: { articleId: article.id, rulesVersion: 'rules-1', isRelevant: true, extractedData: {}, reasoningSummary: 'x' } }),
      'news_analyses_relevant_has_temporality',
    );
  });
});

describe('news_events', () => {
  it('sem ponto falso: coordenadas exigem precisão de logradouro', async () => {
    await rejects(prisma.newsEvent.create({ data: eventData({ latitude: -23.53, longitude: -46.79 }) }), 'news_events_point_requires_precision');
  });

  it('com precisão de logradouro, o trigger preenche a geografia', async () => {
    const e = await prisma.newsEvent.create({ data: eventData({ locationPrecision: 'STREET', latitude: -23.53, longitude: -46.79 }) });
    const [row] = await prisma.$queryRaw<{ wkt: string }[]>`SELECT ST_AsText(location::geometry) AS wkt FROM news_events WHERE id = ${e.id}::uuid`;
    expect(row.wkt).toBe('POINT(-46.79 -23.53)');
  });

  it('confiança baixa não é publicada sem moderador', async () => {
    await rejects(prisma.newsEvent.create({ data: eventData({ confidence: 'LOW', status: 'PUBLISHED_PRELIMINARY' }) }), 'news_events_publish_requires_confidence');
    await prisma.newsEvent.create({ data: eventData({ confidence: 'LOW', status: 'PUBLISHED_VERIFIED', moderatedById: moderatorId }) });
  });

  it('um artigo pertence a no máximo um evento', async () => {
    const article = await prisma.newsArticle.create({ data: articleData(6) });
    const a = await prisma.newsEvent.create({ data: eventData() });
    const b = await prisma.newsEvent.create({ data: eventData() });
    await prisma.newsEventArticle.create({ data: { eventId: a.id, articleId: article.id, isIndependent: true } });
    await expect(prisma.newsEventArticle.create({ data: { eventId: b.id, articleId: article.id, isIndependent: true } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('news_alerts', () => {
  it('push crítico de alerta preliminar exige revisão de moderador', async () => {
    const e = await prisma.newsEvent.create({ data: eventData({ estimatedSeverity: 'CRITICAL', status: 'PUBLISHED_PRELIMINARY' }) });
    const alert = await prisma.newsAlert.create({ data: { eventId: e.id, level: 'PRELIMINARY', expiresAt: later } });
    await rejects(prisma.newsAlert.update({ where: { id: alert.id }, data: { notifiedSeverity: 'CRITICAL' } }), 'news_alerts_critical_push_corroborated');
    await prisma.newsAlert.update({ where: { id: alert.id }, data: { notifiedSeverity: 'CRITICAL', reviewedById: moderatorId } });
  });

  it('retratação exige motivo', async () => {
    const e = await prisma.newsEvent.create({ data: eventData({ status: 'PUBLISHED_PRELIMINARY' }) });
    const alert = await prisma.newsAlert.create({ data: { eventId: e.id, level: 'PRELIMINARY', expiresAt: later } });
    await rejects(prisma.newsAlert.update({ where: { id: alert.id }, data: { status: 'RETRACTED' } }), 'news_alerts_retraction_reason');
  });

  it('um alerta por evento', async () => {
    const e = await prisma.newsEvent.create({ data: eventData({ status: 'PUBLISHED_PRELIMINARY' }) });
    await prisma.newsAlert.create({ data: { eventId: e.id, level: 'PRELIMINARY', expiresAt: later } });
    await expect(prisma.newsAlert.create({ data: { eventId: e.id, level: 'VERIFIED', expiresAt: later } })).rejects.toMatchObject({ code: 'P2002' });
  });
});

describe('news_collection_jobs', () => {
  it('coleta encerrada precisa de horário de término; itens novos ≤ encontrados', async () => {
    await rejects(prisma.newsCollectionJob.create({ data: { sourceId, trigger: 'MANUAL', status: 'SUCCEEDED' } }), 'news_collection_jobs_finished');
    await rejects(
      prisma.newsCollectionJob.create({ data: { sourceId, trigger: 'MANUAL', status: 'SUCCEEDED', finishedAt: now, itemsFound: 1, itemsNew: 2 } }),
      'news_collection_jobs_items',
    );
  });
});

