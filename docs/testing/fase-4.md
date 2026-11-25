# Relatório de testes — Fase 4 (Distribuído) — em andamento

Ambiente: Windows 11, Node.js 22, Docker Desktop (WSL 2) com `postgis/postgis:17-3.5` e `redis:7.4-alpine`. Data: 23/11/2026.

Etapas: **4a API** ✅ · **4b worker** ✅ · **4c app (tempo real e alertas)** ✅ · **push no app + FCM real** pendente (precisa de projeto Firebase) · **cenário com 2 aparelhos** pendente.

## O que foi construído

| Peça | Arquivos | Papel |
|---|---|---|
| Publicador do outbox | `apps/api/src/events/outbox-publisher.service.ts` | Lê `domain_events` pendentes sob *advisory lock*, enfileira no BullMQ (`jobId` = id do evento), atribui o cursor de entrega e, depois do commit, emite pelo Socket.IO |
| Cursor de entrega | migration `20261123200000_outbox_delivery_cursor` | Coluna `published_sequence` + sequência própria + CHECK "publicado ⇔ tem cursor" |
| Socket.IO autenticado | `apps/api/src/realtime/*` | JWT de acesso no handshake; salas `user:<id>` e `role:<perfil>`; desconecta quando o token expira; adaptador Redis para várias instâncias |
| Sincronização | `GET /api/v1/sync?since=` | Eventos depois do cursor, paginados; `reset=true` se o cursor do cliente é maior que o do servidor |
| Notificações (API) | `PUT/DELETE /devices`, `GET /notifications`, `POST /notifications/:id/read`, `POST /notifications/read-all` | Tokens de push e caixa de alertas |
| Health | `GET /api/v1/health` | Inclui `redis`; Redis fora → 200 com `status: "degraded"` (banco fora continua 503) |
| Worker | `apps/notification-worker` | Consome `occurrence-events`, calcula destinatários (PostGIS), grava notificações, enfileira `push-deliveries`, entrega push e avisa o app em tempo real (`@socket.io/redis-emitter`) |

### Decisão: cursor de entrega (`published_sequence`)
O `sequence` original é gerado no INSERT, mas as transações confirmam fora de ordem: A recebe 10, B recebe 11 e B confirma antes. Um cliente que já viu o 11 descartaria o 10, e `GET /sync?since=11` também não o devolveria — evento perdido. O publicador agora atribui `published_sequence` **na ordem em que publica**, sob lock exclusivo, e é esse número que clientes e `/sync` usam. Lacunas (publicação desfeita) só disparam ressincronização. Coberto pelo teste "15 registros simultâneos".

### Decisão: regras de destinatário (não estavam na especificação)
- `occurrence.created` → usuários cuja área de interesse contém a ocorrência (`ST_DWithin` com o raio escolhido), com gravidade ≥ mínima, alertas ligados e conta ativa; exclui o autor; ocorrência removida/rejeitada antes do processamento não notifica.
- `occurrence.validated` / `rejected` / `resolved` → o autor (esses eventos passam a existir com a moderação, Fase 5).
- Toda mensagem diz que é relato de cidadão não verificado e cita o 199.

### Decisão: provedor de push
Sem credenciais do Firebase o worker usa o provedor de **log** (risco R4 previsto em `06-riscos.md`): fila, dedup e retries funcionam igual, mas a notificação fica com `push_status = SKIPPED` e `last_error = "Provedor de push de desenvolvimento (FCM não configurado)"` — nunca `SENT`. Em `APP_ENV=production` o worker recusa subir sem FCM. Erros do FCM são separados em: token morto (remove o token), erro na mensagem (falha sem apagar o token — evita apagar todos os tokens por um bug no payload) e temporário (BullMQ repete com backoff exponencial; vira `FAILED` na última tentativa).

## Testes automatizados

| Comando | Resultado |
|---|---|
| `npm run test:unit` | ✅ design tokens 7/7, API 29/29 (+1: Redis/outbox na configuração), worker 7/7 |
| Integração da API (`apps/api`, 10 suítes) | ✅ **84/84** em 3 execuções seguidas; **85/85** após o teste dos filtros de alertas (4c) |
| Integração do worker (`apps/notification-worker`) | ✅ **10/10**, 2 execuções seguidas |
| `npm run db:check-drift` | ✅ sem diferenças após a nova migration |

Casos novos da API (`test/realtime.e2e-spec.ts`, `test/notifications.e2e-spec.ts`, `test/health.e2e-spec.ts`):
- socket sem token, com token inválido ou com **refresh token** → recusado (`unauthorized`); access token válido → conecta;
- **duas instâncias da API**: ocorrência registrada em A chega ao cliente conectado em B (Socket.IO + Redis), sem dados do autor no payload;
- remoção gera `occurrence.removed`;
- 15 registros simultâneos: cursores estritamente crescentes no socket e `/sync` devolve exatamente os mesmos eventos;
- `/sync`: cursor atual, `reset`, paginação com `hasMore`, validação (400) e autenticação (401);
- cada evento vira um job no BullMQ com `jobId` = id do evento;
- falha do Redis simulada: evento fica pendente com `attempts` e `last_error`, e é publicado quando a fila volta;
- aparelhos: registro idempotente, troca de conta no mesmo aparelho, só o dono remove, validações;
- caixa de alertas: ordem, `unread`, isolamento entre usuários (404), marcar um/todos;
- health com Redis fora → 200 `degraded`.

Casos do worker (`test/worker.int-spec.ts`): destinatários (área, raio, gravidade mínima, alertas desligados, conta suspensa, autor, sem área); ocorrência removida; **mesmo evento processado 5× em paralelo → 1 notificação**; aviso de mudança de status ao autor; push `SENT`/`SKIPPED`/`FAILED`; token morto removido e token com erro de mensagem preservado; falha temporária → retry → `FAILED` na 3ª tentativa; provedor de log nunca marca `SENT`; **fluxo completo pelas filas reais** com reenvio do mesmo jobId ignorado e aviso chegando a um socket via adaptador Redis.

### Problemas encontrados e corrigidos durante os testes
1. `health.e2e`: teste instável — o publicador em segundo plano consumia o *mock* de falha do `$queryRaw`. O publicador é pausado nesse arquivo.
2. `realtime.e2e`: corrida no próprio teste (eventos chegavam antes de os ids serem conhecidos); o coletor passou a reavaliar periodicamente.
3. Worker: testes contavam usuários de execuções anteriores perto da Praça da Sé; cada teste usa agora um ponto aleatório. `QueueEvents` com conexão externa não fechada deixava o Jest pendurado.
4. Desligamento: "Connection is closed" intermitente ao encerrar a API — o Nest roda os ganchos de shutdown dos módulos **antes** de fechar o servidor Socket.IO. O pub/sub passou a ser fechado em `RedisIoAdapter.dispose()` e todas as conexões usam `QUIT` (espera comandos pendentes) com `disconnect` como plano B.
5. Worker real: na partida, 5 jobs simultâneos falharam com "Unable to start a transaction in the given time" (mesmo limite de 2 s do Prisma corrigido na Fase 2); os retries recuperaram todos. Correção: `maxWait` 10 s e `$connect()` antes de consumir as filas.

## Prova ponta a ponta com os processos reais (banco de desenvolvimento)

`npm run api:dev` + `npm run worker:dev`; script de verificação com as contas de demonstração (`cidada.a` registra; `cidadao.b` com área de interesse na Praça da Sé, raio 3 km, e um token de aparelho fictício escuta o socket como o app).

| Cenário | Resultado |
|---|---|
| Acúmulo antigo | Ao subir, o publicador enviou os 5 eventos pendentes do banco (cursor 1–5) e o worker processou todos |
| Caminho feliz | POST → evento no socket de B em **509 ms** (ciclo de 500 ms do publicador) → aviso "Alagamento de gravidade crítica a 298 m (Sé)" no socket 60 ms depois → caixa de alertas com 1 item → push pelo provedor de log, `SKIPPED` |
| **Worker derrubado** | Registro aceito (201), evento publicado (cursor 7) e **1 job aguardando no Redis**, nenhuma notificação; ao religar o worker, processado em 80 ms |
| **Redis derrubado** | Health `degraded`; REST continua (201); evento **pendente no banco** com 3 tentativas e o erro registrado; worker avisa e reconecta sozinho |
| **API derrubada com o evento pendente**, depois Redis e API religados | Evento publicado (cursor 8, erro limpo), worker notificou B; cliente B com último cursor 6 chamou `GET /sync?since=6` e recebeu **exatamente os 2 eventos perdidos** (7 e 8). Nenhuma perda. |

Limpeza: as ocorrências de teste foram removidas, os alertas delas apagados, o token fictício removido e as preferências de `cidadao.b` restauradas (5000 m, MODERATE, sem área).

## 4c — App (Flutter)

| Peça | Arquivos | Papel |
|---|---|---|
| Sincronização | `lib/core/realtime/realtime_sync.dart` | Cursor de entrega: descarta duplicatas, aplica em ordem, lacuna → `GET /sync`, reconexão percorre as páginas, `reset` recarrega tudo; ressincronizações simultâneas são unidas |
| Transporte | `lib/core/realtime/socket_transport.dart` | `socket_io_client` 3.1.6, WebSocket, reconexão com backoff (1–15 s) e o token lido **a cada tentativa** (`setAuthFn`) |
| Controlador | `lib/app/realtime.dart` | Liga/desliga com a sessão; antes de conectar busca o cursor por `GET /sync` (renova o token pela fila única do `ApiClient` — renovar em paralelo seria tratado pela API como reuso de refresh token); conexão recusada ou encerrada por token expirado → renova e reconecta com backoff; eventos recarregam mapa, "Meus registros" e detalhes abertos, agrupados em 300 ms |
| Alertas | `lib/features/alerts/*` | Caixa real da API com filtros no servidor (Todos, Não lidos, Críticos, Próximos, Resolvidos — usando o estado ATUAL da ocorrência), "carregar mais", marcar como lido/todos, alerta de ocorrência removida, contador na aba e aviso com "Ver" quando chega um alerta |

Ajuste na API para a tela: `GET /notifications` passou a trazer `occurrence: { code, severity, status }` (ou `null` se removida) e aceitar `filter`. Teste e2e cobre os filtros, a mudança de estado depois do alerta e a ocorrência removida (API: 8/8 nesse arquivo).

### Testes do app
- `flutter analyze`: ✅ sem problemas. `flutter test`: ✅ **49/49** (eram 30) + 1 pulado (o teste ao vivo, abaixo).
- `test/realtime_test.dart` (14): sincronização (sem cursor, duplicatas, lacuna, número pulado, paginação, reset, ressincronizações simultâneas, erro de rede preserva o cursor), sequence acima de 2^53 e tipo de evento desconhecido, e o controlador com transporte falso (conecta só depois do cursor, token sempre o mais recente, lacuna busca o que faltou, recusa por token → renova e reconecta, alerta vira aviso, logout desconecta e esquece o cursor).
- `test/alerts_test.dart` (4): lista com gravidade/status atuais e "não lido" acessível, filtro enviado à API e estado vazio por filtro, tocar marca como lido e alerta de ocorrência removida avisa em vez de abrir.

### Teste ao vivo: código real do app ↔ API e worker reais (sem emulador)
`test/live/realtime_live_test.dart` roda na VM do Dart com os providers reais do app (`ApiClient`, repositórios, `RealtimeController`, `SocketIoTransport`) contra `npm run api:dev` + `npm run worker:dev`. Só executa com `--dart-define=LIVE_TESTS=true`.

✅ Aprovado em 23/11/2026:
- handshake com JWT e transporte WebSocket do `socket_io_client` funcionam com o Socket.IO 4 da API;
- A registrou → evento chegou a B em **1,9 s** e o alerta do worker em **4,1 s** ("Alagamento de gravidade crítica a 222 m (Sé)"), com a gravidade atual;
- B desconectado, A registrou outra ocorrência, B reconectou → cursor avançou pelo `/sync` (evento perdido recuperado);
- caixa de alertas real com os dois alertas; limpeza feita (ocorrências removidas, alertas apagados, preferências restauradas).

Observação: a latência medida aqui foi maior que no teste com script Node (0,5 s e +60 ms). O worker estava ocioso havia cerca de uma hora; a causa não foi investigada. Não afeta a correção (nada se perde), mas fica registrada para a Fase 6.

O APK não foi recompilado nesta etapa: o `socket_io_client` é Dart puro (sem código nativo) e o código foi compilado e exercitado pelos testes. A validação visual no emulador ficou para o cenário de 2 aparelhos.

## Firebase / push no app — 23/11/2026

**Projeto:** `alertacidade-unip-2737` (conta Google do grupo, plano Spark gratuito), app Android `br.unip.alertacidade.alertacidade` registrado pela CLI (`firebase-tools` 15.34.2 via npx). Criação pela CLI exigiu que o usuário aceitasse no navegador os termos do Google Cloud e adicionasse o Firebase ao projeto pelo console (a CLI recebia "Callers must accept Terms of Service" e depois "The caller does not have permission").

**Arquivos sensíveis fora do Git:** `apps/mobile/android/app/google-services.json` (baixado com `apps:sdkconfig`), chave da conta de serviço (`*firebase-adminsdk*.json`, `firebase-sa.json`) e `firebase-debug.log` estão no `.gitignore`. A chave do worker fica fora do repositório.

**App:** `firebase_core` 5.1.0 e `firebase_messaging` 17.0.1 (versões de um mês; as de uma semana foram evitadas), plugin Gradle `com.google.gms.google-services` 4.5.0.
- `PushMessaging` (interface) com implementação Firebase e uma desativada (build sem Firebase continua funcionando).
- `PushController`: após login pede a permissão (Android 13+), registra o aparelho e envia o identificador por `PUT /devices`, acompanha renovações (uma única assinatura mesmo após vários logins); no logout remove na API **antes** de encerrar a sessão e desregistra o aparelho; toque na notificação com o app fechado ou em segundo plano abre `/occurrences/:id`; push com o app aberto recarrega a caixa de alertas.
- `MainActivity` cria o canal `alertas` (importância alta), declarado como canal padrão do FCM no manifesto, com a permissão `POST_NOTIFICATIONS`.

**Decisão: envio por Firebase Installation ID (FID).** No `firebase_messaging` 17, `getToken`/`onTokenRefresh`/`deleteToken` estão obsoletos (substituídos por `register`/`onRegistered`/`unregister`, que entregam o FID), e no `firebase-admin` 14 o alvo `token` também está obsoleto (substituído por `fid`). App e worker foram migrados juntos; a coluna `device_tokens.token` guarda o FID.

**Correção no worker:** o envio usava `clickAction: FLUTTER_NOTIFICATION_CLICK`, que exige uma intent-filter inexistente — tocar na notificação não abriria o app. Removido; o `firebase_messaging` abre o app pela intent padrão.

**Resultados:**
- `flutter analyze` sem problemas; `flutter test` ✅ **56/56** (+7 em `test/push_test.dart`) + 1 pulado (teste ao vivo).
- `flutter build apk --debug` ✅ (245 s). Conferido no APK com `aapt2`: permissão `POST_NOTIFICATIONS`, canal padrão `alertas` e configuração do projeto `alertacidade-unip-2737` embutidos.
- Worker: unit 7/7; integração 10/10 em 14 execuções, com **1 falha isolada** logo após o build do APK (máquina com pouca memória), que não se repetiu e cuja mensagem não foi capturada. Causa provável (não confirmada): o `PrismaClient` dos testes usava a espera padrão de 2 s por conexão no teste que processa o mesmo evento 5× em paralelo. Os testes passaram a usar as mesmas opções do worker (`prismaTransactionOptions`: 10 s / 20 s).

### Envio real pelo FCM (sem aparelho) — 23/11/2026
Chave da conta de serviço gerada pelo usuário no console e guardada fora do repositório (`C:/Users/pichau/.alertacidade/firebase-sa.json`, referenciada por `FIREBASE_CREDENTIALS_FILE` no `.env` local). Conferida sem exibir segredos: `type = service_account`, `project_id = alertacidade-unip-2737`.

- Worker iniciou com **`push: fcm`**.
- Teste: `cidadao.b` com área de interesse na Sé e um identificador de aparelho **falso de propósito**; `cidada.a` registrou uma ocorrência crítica a 298 m. Evento no socket em 266 ms e aviso em tempo real em +80 ms.
- O Google respondeu **`messaging/installation-id-not-registered: NotRegistered`** → credencial aceita (chave errada daria erro de autenticação) e mensagem válida; só o aparelho não existe, como esperado.
- **Defeito encontrado:** o worker só conhecia os códigos de "token morto" da era do token, tratou o código do FID como falha temporária (repetiu o envio) e não removeu o identificador. **Corrigido:** `classifyFcmError` (função pura, 3 testes unitários) inclui `installation-id-not-registered` como aparelho morto e `mismatched-credential` como falha permanente que preserva os identificadores. Revalidado com o mesmo job: na tentativa seguinte ficou `FAILED` e o identificador falso foi **removido** do banco.
- Worker: unit 10/10.
- Limpeza feita (ocorrência removida, alerta apagado, preferências de `cidadao.b` restauradas).

O que ainda NÃO foi verificado: a notificação aparecendo num aparelho real e o toque abrindo a ocorrência.

## Pendente
- ~~Recebimento num aparelho real~~ — **feito em 24/11** (celular via USB; faltava a `meta-data` `firebase_messaging_installation_id_enabled`; ver `fase-7.md`). Push de **ocorrência** com o app **fechado** conferido em 24/11 (banco de testes): ocorrência crítica #473 na Sé registrada por outra conta → `OCCURRENCE_NEARBY` "Alagamento de gravidade crítica a 65 m (Sé)" `SENT` ~2,5 s depois → recebido no celular e o toque abriu a ocorrência (confirmado pelo usuário).
- Cenário com **2 aparelhos/emuladores** (A registra → B vê sem atualizar; push recebido). Atenção ao consumo de memória do emulador nesta máquina.
- Desempenho: a latência de ~0,5 s vem do ciclo do publicador; pode cair com `LISTEN/NOTIFY` do PostgreSQL se necessário.
