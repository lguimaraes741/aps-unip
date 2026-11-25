import { config } from 'dotenv';
import { resolve } from 'node:path';

/** Usa o banco de TESTES (nunca o de desenvolvimento) e um prefixo próprio no Redis. */
config({ path: resolve(__dirname, '../../../.env'), quiet: true });
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('TEST_DATABASE_URL não definida (veja .env.example).');
if (!/_test(\?|$)/.test(new URL(url).pathname + '?')) {
  throw new Error('Por segurança, TEST_DATABASE_URL deve apontar para um banco cujo nome termina em "_test".');
}
process.env.DATABASE_URL = url;
process.env.REDIS_PREFIX = 'alertacidade-test-news';
