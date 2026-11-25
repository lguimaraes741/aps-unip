import { config } from 'dotenv';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/**
 * Carrega o .env da raiz e redireciona DATABASE_URL para o banco de testes.
 * Os testes NUNCA tocam o banco de desenvolvimento.
 */
export function loadTestEnv(): string {
  config({ path: resolve(__dirname, '../../../.env'), quiet: true });
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('TEST_DATABASE_URL não definida (veja .env.example).');
  if (!/_test(\?|$)/.test(new URL(url).pathname + '?')) {
    throw new Error('Por segurança, TEST_DATABASE_URL deve apontar para um banco cujo nome termina em "_test".');
  }
  process.env.DATABASE_URL = url;
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET ??= 'segredo-de-teste-com-pelo-menos-32-caracteres';
  // Limites altos por padrão; o teste de rate limit define os próprios valores.
  process.env.THROTTLE_LIMIT = '100000';
  process.env.AUTH_THROTTLE_LIMIT = '100000';
  // Filas e canais do Socket.IO separados do ambiente de desenvolvimento no mesmo Redis.
  process.env.REDIS_PREFIX = 'alertacidade-test';
  process.env.OUTBOX_POLL_MS ??= '100';
  process.env.STORAGE_DIR = join(tmpdir(), 'alertacidade-test-storage');
  return url;
}
