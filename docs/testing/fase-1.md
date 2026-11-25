# Relatório de testes — Fase 1 (Fundação)

Ambiente: Windows 11 Pro, Node.js 22.19.0, npm 11.5.2. Data: 23/11/2026.

## Executados

### `npm run test:unit` — ✅ 23/23 aprovados

| Suíte | Testes | Resultado |
|---|---|---|
| `packages/design-tokens/test/contrast.test.mjs` | 7 (contraste WCAG de textos, badges, marcadores; paletas completas) | ✅ 7 aprovados |
| `apps/api/src/config/env.validation.spec.ts` | 5 (padrões, obrigatórios, porta, CORS, curinga proibido em produção) | ✅ 5 aprovados |
| `apps/api/test/contracts.spec.ts` | 11 (9 enums compartilhados = schema do banco; transições; modelos obrigatórios) | ✅ 11 aprovados |

### Compilação
- `tsc --noEmit` na API (incluindo testes e seed): ✅ sem erros.
- `nest build`: ✅ gera `apps/api/dist`.
- `prisma migrate diff --from-empty`: ✅ gerou o SQL da migration inicial (índices GIST incluídos).

## Integração com banco real — executados em 23/11/2026

Ambiente: Docker Desktop 29.9.3 (WSL 2), `postgis/postgis:17-3.5`, `redis:7.4-alpine`.

| Comando | Resultado |
|---|---|
| `npm run infra:up` | ✅ Postgres e Redis `Healthy`; bancos `alertacidade`, `alertacidade_test` e `alertacidade_shadow` criados pelo script de init |
| `npm run db:migrate` | ✅ migration `20261123000000_init` aplicada |
| `npm run db:check-drift` | ❌ na 1ª execução: `P1010 User was denied access on the database (not available)`. Causa: o Prisma 6.19 não aceita a sintaxe `env:SHADOW_DATABASE_URL` em `--shadow-database-url`. Correção: `apps/api/prisma/check-drift.mjs` passa a URL já expandida. ✅ após a correção: **No difference detected** |
| `npm run db:seed` | ✅ 4 usuários e 5 ocorrências de demonstração (`is_demo=true`) |
| `test/database.int-spec.ts` | ✅ aprovado (parte da bateria `test:int`, ver fase-2.md) |
| `test/health.e2e-spec.ts` | ✅ aprovado |

Observação: o `globalSetup` dos testes executa `prisma migrate reset` em `alertacidade_test`. O Prisma bloqueia esse comando quando chamado por um agente de IA, então a primeira execução completa foi feita pelo usuário num terminal próprio (`npm.cmd run test:int`, por causa da política de execução de scripts do PowerShell).