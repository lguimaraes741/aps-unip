# Roteiro de demonstração — AlertaCidade 2.0

Item 9 do enunciado: *apresentação do programa em funcionamento, com todas as funcionalidades pedidas e extras*.
Duração sugerida: 15–20 min. Três papéis: **Cidadã A** (registra), **Cidadão B** (observa) e **Moderação** (painel).

## Preparação (antes da apresentação)

1. Abrir o **Docker Desktop** e esperar ficar verde.
2. Na raiz do projeto (PowerShell, usar `npm.cmd`):
   ```
   npm.cmd run infra:up
   npm.cmd run db:migrate
   npm.cmd run db:seed
   ```
3. Em quatro terminais separados:
   ```
   npm.cmd run api:dev        # API      → http://localhost:3000 (Swagger em /api/docs)
   npm.cmd run worker:dev     # worker   → deve mostrar "push: fcm" (ou "log" sem Firebase)
   npm.cmd run admin:dev      # painel   → http://localhost:5173
   npm.cmd run news:dev       # news-worker (monitoramento de notícias) → "iniciado"
   ```
   Na primeira vez, antes do `news:dev`: `npm.cmd run news:seed-sources`. Uma hora antes, rodar
   `npm.cmd run news:collect-now -- all` para trazer as notícias do dia.
4. Conferir `http://localhost:3000/api/v1/health` → `"status":"ok"` com database, postgis e redis.
5. App: **celular via USB** (recomendado, mais leve) ou emulador. No celular, `adb reverse tcp:3000 tcp:3000` e o app compilado com `--dart-define=API_BASE_URL=http://localhost:3000`.
6. Contas (senha `DEMO_USER_PASSWORD` do `.env`):
   - `cidada.a@alertacidade.demo` — Cidadã A (app)
   - `cidadao.b@alertacidade.demo` — Cidadão B (app ou segundo aparelho)
   - `moderacao@alertacidade.demo` — Moderação (painel)
   - `admin@alertacidade.demo` — Administração (painel)
7. Deixar a área de interesse do **Cidadão B** definida perto da Praça da Sé (Perfil → Notificações e raio).

## Roteiro

| # | O que mostrar | Onde | O que destacar (SD / extras) |
|---|---|---|---|
| 1 | Boas-vindas e login | App | Aviso de que não é serviço oficial (199/193); validação dos campos; sessão segura (JWT + refresh rotativo) |
| 2 | Mapa com ocorrências e filtros, lista "próximas" com distância | App | Consulta geográfica no servidor (PostGIS, raio); selo "Demonstração" nos dados do seed |
| 3 | Registrar ocorrência com **GPS** e **foto** | App (Cidadã A) | Rascunho salvo; envio idempotente; EXIF/GPS da foto removido no servidor (LGPD) |
| 4 | A ocorrência **aparece sozinha** no painel (fila de moderação) e no mapa do Cidadão B | Painel + App B | **Tempo real**: outbox → Socket.IO (Redis) — sem atualizar a tela; indicador "Ao vivo" |
| 5 | Cidadão B recebe **alerta** (aviso no app / push) e o vê na aba Alertas | App B | Worker separado, destinatários por raio e gravidade (PostGIS), fila BullMQ com retries |
| 6 | Cidadão B **confirma**; contador muda | App B | Concorrência: uma manifestação por pessoa, contadores exatos sob acessos simultâneos |
| 7 | Moderação **valida** a ocorrência no painel | Painel | Controle otimista (dois moderadores → um recebe "alterada por outra pessoa"); motivo obrigatório para rejeitar |
| 8 | No app: status vira **Validada** sozinho; a Cidadã A recebe "Sua ocorrência #N foi validada" | App A e B | Evento → app (2–3 s) e aviso do worker para a autora |
| 9 | Dashboard, mapa administrativo e **Relatórios + CSV** | Painel | Relatórios conferidos com SQL; CSV protegido contra injeção de fórmulas |
| 10 | **Auditoria** (admin): quem validou, antes → depois, IP | Painel (admin) | Trilha imutável sem dados sensíveis |
| 11 | **Tolerância a falhas** ao vivo: parar o worker (`Ctrl+C`), registrar outra ocorrência, religar → o alerta chega | Terminal + App | Nada se perde: o job espera na fila |
| 12 | (Opcional) Parar o Redis: `docker stop alertacidade-redis` → health "degraded", app continua registrando; `docker start alertacidade-redis` → tudo é entregue | Terminal + Painel (Ambiente) | Outbox transacional + `/sync` |
| 13 | Perfil: exportar dados (LGPD), preferências de alerta, sair | App | Direitos do titular; logout desvincula o aparelho do push |

### Monitoramento de notícias (Fase 7) — 5 a 7 min

> Depende de **chuva real**: só há alerta em vigor se fontes relataram alagamento nas últimas horas (validade de 6 h
> sem notícia nova). **Não inventar notícias no banco de desenvolvimento.** Sem episódio recente, mostrar o histórico
> (Período: últimos 7 dias), a moderação e a avaliação com notícias reais (passo 19).

| # | O que mostrar | Onde | O que destacar (SD / extras) |
|---|---|---|---|
| 14 | Painel → **Notícias**: métricas, fontes (termos conferidos), **Coletar agora** e o histórico de coletas | Painel | Processo separado com **filas** (coleta → análise → manutenção); 429/timeout com recuo por fonte; nada de API paga nem modelo de linguagem |
| 15 | Abrir um evento: **Fontes** (com as de mesma origem marcadas), **Regras** com as evidências citadas do texto e **Decisão automática** (motivos) | Painel | Regras rastreáveis (trecho do texto que justificou); **agrupar ≠ confirmar**; controle otimista e auditoria como nas ocorrências |
| 16 | App → mapa com a camada **Notícias** (chip): quadrado com jornal (notícia) × bolha (relato); alerta de cidade = área do contorno IBGE; tocar → resumo "Notícia ainda não confirmada. Não é comunicado oficial." → **Detalhes** com todas as fontes e **Ver original** | App | Consulta geográfica com o mesmo critério do push (ponto ou contorno); origem sempre explícita |
| 17 | App → Alertas → **Notícias e monitoramento**: filtros (cidade, período, gravidade, fonte, verificação); ligar o **modo avião** e puxar para atualizar → "Mostrando as notícias salvas" | App | Tolerância a falha de rede no cliente (cache só para a mesma consulta) |
| 18 | Se houver notícia **crítica de fonte única**: faixa **"Revisão urgente"** no painel em tempo real e push para a moderação; **Validar** → push crítico liberado para quem está na área | Painel + App | Crítico só com corroboração (também CHECK no banco); evento "só equipe" nunca chega aos cidadãos (socket e `/sync`) |
| 19 | Precisão e segurança: `npm.cmd run news:eval-real -- apps/news-worker/eval/snapshot-20261124.json apps/news-worker/eval/labels-20261124.json` | Terminal | 280 notícias reais: precisão 88,9 %, recall 100 %, 0 push indevido (antes do ajuste); SSRF e conteúdo adversário testados (`docs/testing/fase-7.md`, Etapa 11) |

## Plano B (se algo falhar na hora)
- Sem celular/emulador: mostrar o fluxo pelo **painel** + os **testes ao vivo** do app (`flutter test test/live …`), que usam o código real do app contra a API.
- Sem internet: o mapa (tiles do OpenStreetMap) não carrega; o restante funciona localmente.
- Se o Docker cair: reabrir o Docker Desktop e `npm.cmd run infra:up` — os dados persistem nos volumes.
- Ao final, limpar dados de teste com `npm.cmd run db:seed` (restaura as contas de demonstração).
- Notícias: se uma fonte responder 429 ou ficar fora do ar, ela entra em recuo sozinha (ver Painel → Notícias →
  Coletas); as demais continuam. O GDELT costuma responder 429 para este IP.
