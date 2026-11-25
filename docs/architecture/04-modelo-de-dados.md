# 4. Modelo de dados

Fonte: [`apps/api/prisma/schema.prisma`](../../apps/api/prisma/schema.prisma) e a migration
[`20261123000000_init`](../../apps/api/prisma/migrations/20261123000000_init/migration.sql).

## 4.1 Diagrama entidade-relacionamento

```mermaid
erDiagram
  users ||--o{ occurrences : "registra"
  users ||--o{ occurrences : "modera"
  users ||--o{ confirmations : "manifesta"
  users ||--o| notification_preferences : "configura"
  users ||--o{ device_tokens : "possui"
  users ||--o{ notifications : "recebe"
  users ||--o{ audit_logs : "executa"
  users ||--o{ refresh_tokens : "sessões"
  users ||--o{ password_reset_tokens : "recupera"
  users ||--o{ saved_occurrences : "salva"
  users ||--o{ content_reports : "denuncia"
  occurrences ||--o{ occurrence_photos : "tem"
  occurrences ||--o{ confirmations : "recebe"
  occurrences ||--o{ occurrence_status_history : "linha do tempo"
  occurrences ||--o{ saved_occurrences : ""
  occurrences ||--o{ content_reports : ""
  occurrences ||--o{ notifications : "origina"

  users {
    uuid id PK
    varchar name
    citext email UK
    varchar password_hash
    user_role role
    user_status status
    timestamptz deleted_at
  }
  occurrences {
    uuid id PK
    serial code UK
    varchar title
    text description
    varchar address
    varchar neighborhood
    float8 latitude
    float8 longitude
    geography location "GIST, via trigger"
    severity severity
    occurrence_status status
    timestamptz occurred_at
    int confirm_count
    int contest_count
    int version
    bool is_demo
    uuid created_by_id FK
    uuid client_request_id "UK com created_by_id"
  }
  occurrence_photos {
    uuid id PK
    uuid occurrence_id FK
    varchar storage_key UK
    varchar mime_type
    int size_bytes
  }
  confirmations {
    uuid id PK
    uuid occurrence_id FK
    uuid user_id FK
    confirmation_type type
  }
  notification_preferences {
    uuid user_id PK
    bool push_enabled
    int radius_meters
    severity min_severity
    geography location
  }
  notifications {
    uuid id PK
    uuid user_id FK
    uuid source_event_id "UK com user_id"
    delivery_status push_status
    timestamptz read_at
  }
  domain_events {
    uuid id PK
    bigserial sequence UK
    varchar type
    uuid aggregate_id
    jsonb payload
    timestamptz published_at
  }
  processed_messages {
    varchar consumer PK
    uuid message_id PK
  }
  audit_logs {
    uuid id PK
    uuid actor_id FK
    varchar action
    varchar entity_type
    jsonb before
    jsonb after
  }
```

## 4.2 Tabelas

| Tabela | Finalidade | Regras de integridade principais |
|---|---|---|
| `users` | Contas e perfis | e-mail `citext` único (case-insensitive), CHECK de formato; exclusão lógica |
| `refresh_tokens` | Sessões (só hash) | família para detectar reuso |
| `password_reset_tokens` | Códigos de recuperação (só hash) | ≤ 10 tentativas |
| `occurrences` | Relatos de alagamento | lat/lng em faixa válida; `location` NOT NULL via CHECK; `RESOLVED ⇒ resolved_at`; idempotência por `(created_by_id, client_request_id)` |
| `occurrence_photos` | Evidências | MIME ∈ {jpeg, png, webp}; ≤ 10 MB; até 5 por ocorrência |
| `confirmations` | Confirmar/contestar | `UNIQUE(occurrence_id, user_id)` |
| `occurrence_status_history` | Linha do tempo / moderação | — |
| `saved_occurrences` | Ocorrências salvas | PK composta |
| `content_reports` | Denúncias | uma por usuário por ocorrência |
| `notification_preferences` | Raio, gravidade mínima, área de interesse | raio 100 m–50 km; lat/lng ambos ou nenhum |
| `device_tokens` | Tokens FCM | token único |
| `notifications` | Caixa de alertas | `UNIQUE(user_id, source_event_id)` |
| `domain_events` | Outbox + cursor de sincronização | `sequence` monotônico |
| `processed_messages` | Idempotência de consumidores | PK `(consumer, message_id)` |
| `audit_logs` | Auditoria (antes/depois em JSONB) | — |

## 4.3 Consulta geográfica de referência

```sql
-- Ocorrências ativas num raio de :raio metros, da mais próxima para a mais distante.
SELECT id, title, severity, status,
       ST_Distance(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography) AS distance_m
FROM occurrences
WHERE deleted_at IS NULL
  AND status IN ('PENDING', 'UNDER_REVIEW', 'VALIDATED')
  AND ST_DWithin(location, ST_SetSRID(ST_MakePoint(:lng, :lat), 4326)::geography, :raio)
ORDER BY distance_m
LIMIT 50;
```
`ST_DWithin` sobre `geography` usa o índice GIST `occurrences_location_idx` (comprovado em teste com `EXPLAIN`) e calcula distâncias em metros sobre o elipsoide.

## 4.4 Datas e fuso horário
Todas as colunas são `timestamptz` (instante absoluto); o banco opera em UTC (`TZ=UTC`, `ALTER DATABASE … SET timezone 'UTC'`). A API serializa em ISO-8601 com `Z`; app e painel convertem para `America/Sao_Paulo` (ou o fuso do dispositivo) na apresentação.

## 4.5 Política de retenção (LGPD) — implementação nas Fases 2/6
| Dado | Retenção |
|---|---|
| Refresh tokens expirados/revogados | removidos após 30 dias |
| Códigos de recuperação | removidos após 24 h |
| `domain_events` publicados | removidos após 30 dias |
| `processed_messages` | removidos após 7 dias |
| Notificações | 90 dias |
| Conta excluída | dados pessoais anonimizados imediatamente; relatos permanecem sem autoria identificável |
