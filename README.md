# AlertaCidade 2.0

**Plataforma colaborativa de monitoramento de alagamentos urbanos.**
*Sua cidade informada. Sua segurança em primeiro lugar.*

Projeto da APS de Sistemas Distribuídos — Ciência da Computação, UNIP.

> ⚠️ O AlertaCidade reúne **relatos de cidadãos** e **alertas identificados em notícias públicas**, e **não é um serviço oficial de emergência**.
> Em situação de risco, ligue para a **Defesa Civil (199)** ou os **Bombeiros (193)**.

## Estado atual

| Fase | Situação |
|---|---|
| 1 — Fundação | Implementada. Unitários, integração com PostGIS real, drift e seed executados (ver [docs/testing/fase-1.md](docs/testing/fase-1.md)) |
| 2 — Backend | Implementada. Unitários, fumaça e e2e (66/66) executados (ver [docs/testing/fase-2.md](docs/testing/fase-2.md)) |
| 3 — Mobile | Em andamento: telas, navegação e integração com a API implementadas; testes unitários/widget (31/31) e validação no emulador com a API real executados (ver [docs/testing/fase-3.md](docs/testing/fase-3.md)) |
| 4 — Recursos distribuídos | Em andamento: API (outbox + publicador, Socket.IO autenticado com Redis, `/sync`, alertas) e worker (BullMQ, destinatários PostGIS, push com retries) prontos e testados, inclusive derrubando worker, Redis e API; app com tempo real e tela de Alertas (49 testes + teste ao vivo contra a API); push recebido num celular real (24/11); falta o cenário com 2 aparelhos (ver [docs/testing/fase-4.md](docs/testing/fase-4.md)) |
| 5 — Administração | Concluída: API administrativa (moderação com controle otimista, denúncias, dashboard, relatórios e CSV, auditoria, usuários) e painel React; critério verificado com processos reais — moderar reflete no app em 2,5 s e avisa a autora; relatórios conferidos com SQL; auditoria com antes/depois (ver [docs/testing/fase-5.md](docs/testing/fase-5.md)) |
| 6 — Finalização | Em andamento: testes de falha (inclusive banco fora do ar), revisão de segurança (Swagger fechado em produção, CSP no painel), requisitos de SD conferidos com o código, roteiro de demonstração; falta o documento acadêmico (ver [docs/testing/fase-6.md](docs/testing/fase-6.md)) |
| 7 — News Intelligence | Concluída (etapas 1–12): coleta de notícias (RSS/GDELT) → regras (`rules-2`) → gazetteer IBGE → eventos agrupados → publicação com decisão de push na mesma transação → notificações por área; moderação no painel com aviso imediato de revisão urgente; camada no mapa e tela "Notícias e monitoramento" no app. Validada com fontes reais, processos reais (inclusive queda de PostgreSQL e Redis) e no celular; precisão com 280 notícias reais: 88,9 % / recall 100 % / 0 push indevido. Pendente: vínculo automático com relatos de cidadãos (ver [docs/testing/fase-7.md](docs/testing/fase-7.md)) |

## Estrutura

```
alertacidade/
├── apps/
│   ├── api/                   NestJS + Prisma: auth, usuários, ocorrências, fotos, confirmações
│   ├── mobile/                Flutter 3.50: mapa, nova ocorrência, detalhes, meus registros, perfil
│   ├── admin/                 React + Vite (Fase 5)
│   ├── notification-worker/   BullMQ + FCM (Fase 4)
│   └── news-worker/           News Intelligence: coleta, regras, gazetteer IBGE, eventos, publicação (Fase 7)
├── packages/
│   ├── design-tokens/         tokens.json → CSS, TS e Dart + teste de contraste WCAG
│   └── shared-types/          enums, eventos e DTOs compartilhados
├── infrastructure/database/   scripts de inicialização do PostgreSQL
├── docs/
│   ├── architecture/          arquitetura, design system, navegação, dados, roadmap, riscos
│   ├── testing/               relatórios de teste por fase
│   ├── diagrams/  academic/   (Fase 6)
├── docker-compose.yml         PostgreSQL 17 + PostGIS 3.5, Redis 7.4
└── .env.example
```

## Pré-requisitos (Windows)

| Ferramenta | Versão | Verificação |
|---|---|---|
| Node.js | 22 LTS | `node --version` |
| Docker Desktop **com WSL 2** | recente | `docker info` |
| Git | recente | `git --version` |
| Flutter 3.50 + Android Studio (SDK 36) | stable | `flutter doctor` |

Se `docker info` falhar e `wsl -l -v` disser que o WSL não está instalado, abra o **PowerShell como administrador**, rode `wsl --install`, reinicie o computador e abra o Docker Desktop.

## Como executar a Fase 1

```powershell
cd C:\Users\pichau\projetos\alertacidade
Copy-Item .env.example .env      # apenas na primeira vez
npm install
npm run infra:up                 # PostgreSQL/PostGIS + Redis (aguarda ficarem saudáveis)
npm run packages:build           # tokens de design e tipos compartilhados
npm run db:migrate               # aplica as migrations
npm run db:seed                  # usuários e ocorrências de DEMONSTRAÇÃO
npm run api:dev                  # API em http://localhost:3000
npm run admin:dev                # painel (desenvolvimento) em http://localhost:5173
npm run admin:preview            # painel em build de PRODUÇÃO (com CSP), também na porta 5173 (origem autorizada no CORS)
```

- Health check: <http://localhost:3000/api/v1/health>
- Swagger: <http://localhost:3000/api/docs>

### Endpoints principais (Fase 2)

| Área | Rotas |
|---|---|
| Autenticação | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password` |
| Usuário | `GET/PATCH /users/me`, `PATCH /users/me/password`, `GET/PUT /users/me/notification-preferences`, `GET /users/me/export`, `DELETE /users/me`, `GET /users` (admin) |
| Ocorrências | `POST /occurrences`, `GET /occurrences?lat&lng&radius&severity&status&periodHours&q&sort`, `GET /occurrences/mine`, `GET /occurrences/mine/summary`, `GET/DELETE /occurrences/:id` |
| Participação | `PUT/DELETE /occurrences/:id/confirmation`, `PUT/DELETE /occurrences/:id/save`, `POST /occurrences/:id/reports` |
| Fotos | `POST /occurrences/:id/photos` (multipart, campo `photo`), `GET/DELETE /photos/:id` |

Todas sob o prefixo `/api/v1`; documentação interativa em `/api/docs`.

**Recuperação de senha em desenvolvimento:** não há provedor de e-mail configurado. Fora de produção, o código de 6 dígitos aparece no log da API.

### Testes

```powershell
npm run test:unit       # sem infraestrutura: contraste WCAG, validação de ambiente, contratos
npm run test:int        # exige `npm run infra:up`: PostGIS, concorrência, idempotência, health e2e
npm run db:check-drift  # confirma que schema.prisma e migrations são equivalentes
```

Os testes de integração usam o banco isolado `alertacidade_test` e se recusam a rodar em outro banco.

## Monitoramento de notícias (Fase 7)

Processo separado (`apps/news-worker`): se uma fonte travar ou a análise falhar, o registro de ocorrências e o push
continuam funcionando. Nenhum modelo de linguagem nem API paga é usado.

```powershell
npm run news:seed-sources        # grava o catálogo de fontes (termos conferidos em 24/11/2026)
npm run news:dev                 # news-worker: filas news-collect / news-analyze / news-maintenance
npm run news:collect-now -- all  # coleta manual (ou pelo painel, em Notícias → Fontes)
npm run news:reprocess-failed    # devolve à análise artigos que falharam
```

Os três processos (API, `worker:dev`, `news:dev`) precisam do mesmo `REDIS_PREFIX`.

| Rotas (prefixo `/api/v1`) | Para quem |
|---|---|
| `GET /news/events` (mapa e lista), `GET /news/events/:id`, `GET /news/regions/:id/boundary`, `GET /news/filters` | Qualquer usuário autenticado; só o que foi publicado |
| `GET /admin/news/metrics`, `/review`, `/events/:id`, `PATCH /events/:id`, `POST /events/:id/approve\|reject\|resolve\|merge`, `GET /sources`, `/collections`, `POST /collect` | Moderação; ligar/desligar fonte só ADMIN |

Testes e avaliação: `npm run test:int -w @alertacidade/news-worker` (PostGIS e Redis reais); `npm run news:eval`
(corpus simulado); `npm run news:snapshot -- apps/news-worker/eval/snapshot-AAAAMMDD.json` e
`npm run news:eval-real -- <retrato> <rótulos>` (notícias reais rotuladas — ver `apps/news-worker/eval/README.md`).

### Usuários de demonstração (após `db:seed`)

Senha: valor de `DEMO_USER_PASSWORD` no `.env`.

| E-mail | Perfil |
|---|---|
| admin@alertacidade.demo | Administrador |
| moderacao@alertacidade.demo | Moderador |
| cidada.a@alertacidade.demo | Cidadão |
| cidadao.b@alertacidade.demo | Cidadão |

As ocorrências do seed têm `is_demo = true` e são exibidas com o selo "Demonstração".

## Uso de ferramentas de IA

Este projeto foi desenvolvido com apoio do **Claude** (Anthropic), via **Claude Code**: a ferramenta gerou e revisou
grande parte do código, dos testes e da documentação, a partir de requisitos, decisões e validações do grupo. Os testes
em aparelho real, a configuração de serviços externos (Firebase) e as decisões de produto foram do grupo. Todo resultado
apresentado foi verificado por execução, com evidências em [docs/testing](docs/testing). Declaração completa:
[docs/academic/uso-de-ia.md](docs/academic/uso-de-ia.md).

## Documentação

- **[Regras de negócio e regras do app](docs/regras-de-negocio.md)**
- **[Especificações técnicas](docs/especificacoes-tecnicas.md)** (linguagens, banco, versões, padrões)
- **[Como colocar no ar e gerar o APK](docs/como-colocar-no-ar.md)** (túnel Cloudflare, instalação em outros celulares)

1. [Arquitetura técnica](docs/architecture/01-arquitetura.md)
2. [Design system](docs/architecture/02-design-system.md)
3. [Navegação](docs/architecture/03-navegacao.md)
4. [Modelo de dados](docs/architecture/04-modelo-de-dados.md)
5. [Roadmap](docs/architecture/05-roadmap.md)
6. [Riscos](docs/architecture/06-riscos.md)
7. [News Intelligence — monitoramento de notícias](docs/architecture/07-news-intelligence.md) (seção 7.11: o que mudou na implementação)
8. Relatórios de teste por fase: [docs/testing](docs/testing)
9. Roteiro de demonstração: [docs/academic/roteiro-demonstracao.md](docs/academic/roteiro-demonstracao.md)
