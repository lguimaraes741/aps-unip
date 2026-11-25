/**
 * Configuração do worker, validada na inicialização (falha rápida, como a API).
 */
export interface WorkerConfig {
  databaseUrl: string;
  redisUrl: string;
  /** Mesmo prefixo da API: filas e canais do Socket.IO precisam coincidir. */
  redisPrefix: string;
  concurrency: number;
  /** "fcm" quando há credenciais do Firebase; "log" em desenvolvimento (ver docs/architecture/06-riscos.md, R4). */
  pushProvider: 'fcm' | 'log';
  firebaseCredentialsFile?: string;
  pushAttempts: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const errors: string[] = [];
  const req = (key: string): string => {
    const v = env[key]?.trim();
    if (!v) errors.push(`${key} é obrigatória`);
    return v ?? '';
  };
  const int = (key: string, fallback: number, min: number, max: number): number => {
    const n = Number(env[key]?.trim() || fallback);
    if (!Number.isInteger(n) || n < min || n > max) errors.push(`${key} deve ser um inteiro entre ${min} e ${max}`);
    return n;
  };

  const databaseUrl = req('DATABASE_URL');
  if (databaseUrl && !/^postgres(ql)?:\/\//.test(databaseUrl)) errors.push('DATABASE_URL deve ser uma URL postgresql://');
  const redisUrl = env.REDIS_URL?.trim() || 'redis://localhost:6379';
  if (!/^rediss?:\/\//.test(redisUrl)) errors.push('REDIS_URL deve ser uma URL redis://');

  // FIREBASE_CREDENTIALS_FILE ou a variável padrão do Google; sem nenhuma, usa o provedor de log.
  const firebaseCredentialsFile = env.FIREBASE_CREDENTIALS_FILE?.trim() || env.GOOGLE_APPLICATION_CREDENTIALS?.trim() || undefined;
  const requested = (env.PUSH_PROVIDER?.trim() || (firebaseCredentialsFile ? 'fcm' : 'log')) as WorkerConfig['pushProvider'];
  if (!['fcm', 'log'].includes(requested)) errors.push('PUSH_PROVIDER deve ser "fcm" ou "log"');
  if (requested === 'fcm' && !firebaseCredentialsFile) errors.push('PUSH_PROVIDER=fcm exige FIREBASE_CREDENTIALS_FILE');
  if (requested === 'log' && env.APP_ENV === 'production') errors.push('Em produção o push precisa do FCM (PUSH_PROVIDER=fcm)');

  const config: WorkerConfig = {
    databaseUrl,
    redisUrl,
    redisPrefix: env.REDIS_PREFIX?.trim() || 'alertacidade',
    concurrency: int('WORKER_CONCURRENCY', 5, 1, 50),
    pushProvider: requested,
    firebaseCredentialsFile,
    pushAttempts: int('PUSH_ATTEMPTS', 6, 1, 20),
  };
  if (errors.length > 0) throw new Error(`Configuração inválida do worker:\n - ${errors.join('\n - ')}`);
  return config;
}
