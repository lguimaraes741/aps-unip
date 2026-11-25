import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { loadTestEnv } from './load-test-env';

/** Recria o schema do banco de testes aplicando as migrations reais (as mesmas de produção). */
export default async function globalSetup(): Promise<void> {
  const url = loadTestEnv();
  execSync('npx prisma migrate reset --force --skip-seed --skip-generate', {
    cwd: resolve(__dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}
