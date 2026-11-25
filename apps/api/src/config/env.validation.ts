/**
 * Validação das variáveis de ambiente na inicialização.
 * A API não sobe com configuração ausente ou insegura (falha rápida).
 */
export interface AppEnv {
  NODE_ENV: 'development' | 'test' | 'production';
  APP_ENV: 'development' | 'demo' | 'production';
  API_PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  /** Intervalo do publicador do outbox quando não há eventos pendentes (ms). */
  OUTBOX_POLL_MS: number;
  /** Prefixo das chaves no Redis (filas e Socket.IO), isola dev e testes no mesmo servidor. */
  REDIS_PREFIX: string;
  /** Swagger em /api/docs. Padrão: ligado fora de produção, desligado em produção. */
  SWAGGER_ENABLED: boolean;
  CORS_ORIGINS: string[];
  JWT_ACCESS_SECRET: string;
  JWT_ACCESS_TTL_SECONDS: number;
  JWT_REFRESH_TTL_DAYS: number;
  STORAGE_DIR: string;
  THROTTLE_LIMIT: number;
  AUTH_THROTTLE_LIMIT: number;
}

const NODE_ENVS = ['development', 'test', 'production'] as const;
const APP_ENVS = ['development', 'demo', 'production'] as const;
const PLACEHOLDER_SECRET = 'troque-por-um-segredo-longo-e-aleatorio';

/** Converte "900", "30s", "15m", "1h" em segundos. Retorna NaN se inválido. */
export function parseDurationSeconds(value: string): number {
  const match = /^(\d+)\s*([smh]?)$/.exec(value.trim());
  if (!match) return NaN;
  const n = Number(match[1]);
  const factor = { '': 1, s: 1, m: 60, h: 3600 }[match[2] as '' | 's' | 'm' | 'h'];
  return n * factor;
}

export function validateEnv(raw: Record<string, unknown>): AppEnv {
  const errors: string[] = [];
  const str = (key: string, fallback?: string): string => {
    const value = raw[key];
    if (typeof value === 'string' && value.trim() !== '') return value.trim();
    if (fallback !== undefined) return fallback;
    errors.push(`${key} é obrigatória`);
    return '';
  };
  const int = (key: string, fallback: string, min: number, max: number): number => {
    const n = Number(str(key, fallback));
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${key} deve ser um inteiro entre ${min} e ${max}`);
    return n;
  };

  const nodeEnv = str('NODE_ENV', 'development');
  if (!(NODE_ENVS as readonly string[]).includes(nodeEnv)) errors.push(`NODE_ENV inválido: ${nodeEnv}`);

  const appEnv = str('APP_ENV', 'development');
  if (!(APP_ENVS as readonly string[]).includes(appEnv)) errors.push(`APP_ENV inválido: ${appEnv}`);

  const port = Number(str('API_PORT', '3000'));
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('API_PORT deve ser uma porta válida');

  const databaseUrl = str('DATABASE_URL');
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL deve ser uma URL postgresql://');

  const redisUrl = str('REDIS_URL', 'redis://localhost:6379');
  if (!/^rediss?:\/\//.test(redisUrl)) errors.push('REDIS_URL deve ser uma URL redis://');

  const corsOrigins = str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  if (appEnv === 'production' && corsOrigins.includes('*')) errors.push('CORS_ORIGINS não pode conter "*" em produção');

  const jwtSecret = str('JWT_ACCESS_SECRET');
  if (jwtSecret && jwtSecret.length < 32) errors.push('JWT_ACCESS_SECRET deve ter pelo menos 32 caracteres');
  if (appEnv === 'production' && jwtSecret === PLACEHOLDER_SECRET) {
    errors.push('JWT_ACCESS_SECRET ainda contém o valor de exemplo');
  }

  const accessTtl = parseDurationSeconds(str('JWT_ACCESS_TTL', '15m'));
  if (!Number.isFinite(accessTtl) || accessTtl < 60 || accessTtl > 86400) {
    errors.push('JWT_ACCESS_TTL deve estar entre 60s e 24h (ex.: 15m)');
  }

  const env: AppEnv = {
    NODE_ENV: nodeEnv as AppEnv['NODE_ENV'],
    APP_ENV: appEnv as AppEnv['APP_ENV'],
    API_PORT: port,
    DATABASE_URL: databaseUrl,
    REDIS_URL: redisUrl,
    SWAGGER_ENABLED: (raw.SWAGGER_ENABLED === undefined ? appEnv !== 'production' : String(raw.SWAGGER_ENABLED) === 'true'),
    REDIS_PREFIX: str('REDIS_PREFIX', 'alertacidade'),
    OUTBOX_POLL_MS: int('OUTBOX_POLL_MS', '500', 50, 60000),
    CORS_ORIGINS: corsOrigins,
    JWT_ACCESS_SECRET: jwtSecret,
    JWT_ACCESS_TTL_SECONDS: accessTtl,
    JWT_REFRESH_TTL_DAYS: int('JWT_REFRESH_TTL_DAYS', '30', 1, 180),
    STORAGE_DIR: str('STORAGE_DIR', './storage'),
    THROTTLE_LIMIT: int('THROTTLE_LIMIT', '120', 1, 100000),
    AUTH_THROTTLE_LIMIT: int('AUTH_THROTTLE_LIMIT', '10', 1, 100000),
  };

  if (errors.length > 0) {
    throw new Error(`Configuração inválida:\n - ${errors.join('\n - ')}`);
  }
  return env;
}
