// Verifica se schema.prisma e as migrations SQL descrevem o mesmo banco.
// O Prisma 6.19 não aceita a sintaxe `env:VAR` em --shadow-database-url, por isso a URL
// é lida do ambiente (carregado pelo dotenv-cli) e passada já expandida.
import { spawnSync } from 'node:child_process';

const shadowUrl = process.env.SHADOW_DATABASE_URL;
if (!shadowUrl) {
  console.error('SHADOW_DATABASE_URL não definida (veja .env.example).');
  process.exit(1);
}

const result = spawnSync(
  'npx',
  [
    'prisma', 'migrate', 'diff',
    '--from-migrations', 'prisma/migrations',
    '--to-schema-datamodel', 'prisma/schema.prisma',
    '--shadow-database-url', shadowUrl,
    '--exit-code',
  ],
  { stdio: 'inherit', shell: process.platform === 'win32' },
);

// --exit-code: 0 = sem diferença, 2 = há diferença, 1 = erro.
if (result.status === 2) console.error('Drift detectado entre schema.prisma e as migrations.');
process.exit(result.status ?? 1);
