import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './load-test-env';

/**
 * Variante do globalSetup SEM reset: só aplica migrations pendentes no banco de testes.
 * Usada quando o reset não pode rodar (ex.: o Prisma bloqueia `migrate reset` quando chamado
 * pelo assistente). Os testes criam dados com identificadores únicos e não dependem de banco vazio.
 * Uso: `npm run test:int:deploy -- <arquivo>` (o padrão continua sendo `npm run test:int`, com reset).
 */
export default async function globalSetup(): Promise<void> {
  const url = loadTestEnv();
  execSync('npx prisma migrate deploy', { cwd: resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
