# Worker de notificações (BullMQ + FCM) — Fase 4

Processo **separado da API**. Consome a fila `occurrence-events` (alimentada pelo publicador do outbox da API),
calcula os destinatários com PostGIS, grava a caixa de alertas, enfileira `push-deliveries` e entrega o push.
Também avisa o app em tempo real (mensagem `notification` na sala `user:<id>` do Socket.IO, via Redis).

```
npm run worker:dev        # na raiz; usa o .env da raiz
npm run test:unit -w @alertacidade/notification-worker
npm run test:int  -w @alertacidade/notification-worker   # banco de testes + Redis
```

O client do Prisma é o mesmo gerado a partir de `apps/api/prisma/schema.prisma` (`npm run db:generate`).

## Configuração

| Variável | Padrão | Observação |
|---|---|---|
| `DATABASE_URL` | — | obrigatória |
| `REDIS_URL` | `redis://localhost:6379` | |
| `REDIS_PREFIX` | `alertacidade` | **igual ao da API** (filas e canais do Socket.IO) |
| `WORKER_CONCURRENCY` | 5 | jobs simultâneos por fila |
| `PUSH_ATTEMPTS` | 6 | tentativas de push (backoff exponencial a partir de 5 s) |
| `FIREBASE_CREDENTIALS_FILE` | — | JSON da conta de serviço; presente ⇒ FCM |
| `PUSH_PROVIDER` | automático | `fcm` ou `log`; produção exige `fcm` |

Sem credenciais, o provedor de **log** registra o que seria enviado e marca `push_status = SKIPPED` (nunca `SENT`).

## Garantias
- Evento processado uma vez por consumidor: `processed_messages(consumer, message_id)`.
- Uma notificação por pessoa por evento: `UNIQUE(user_id, source_event_id)`.
- Push enfileirado dentro da mesma transação das notificações; `jobId` = id da notificação.
- Token morto (app desinstalado) é removido; erro na mensagem não apaga tokens; falha temporária é repetida.
- Encerramento ordenado (SIGINT/SIGTERM): termina os jobs em andamento; os pendentes ficam no Redis.
