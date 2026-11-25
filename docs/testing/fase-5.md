# Relatório de testes — Fase 5 (Administração)

Ambiente: Windows 11, Node.js 22, Docker (PostgreSQL/PostGIS + Redis), API e worker em execução local. Data: 23/11/2026.

Critério do roadmap: *moderar no painel reflete no app em tempo real; relatórios batem com consultas SQL; auditoria registra antes/depois.* — **✅ atendido, com evidência abaixo.**

## 5a — API administrativa (`apps/api/src/admin`)

| Rota | Perfil | Função |
|---|---|---|
| `GET /admin/dashboard` | MOD, ADMIN | Status, ativas por gravidade, fila de moderação, denúncias abertas, últimas 24 h × 24 h anteriores, tempo médio até validar (30 dias), série de 14 dias, top 5 bairros, quantidade de registros de demonstração |
| `GET /admin/occurrences`, `GET /admin/occurrences/:id` | MOD, ADMIN | Todas as ocorrências (inclusive rejeitadas) com filtros; análise com fotos, histórico com nomes, denúncias e transições permitidas. E-mail do autor só para ADMIN (minimização, LGPD) |
| `POST /admin/occurrences/:id/status` | MOD, ADMIN | Transição validada por `STATUS_TRANSITIONS`; **controle otimista** (`expectedVersion` → 409); motivo obrigatório para rejeitar; na mesma transação: histórico, evento no outbox (`validated`/`rejected`/`resolved`/`updated`) e auditoria com antes/depois |
| `GET /admin/content-reports`, `POST …/:id/resolve` | MOD, ADMIN | Fila de denúncias (mais antigas primeiro); encerrar uma única vez (409 na segunda), auditado |
| `GET /admin/statistics` | MOD, ADMIN | Relatório de [from, to): totais, por status, gravidade, bairro e dia (fuso America/Sao_Paulo), taxa de resolução, tempo médio até validar; período máximo de 366 dias |
| `GET /admin/exports/occurrences.csv` | MOD, ADMIN | CSV com `;` e BOM UTF-8 (Excel em português), datas no horário de Brasília, **proteção contra injeção de fórmulas**; demonstração excluída por padrão; limite de 50 mil linhas |
| `GET /admin/audit` | ADMIN | Trilha com autor, antes/depois e IP |
| `PATCH /admin/users/:id` | ADMIN | Perfil e suspensão/reativação; não altera a própria conta; **não remove o último ADMIN ativo** (transação serializável); suspender revoga as sessões; auditado |

Também: `P2034` (transação serializável abortada) passou a responder 409 em vez de 500.

### Defeito encontrado pelos próprios testes
A primeira versão do `csvCell` prefixava com apóstrofo **toda** célula iniciada por `-` — inclusive latitude e longitude negativas (todas no Brasil), que deixariam de ser número na planilha. Corrigido: número puro (`-23.550520`) é mantido; `-2+3+cmd|…` continua neutralizado. Testes unitários e e2e cobrem os dois casos.

### Testes da API
- Unitários: **35/35** (+6: CSV seguro e regra do último administrador com transação simulada).
- Integração/e2e: **99/99** em 11 suítes (+14 em `test/admin.e2e-spec.ts`):
  - permissões: cidadão 403 em tudo, sem token 401; moderador sem auditoria nem gestão de usuários (403);
  - fluxo PENDING → UNDER_REVIEW → VALIDATED → RESOLVED com `validatedAt`/`resolvedAt`, eventos no outbox na ordem, 3 registros de auditoria com antes/depois e histórico no app como "moderação";
  - **dois moderadores ao mesmo tempo → exatamente um 201 e um 409**; versão desatualizada → 409;
  - transição inválida e rejeição sem motivo → 422; status inexistente → 400; ocorrência inexistente → 404;
  - rejeitada some do mapa público e gera `occurrence.rejected`;
  - **critério: moderar emite o evento ao socket de um cidadão em < 5 s**;
  - denúncia: fila, filtro "com denúncias abertas", encerrar uma vez, auditoria;
  - **relatórios comparados com SQL independente** escrito no teste (total, por status, gravidade, bairro e soma por dia); dashboard (fila e denúncias) idem;
  - CSV: cabeçalho, BOM, `;`, aspas, fórmula neutralizada, coordenadas negativas como número, quantidade de linhas = SQL;
  - governança: promover, suspender (refresh 401, login recusado), reativar; 3 registros na trilha; nada sensível; não altera a si mesmo; estados inválidos 400/422.

## 5b — Painel React (`apps/admin`)

React 19.3.1, React Router 8.5.1, TanStack Query 5.107.1, Leaflet 1.9.4 + react-leaflet 5.0.0, socket.io-client 4.8.4, Vite 8.3.7, Vitest 5.1.0 (maior versão publicada há mais de 14 dias de cada um). Gráficos em SVG próprio (sem biblioteca), com tabela equivalente para leitores de tela. Estilos só com os tokens `--ac-*` do design system; fonte Inter local.

| Rota | Tela |
|---|---|
| `/login` | Login; cidadão é recusado com orientação |
| `/` | Dashboard: indicadores, 14 dias, ativas por gravidade, por status, fila de moderação, bairros; aviso quando há dados de demonstração |
| `/occurrences` | Abas Fila de moderação / Todas / Denúncias; busca com debounce de 300 ms, filtros, paginação |
| `/occurrences/:id` | Análise: relato, fotos, minimapa, histórico, denúncias e moderação com diálogo de confirmação (motivo obrigatório para rejeitar; 409 mostra a mensagem e recarrega) |
| `/map` | Mapa com marcadores por gravidade (resolvidas/rejeitadas com opacidade reduzida) e filtro de status |
| `/reports` | Período, indicadores, por dia, status/gravidade, bairro e exportação CSV |
| `/users` (ADMIN) | Busca, perfil e suspensão com confirmação |
| `/audit` (ADMIN) | Trilha com só os campos alterados (antes → depois) |
| `/settings` (ADMIN) | "Ambiente": saúde de banco/PostGIS/Redis e versão (somente leitura — a configuração da plataforma fica no `.env` do servidor) |

- **Sessão:** access token em memória, refresh token em `sessionStorage` (some ao fechar a aba); renovação **única e compartilhada**, inclusive na restauração ao recarregar (o StrictMode do React executa o efeito duas vezes — renovar em paralelo seria tratado pela API como reuso de refresh token).
- **Tempo real:** Socket.IO com o token consultado a cada tentativa; eventos invalidam dashboard, listas e a análise aberta (agrupados em 300 ms); indicador "Ao vivo" na barra lateral.
- **Desempenho:** telas com mapa carregadas sob demanda — pacote principal de 536 kB para 375 kB.

### Testes do painel
- `tsc --noEmit` sem erros; `vite build` ✅.
- Vitest **11/11**: renovação única com 5 requisições simultâneas; sessão expirada avisa a interface; mensagens de erro em português; período do relatório; diff da auditoria; cidadão recusado no login; menu por perfil (moderador × administrador); sem sessão → login; rejeitar exige motivo e 409 aparece e recarrega; validar envia a versão vista e passa a oferecer "Marcar como resolvida"; status final sem ações.

## Prova ponta a ponta com os processos reais

`test/live/moderation_live_test.dart` (código real do app, na VM do Dart) + API + worker; a moderação usa **a mesma rota e corpo** que a tela de análise do painel envia, com a conta `moderacao@alertacidade.demo`.

✅ 23/11/2026:
- `cidadao.b` com os detalhes da ocorrência abertos no app → moderador valida → **em 2,5 s** os detalhes se recarregam sozinhos com status Validada, a nota e a marcação de moderação;
- `cidada.a` (autora) recebe no app, **em 4,4 s**, o aviso do worker: "Sua ocorrência #24 foi validada";
- auditoria: `occurrence.status_changed` (moderacao@, PENDING → VALIDATED) e a remoção de limpeza `occurrence.removed` (admin@, VALIDATED → removida).

Servidor de desenvolvimento do painel conferido: `http://localhost:5173` serve a página, as fontes e o código; a API responde ao CORS para essa origem.

## Pendente
- Validação visual do painel no navegador pelo usuário (os fluxos foram verificados por testes e pela API real, não por inspeção visual).
- Itens herdados da Fase 4: push num aparelho real e cenário com 2 aparelhos.
