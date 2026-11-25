# Relatório de testes — Fase 2 (Backend)

Ambiente: Windows 11 Pro, Node.js 22.19.0. Data: 23/11/2026.

## Executados

### `npm run test:unit` — ✅ 28/28 aprovados (+ 7 de contraste no design system)

| Suíte | Testes |
|---|---|
| `src/config/env.validation.spec.ts` | 13 — padrões, obrigatórios, segredo JWT (tamanho e valor de exemplo em produção), TTL, CORS |
| `src/photos/image-signature.spec.ts` | 2 — JPEG/PNG/WebP reconhecidos; PHP, PDF, GIF e vazio rejeitados |
| `src/common/http/validation-exception.factory.spec.ts` | 2 — mensagens em português agrupadas por campo |
| `test/contracts.spec.ts` | 11 — enums compartilhados = schema do banco |

### Compilação e teste de fumaça da aplicação compilada (sem banco)
`nest build` + `node dist/main.js`, requisições reais com `curl`:

| Verificação | Resultado |
|---|---|
| `GET /health` com banco fora do ar | ✅ 503 `{"checks":{"database":"down"}}` sem detalhes internos |
| Rota protegida sem token / com token falso | ✅ 401 |
| Cadastro com dados inválidos e campo `role` injetado | ✅ 400 com mensagens em português por campo |
| Login com banco fora do ar | ✅ 503 "Banco de dados temporariamente indisponível" (sem stack trace) |
| Swagger (`/api/docs-json`) | ✅ 21 caminhos, 29 operações |
| Cabeçalhos de segurança (Helmet) | ✅ presentes |

O teste de fumaça encontrou e permitiu corrigir um defeito real de build (build incremental não emitia `dist/prisma`).

## Integração/e2e com PostgreSQL/PostGIS real — executados em 23/11/2026

| Suíte | Casos |
|---|---|
| `test/auth.e2e-spec.ts` | cadastro (hash Argon2id, campo `role` proibido, validação, e-mail duplicado case-insensitive); login (mensagem idêntica para senha errada e e-mail inexistente, conta suspensa); rotação de refresh token com detecção de reuso; renovações concorrentes; logout; recuperação de senha completa, código de uso único, bloqueio após 5 tentativas; RBAC (somente ADMIN lista usuários) |
| `test/users.e2e-spec.ts` | perfil; troca de senha encerra sessões; preferências de notificação (trigger geográfico, validação de raio); exportação LGPD; exclusão/anonimização com auditoria |
| `test/occurrences.e2e-spec.ts` | criação com histórico + evento no outbox; idempotência sequencial e concorrente; validações (inclusive data futura/antiga e injeção de `status`); raio PostGIS ordenado por distância; filtros; paginação; busca com curingas literais; visibilidade de rejeitadas; privacidade do autor; meus registros e totais; remoção; salvar/denunciar idempotentes |
| `test/confirmations.e2e-spec.ts` | confirmar → contestar → retirar; autor não confirma a própria; resolvida não aceita; 15 usuários simultâneos → contadores exatos; mesmo usuário alternando 20× em paralelo → 1 manifestação coerente |
| `test/photos.e2e-spec.ts` | remoção de EXIF/GPS comprovada; redimensionamento; arquivo disfarçado → 415; > 10 MB → 413; só o autor envia; limite de 5 (inclusive com 8 envios simultâneos); remoção |
| `test/rate-limit.e2e-spec.ts` | 4ª tentativa de login no minuto → 429 com `Retry-After` |

### 1ª execução (usuário, `npm.cmd run test:int`) — ❌ 62/66 (3 suítes falharam)

As 4 falhas tiveram a mesma causa: `PrismaClientKnownRequestError: Transaction API error: Unable to start a transaction in the given time`, convertida em HTTP 500.

| Teste | Sintoma |
|---|---|
| occurrences › reenvios simultâneos idênticos geram um único registro | parte das 5 requisições não retornou 200/201 |
| photos › envios simultâneos respeitam o limite de 5 fotos | só 2 de 8 retornaram 201 (esperado 5) |
| confirmations › 15 usuários confirmando ao mesmo tempo | cadastro concorrente → 500 |
| confirmations › mesmo usuário alternando 20 vezes | nem todas as respostas foram 200 |

**Causa:** transações interativas que disputam a mesma linha (`SELECT … FOR UPDATE`) aguardam o lock segurando conexões do pool. O padrão do Prisma (`maxWait` de 2 s para obter conexão, `timeout` de 5 s) era insuficiente sob rajadas de 15 a 20 requisições simultâneas. A lógica de serialização estava correta; o limite de espera é que estava curto demais.

**Correção:** `apps/api/src/prisma/prisma.service.ts` passou a usar `transactionOptions: { maxWait: 10_000, timeout: 15_000 }`.

### Após a correção — ✅ 66/66

- As 3 suítes que falharam: ✅ 29/29.
- Bateria completa `test:int` duas vezes seguidas: ✅ 8/8 suítes e 66/66 testes nas duas, sem nenhum erro de transação.
- `npm run test:unit`: ✅ 28/28 (sem regressão).

Observação: as reexecuções após a correção foram feitas pelo agente sobre o banco `alertacidade_test` já migrado, com o `globalSetup` substituído por um arquivo vazio (sem reset, porque o Prisma bloqueia o reset quando chamado por agente). **Confirmado pelo usuário em 23/11/2026:** `npm.cmd run test:int` com reset do banco → ✅ 8/8 suítes, 66/66 testes (62 s). As linhas `prisma:error` com "Unique constraint failed" no log são esperadas: os testes provocam de propósito e-mail duplicado e reenvios simultâneos com o mesmo `clientRequestId`, a API trata essas violações e os testes passam.