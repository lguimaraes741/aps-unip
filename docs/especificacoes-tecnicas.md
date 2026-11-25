# AlertaCidade 2.0 — Especificações técnicas

O que o sistema usa e como está montado. As regras de negócio estão em [regras-de-negocio.md](regras-de-negocio.md);
o detalhamento de arquitetura, em [architecture/](architecture/).

---

## 1. Visão geral

Sistema distribuído com **cinco processos** independentes, um banco compartilhado e um barramento de mensagens:

```
 App Android (Flutter) ─┐  REST/JSON + JWT          ┌─► PostgreSQL 17 + PostGIS 3.5 (fonte da verdade)
 Painel web (React)  ───┼─► API (NestJS) ───────────┤
                        └── Socket.IO (tempo real) ◄─┴─► Redis 7.4 (filas BullMQ, pub/sub do Socket.IO)
                                                          ▲            ▲
                     Worker de notificações (Node) ───────┘            │   ──► Firebase Cloud Messaging (push)
                     News-worker (Node) ───────────────────────────────┘   ──► fontes RSS / GDELT (HTTPS)
```

| Processo | Papel |
|---|---|
| **API** (`apps/api`) | REST, autenticação, regras, outbox, publicador de eventos, gateway Socket.IO |
| **Worker de notificações** (`apps/notification-worker`) | Calcula destinatários (PostGIS), grava a caixa de alertas, envia push |
| **News-worker** (`apps/news-worker`) | Coleta notícias, analisa, agrupa em eventos, decide publicação |
| **Painel** (`apps/admin`) | SPA de moderação e administração |
| **App** (`apps/mobile`) | Cliente Android dos cidadãos |

## 2. Linguagens

| Onde | Linguagem |
|---|---|
| API, workers, painel, pacotes compartilhados | **TypeScript 5.9** (Node.js 22 LTS) |
| App | **Dart** (SDK ^3.14) com **Flutter 3.50** |
| Banco | **SQL** (PostgreSQL/PostGIS) — migrations, CHECKs, triggers, consultas geográficas |
| Infraestrutura | Docker Compose (YAML), scripts PowerShell/Node |

## 3. Banco de dados e armazenamento

| Item | Especificação |
|---|---|
| SGBD | **PostgreSQL 17** com **PostGIS 3.5** (imagem `postgis/postgis:17-3.5`) |
| ORM / migrations | **Prisma 6.19** (migrations versionadas em `apps/api/prisma/migrations`; `db:check-drift` confere schema × migrations) |
| Dados geográficos | Colunas `geography(Point/MultiPolygon, 4326)` preenchidas por trigger a partir de lat/lng; índices GiST; consultas com `ST_DWithin`, `ST_Distance`, `ST_PointOnSurface`, `ST_SimplifyPreserveTopology` |
| Integridade no banco | CHECKs (ex.: data, tamanho de foto, "crítico só com corroboração", "ponto exige precisão de rua"), UNIQUEs de idempotência, chaves estrangeiras |
| Bancos | `alertacidade` (desenvolvimento) e `alertacidade_test` (testes; os testes se recusam a rodar em outro) |
| Redis | **7.4** com persistência AOF — só transporte (filas e pub/sub), nunca fonte da verdade |
| Fotos | Disco local da API (pasta definida em `STORAGE_DIR`, com proteção contra *path traversal*); servidas por rota pública cujo endereço contém um identificador aleatório (UUID), para funcionar direto em `<img>` e `Image.network`; o envio exige login |
| No aparelho | `flutter_secure_storage` (tokens), `shared_preferences` (rascunho, cache de notícias) |

Principais tabelas: `users`, `refresh_tokens`, `password_reset_tokens`, `occurrences`, `occurrence_photos`,
`occurrence_status_history`, `confirmations`, `saved_occurrences`, `content_reports`, `notification_preferences`,
`notifications`, `device_tokens`, `domain_events` (outbox), `processed_messages`, `audit_logs` e, no módulo de
notícias, `news_sources`, `news_collection_jobs`, `news_articles`, `news_analyses`, `news_regions`, `news_events`,
`news_event_articles`, `news_alerts`. Modelo completo: [architecture/04-modelo-de-dados.md](architecture/04-modelo-de-dados.md).

## 4. Back-end

| Componente | Tecnologia (versão) |
|---|---|
| Framework da API | **NestJS 11.2** |
| Validação | class-validator 0.15 (whitelist; campos desconhecidos recusados) |
| Autenticação | JWT (`@nestjs/jwt` 11) de 15 min + refresh token opaco rotativo (30 dias, só hash no banco) |
| Hash de senha | **Argon2id** (`argon2` 0.45) |
| Limite de requisições | `@nestjs/throttler` 6.8 (120/min; 10/min nas rotas de autenticação) |
| Cabeçalhos de segurança | Helmet 8.3; CORS por lista de origens |
| Documentação da API | Swagger (`@nestjs/swagger` 11.4) em `/api/docs` (fechado em produção) |
| Imagens | sharp 0.35 (reprocessa para JPEG e remove metadados/EXIF) |
| Filas | **BullMQ 5.81** + ioredis 5.11 |
| Tempo real | **Socket.IO 4.8** com `@socket.io/redis-adapter` 8.3 (várias instâncias da API); o worker emite via `@socket.io/redis-emitter` 5.1 |
| Push | **Firebase Cloud Messaging** via `firebase-admin` 14.5 (envio por Firebase Installation ID); sem credenciais, um provedor de log (status `SKIPPED`) |
| Coleta de notícias | undici 7.30 (HTTP com limites e proteção SSRF), fast-xml-parser 5.12 (RSS/Atom) |

Prefixo de todas as rotas: `/api/v1`. Health check: `GET /api/v1/health` (banco, versão do PostGIS e Redis).

## 5. Front-end

### 5.1 App (Android)
| Item | Tecnologia |
|---|---|
| Framework | **Flutter 3.50.1** (Material via `material_ui`) |
| Estado | Riverpod 3 |
| Navegação | go_router 18 |
| HTTP | dio 5 (renovação de token em fila única) |
| Mapa | flutter_map 8 + tiles do **OpenStreetMap** |
| Localização | geolocator 14; endereço automático por geocodificação reversa do próprio Android (`geocoding` 5, sem chave nem servidor) |
| Fotos | image_picker |
| Tempo real | socket_io_client 3 |
| Push | firebase_core 5 + firebase_messaging 17 |
| Outros | connectivity_plus (detecção de rede), url_launcher, share_plus, intl (pt-BR), fonte Inter embutida |

### 5.2 Painel web
| Item | Tecnologia |
|---|---|
| Biblioteca | **React 19.3** + react-router 8.5 |
| Build | **Vite 8.3** (build de produção com Content-Security-Policy) |
| Dados | TanStack Query 5 |
| Mapa | Leaflet 1.9 + react-leaflet 5 |
| Tempo real | socket.io-client 4.8 |

### 5.3 Design system
Tokens únicos em `packages/design-tokens/tokens.json`, gerados para CSS (painel), TypeScript e Dart (app), com teste
automático de **contraste WCAG**. Gravidade nunca é indicada só por cor (ícone e formato também).

## 6. Comunicação e padrões de sistemas distribuídos

| Necessidade | Solução |
|---|---|
| Cliente ↔ servidor | REST/JSON com JWT; contrato no Swagger |
| Assíncrono API → workers | Filas BullMQ (`occurrence-events`, `push-deliveries`, `news-collect`, `news-analyze`, `news-maintenance`), com tentativas, espera crescente e área de falhas para reprocesso |
| Servidor → clientes | Socket.IO autenticado; salas por usuário e por perfil; eventos "só equipe" apenas para moderadores e administradores |
| Não perder eventos | **Transactional Outbox**: a mudança e o evento são gravados na mesma transação; um publicador entrega depois |
| Ordem de entrega | Cursor `published_sequence` atribuído pelo publicador sob *advisory lock* |
| Ressincronização | `GET /sync?since=<cursor>` após reconexão ou lacuna |
| Não duplicar | `clientRequestId` (criação), UNIQUE por pessoa (confirmação, denúncia, notificação), `jobId` = id do evento, tabela `processed_messages` |
| Concorrência | Transações com `FOR UPDATE`; controle otimista por `version` na moderação; *advisory lock* no agrupamento de notícias |
| Tolerância a falhas | Redis fora → API segue (health `degraded`), eventos esperam no banco; worker fora → jobs esperam na fila; fonte de notícia fora → recuo por fonte; testado derrubando API, worker, Redis e PostgreSQL |

Detalhes: [architecture/01-arquitetura.md](architecture/01-arquitetura.md) e
[architecture/07-news-intelligence.md](architecture/07-news-intelligence.md).

## 7. Segurança

- Senhas Argon2id; tokens de acesso curtos; refresh rotativo com detecção de reuso; códigos de recuperação com
  validade e limite de tentativas.
- Autorização por perfil (`@Roles`) e por recurso (ex.: só a autora remove a própria ocorrência pendente).
- Entradas validadas; SQL sempre parametrizado; CSV protegido contra injeção de fórmulas.
- Upload: tipo pela assinatura do arquivo, limite de 10 MB (também CHECK no banco), nome gerado pelo servidor,
  metadados removidos.
- Coleta de notícias: só http(s), limite de tempo e tamanho, no máximo 3 redirecionamentos, **bloqueio de rede interna
  (SSRF)** inclusive IPv4 embutido em IPv6, com o IP conferido na hora da conexão (contra *DNS rebinding*); feeds com
  entidades XML recusados; texto das notícias tratado sempre como dado.
- Painel com Content-Security-Policy; refresh token só na sessão da aba.
- Revisão completa: [testing/fase-6.md](testing/fase-6.md) e Etapa 11 de [testing/fase-7.md](testing/fase-7.md).

## 8. Testes

| Parte | Ferramentas | Resultado mais recente (24/11/2026) |
|---|---|---|
| API | Jest 29 + Supertest; e2e com PostGIS e Redis reais, inclusive 2 instâncias da API | unitários 43, e2e **126** |
| Worker de notificações | Jest (unitário e integração) | 20 + 17 |
| News-worker | Jest (unitário e integração); corpus simulado; avaliação com **280 notícias reais** | 203 + 62; precisão 88,9 %, recall 100 %, 0 push indevido |
| Painel | Vitest 5 + Testing Library | 21 |
| App | flutter_test (unitários e widget) + testes ao vivo contra a API | **87** |
| Banco | `db:check-drift` | sem diferenças |

Relatórios com evidências por fase: [testing/](testing/).

## 9. Ambiente e execução

| Ferramenta | Versão |
|---|---|
| Node.js | 22 LTS |
| Docker Desktop (WSL 2) | PostgreSQL/PostGIS e Redis via `docker-compose.yml` |
| Flutter | 3.50.1 (stable), Android SDK 36, NDK 28.2 |
| Sistema de desenvolvimento | Windows 11 |
| Aparelho de teste | Android 16 (via USB, `adb reverse tcp:3000 tcp:3000`) |

```powershell
npm run infra:up          # PostgreSQL/PostGIS + Redis
npm run db:migrate        # migrations
npm run db:seed           # contas e ocorrências de demonstração (selo "Demonstração")
npm run api:dev           # API → http://localhost:3000 (Swagger em /api/docs)
npm run worker:dev        # worker de notificações
npm run news:dev          # news-worker
npm run admin:dev         # painel → http://localhost:5173
```

Variáveis de ambiente: `.env.example` (banco, Redis, JWT, limites, Firebase). Credenciais do Firebase ficam fora do
repositório. Monorepo com **npm workspaces** (`apps/*`, `packages/*`), versões fixadas para builds reprodutíveis.

## 10. Estrutura do repositório

```
alertacidade/
├── apps/
│   ├── api/                   NestJS + Prisma (REST, outbox, Socket.IO)
│   ├── notification-worker/   BullMQ + FCM
│   ├── news-worker/           coleta e análise de notícias
│   ├── admin/                 React + Vite
│   └── mobile/                Flutter
├── packages/
│   ├── design-tokens/         tokens → CSS, TS, Dart + teste de contraste
│   └── shared-types/          enums, eventos e contratos compartilhados
├── infrastructure/database/   inicialização do PostgreSQL
├── docs/                      arquitetura, testes por fase, UX, material acadêmico
└── docker-compose.yml
```
