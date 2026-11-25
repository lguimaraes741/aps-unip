/**
 * Configuração do news-worker, validada na inicialização (falha rápida, como a API e o outro worker).
 */
export interface NewsWorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  /** Mesmo prefixo da API: a API enfileira coletas manuais na mesma fila. */
  redisPrefix: string;
  collectConcurrency: number;
  analyzeConcurrency: number;
  analyzeAttempts: number;
  httpTimeoutMs: number;
  /** De quanto em quanto tempo os agendadores são conferidos com news_sources (fonte ligada/desligada, intervalo). */
  schedulerSyncMs: number;
  /** Intervalo da manutenção (eventos desatualizados, artigos órfãos). */
  maintenanceEveryMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): NewsWorkerConfig {
  const errors: string[] = [];
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const n = Number(env[key]?.trim() || fallback);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${key} deve ser um inteiro entre ${min} e ${max}`);
    return n;
  };
  const databaseUrl = env.DATABASE_URL?.trim() ?? '';
  if (!databaseUrl) errors.push('DATABASE_URL é obrigatória');
  else if (!/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL deve ser uma URL postgresql://');
  const redisUrl = env.REDIS_URL?.trim() || 'redis://localhost:6379';
  if (!/^rediss?:\/\//.test(redisUrl)) errors.push('REDIS_URL deve ser uma URL redis://');

  const config: NewsWorkerConfig = {
    databaseUrl,
    redisUrl,
    redisPrefix: env.REDIS_PREFIX?.trim() || 'alertacidade',
    collectConcurrency: int('NEWS_COLLECT_CONCURRENCY', 2, 1, 10),
    analyzeConcurrency: int('NEWS_ANALYZE_CONCURRENCY', 4, 1, 20),
    analyzeAttempts: int('NEWS_ANALYZE_ATTEMPTS', 5, 1, 20),
    httpTimeoutMs: int('NEWS_HTTP_TIMEOUT_MS', 30_000, 1_000, 120_000),
    schedulerSyncMs: int('NEWS_SCHEDULER_SYNC_MS', 300_000, 5_000, 3_600_000),
    maintenanceEveryMs: int('NEWS_MAINTENANCE_MS', 900_000, 10_000, 86_400_000),
  };
  if (errors.length > 0) throw new Error(`Configuração inválida do news-worker:\n - ${errors.join('\n - ')}`);
  return config;
}
