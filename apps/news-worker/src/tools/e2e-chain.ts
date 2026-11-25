/**
 * Verificação ponta a ponta com PROCESSOS REAIS (API + news-worker + worker de notificações rodando):
 *
 *   artigo → fila news-analyze → news-worker (evento + alerta + outbox, mesma transação)
 *     → publicador do outbox (API) → fila occurrence-events → worker de notificações → notificação
 *   moderador valida pela API (HTTP) → fila news-maintenance → news-worker recalcula → push "confirmado"
 *   moderador descarta pela API → alerta retirado → aviso de correção a quem recebeu
 *
 * Uso (os três processos com o MESMO banco e prefixo): `npm run news:e2e -- http://localhost:3100`
 * Cria um cidadão com área de interesse em Osasco e um moderador; NÃO use no banco de produção.
 */
import { NewsAnalyzeJob, QueueName } from '@alertacidade/shared-types';
import { PrismaClient } from '@prisma/client';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config';
import { titleFingerprint } from '../dedup/similarity';
import { queueOptions } from '../news-worker';
import { canonicalizeUrl, urlHash } from '../text/url';

const api = process.argv[2] ?? 'http://localhost:3000';
const PASSWORD = 'Senha@E2e2026';
const t0 = Date.now();
const log = (m: string) => console.log(`[+${((Date.now() - t0) / 1000).toFixed(1)} s] ${m}`);

async function http<T>(path: string, init: { method?: string; token?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${api}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', ...(init.token && { Authorization: `Bearer ${init.token}` }) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : undefined) as T;
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`tempo esgotado esperando: ${what}`);
    await new Promise((r) => setTimeout(r, 200));
  }
}

async function main(): Promise<void> {
  const config = loadConfig();
  if (!/_test(\?|$)/.test(new URL(config.databaseUrl).pathname + '?')) throw new Error('Rode só contra o banco de TESTES (DATABASE_URL terminando em _test).');
  const prisma = new PrismaClient();
  const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  const analyze = new Queue<NewsAnalyzeJob>(QueueName.NEWS_ANALYZE, { connection: redis, ...queueOptions(config.redisPrefix, 3) });
  const tag = randomUUID().slice(0, 8);
  try {
    // Banco de TESTES: eventos deixados por outras suítes agrupariam com a notícia deste roteiro.
    await prisma.newsEvent.deleteMany({});
    // Pessoas
    const reg = async (label: string) =>
      http<{ user: { id: string }; accessToken: string }>('/auth/register', {
        method: 'POST',
        body: { name: `E2E ${label}`, email: `e2e-${label}-${tag}@teste.example`, password: PASSWORD, acceptTerms: true },
      });
    const citizen = await reg('cidada');
    await prisma.notificationPreference.upsert({
      where: { userId: citizen.user.id },
      create: { userId: citizen.user.id, latitude: -23.5329, longitude: -46.7917, radiusMeters: 2000, minSeverity: 'MODERATE' },
      update: { latitude: -23.5329, longitude: -46.7917, radiusMeters: 2000, minSeverity: 'MODERATE', pushEnabled: true },
    });
    const mod = await reg('moderador');
    await prisma.user.update({ where: { id: mod.user.id }, data: { role: 'MODERATOR' } });
    const modToken = (await http<{ accessToken: string }>('/auth/login', { method: 'POST', body: { email: `e2e-moderador-${tag}@teste.example`, password: PASSWORD } })).accessToken;
    log('cidadã com área de interesse no centro de Osasco (raio 2 km) e moderador criados');

    const source = await prisma.newsSource.create({
      data: { key: `e2e-${tag}`, name: 'Portal E2E', type: 'RSS', reliability: 'ESTABLISHED_PRESS', baseUrl: 'https://e2e.example', feedUrl: 'https://e2e.example/rss' },
    });
    const article = async (title: string) => {
      const url = `https://e2e.example/${tag}/${randomUUID()}`;
      const c = canonicalizeUrl(url)!;
      const a = await prisma.newsArticle.create({
        data: { sourceId: source.id, title, url, canonicalUrl: c, urlHash: urlHash(c), titleFingerprint: titleFingerprint(title), publishedAt: new Date(Date.now() - 600_000) },
      });
      await analyze.add('analyze', { articleId: a.id }, { jobId: a.id });
      return a;
    };
    const inbox = () => prisma.notification.findMany({ where: { userId: citizen.user.id }, orderBy: { createdAt: 'asc' } });

    // 1) Notícia de gravidade ALTA, fonte única → preliminar com push.
    const a1 = await article('Chuva alaga avenida e interdita via em Osasco');
    const t1 = Date.now();
    const first = await waitFor('notificação do alerta preliminar', async () => (await inbox())[0]);
    log(`1) notificação recebida em ${Date.now() - t1} ms após enfileirar o artigo: "${first.title}" — ${first.body}`);
    const link = await prisma.newsEventArticle.findUniqueOrThrow({ where: { articleId: a1.id } });
    const eventId = link.eventId;

    // 2) Moderador valida pela API → publicação recalculada pelo news-worker → aviso de confirmação.
    const ev = await http<{ version: number }>(`/admin/news/events/${eventId}`, { token: modToken });
    const t2 = Date.now();
    const approved = await http<{ status: string; publicationQueued: boolean }>(`/admin/news/events/${eventId}/approve`, {
      method: 'POST',
      token: modToken,
      body: { expectedVersion: ev.version, note: 'Confirmado (teste ponta a ponta)' },
    });
    log(`2) moderador validou: ${approved.status}, publicação enfileirada = ${approved.publicationQueued}`);
    const second = await waitFor('notificação de confirmação', async () => (await inbox())[1]);
    log(`   aviso recebido em ${Date.now() - t2} ms: "${second.title}" — ${second.body}`);

    // 3) Mais uma fonte com a mesma gravidade → nenhum aviso repetido.
    await article('Temporal deixa avenida interditada após alagamento em Osasco');
    await waitFor('segunda fonte processada', async () => (await prisma.newsEventArticle.count({ where: { eventId } })) === 2);
    await new Promise((r) => setTimeout(r, 3_000));
    log(`3) segunda fonte agrupada no mesmo evento; avisos na caixa: ${(await inbox()).length} (esperado: 2 — sem repetição)`);

    // 4) Moderador descarta → alerta retirado → aviso de correção.
    const ev2 = await http<{ version: number }>(`/admin/news/events/${eventId}`, { token: modToken });
    const t4 = Date.now();
    await http(`/admin/news/events/${eventId}/reject`, { method: 'POST', token: modToken, body: { expectedVersion: ev2.version, note: 'Teste ponta a ponta: retirada' } });
    const third = await waitFor('aviso de correção', async () => (await inbox())[2]);
    log(`4) descartado; aviso de correção em ${Date.now() - t4} ms: "${third.title}" — ${third.body} [${third.type}]`);

    const alert = await prisma.newsAlert.findUniqueOrThrow({ where: { eventId } });
    const outbox = await prisma.domainEvent.findMany({ where: { aggregateType: 'news_alert', aggregateId: alert.id }, orderBy: { sequence: 'asc' } });
    log(`alerta final: ${alert.status} (${alert.retractionReason}); outbox: ${outbox.map((o) => `${o.type}${o.publishedAt ? '' : ' (pendente)'}`).join(' → ')}`);
    const total = await inbox();
    log(`caixa da cidadã: ${total.length} aviso(s), push: ${total.map((n) => n.pushStatus).join(', ')}`);
    log('OK — cadeia completa verificada com processos reais');
  } finally {
    await analyze.close();
    await redis.quit();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(`FALHOU: ${(e as Error).message}`);
  process.exit(1);
});
