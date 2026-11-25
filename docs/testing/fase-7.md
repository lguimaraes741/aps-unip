# Relatório — Fase 7 (News Intelligence) — em andamento

Especificação e decisões: `docs/architecture/07-news-intelligence.md`.
Ordem adotada: 1 → 5 → 2 → 3 → 6 → 4 → 7 → 10 → 8 → 9 → 11 → 12 (núcleo de regras primeiro, testável sem rede).

## Situação por etapa

| Etapa | Situação | Evidência |
|---|---|---|
| 1 — Modelagem e fontes | ✅ aprovado pelo usuário em 24/11 (GDELT + RSS, **nada pago**, sem modelo de linguagem); fontes conferidas (abaixo) | `07-news-intelligence.md`, `src/sources/catalog.ts` |
| 5 — Regras (relevância, temporalidade, gravidade, confiança, publicação) | ✅ núcleo implementado e testado | `apps/news-worker/src/{analysis,policy}` |
| 6 — Gazetteer e agrupamento | ✅ contornos IBGE dos 16 municípios + região metropolitana (união no PostGIS); agrupamento persistido em `news_events` com confirmação por fontes elegíveis. **Pendente:** contorno de distritos (GeoSampa) e geocodificação de logradouros | `src/geo`, `src/events`, `test/events.int-spec.ts` |
| 2 — Tabelas e migration | ✅ `20261124120000_news_intelligence` aplicada (dev e teste); `db:check-drift` sem diferenças; 16 testes de constraints | `apps/api/prisma`, `test/schema.int-spec.ts` |
| 3 — Conectores | ✅ RSS/Atom e GDELT atrás de `NewsSourceAdapter`; coletor com job, backoff por fonte, pré-filtro, idempotência; **validado contra as fontes reais** | `src/sources`, `src/collector` |
| 4 — Filas e processamento | ✅ processo `news-worker` com BullMQ (agendador por fonte, filas de coleta/análise/manutenção, falhas retidas, reprocessamento, recuperação de órfãos); validado com processo real, queda do Redis e 2 instâncias | `src/news-worker.ts`, `src/main.ts`, `test/queues.int-spec.ts` |
| 7 — Painel de moderação | ✅ API `admin/news/*` (12 rotas) + página "Notícias" no painel React; validado com dados reais | `apps/api/src/news`, `apps/admin/src/pages/News*.tsx` |
| 10 — Publicação e notificações | ✅ `news_alerts` + decisão de push + outbox na mesma transação; worker de notificações com destinatários por área (contornos IBGE); app tolerante a itens de notícia; **cadeia completa verificada com processos reais** | `src/events/publication.ts`, `apps/notification-worker`, `src/tools/e2e-chain.ts` |
| 8, 9, 11, 12 | ⏳ | — |

## Execuções — 24/11/2026

### Testes unitários (`npm run test:unit -w @alertacidade/news-worker`)
**118/118** (5 suítes), `tsc --noEmit` sem erros, `npm run build` gera `dist/` com o gazetteer.

| Suíte | O que cobre |
|---|---|
| `text.spec.ts` | acentos, HTML/entidades, truncamento, URL canônica (utm, `www.`, `m.`, `/amp`, fragmento), recusa de `javascript:`/`file:`/credenciais na URL, domínio de órgãos `*.sp.gov.br` |
| `rss.spec.ts` | RSS 2.0 e Atom; item sem link ignorado; data inválida vira `null`; resumo ≤ 500; página HTML de erro rejeitada; **feed com `<!ENTITY>` recusado** (billion laughs) |
| `similarity.spec.ts` | exemplo "Osasco" do enunciado agrupado; cidades/distritos/logradouros diferentes separados; janela de 6 h; republicação, mesmo veículo e mesma agência **não** contam como fontes independentes |
| `policy.spec.ts` | critérios de confiança; baixa nunca publica; crítico de fonte única publica preliminar **sem push** e com revisão urgente; 2 independentes / fonte oficial / moderador liberam; notícia nunca vira nível OFICIAL; sem repetição de push sem aumento de gravidade |
| `analysis.spec.ts` | 37 casos do corpus + rastreabilidade (trecho literal com acentos), negação por frase, data ausente/futura, homônimos (Santo André/PB, Ipiranga/PR, Santana × Santana de Parnaíba, "estado de São Paulo") |

### Corpus simulado (`npm run news:eval`)

```
Totalmente corretos:    37/37
Relevância:             100.0%
Temporalidade:          100.0%
Gravidade:              100.0%
Status de publicação:   100.0%
Alertas falsos:         0
Alertas perdidos:       0
Push indevido:          0
Tempo médio por artigo: ~2 ms
```

**Limite desta medição (importante):** o corpus é o conjunto de *desenvolvimento* — os textos foram escritos
para testar os casos do enunciado e as regras foram corrigidas olhando para eles. A primeira rodada, antes
das correções, deu **29/36**, com 0 alertas falsos, 0 push indevido e **6 alertas perdidos**
(verbos com o alagamento como sujeito — "Alagamento bloqueia rua" — e "Água invadiu casas" não eram
reconhecidos). Esses 100% **não** indicam precisão em notícias reais. A avaliação válida (Etapa 11)
precisa de notícias reais coletadas, rotuladas por pessoas **antes** de ver a saída do sistema.

### Dados de referência
- Nomes e códigos de municípios (5 571) e dos 96 distritos da capital: **IBGE, API de Localidades v1**,
  consultada em 24/11/2026 → `apps/news-worker/src/geo/data/ibge-localidades.json`.
- Constatação usada nas regras: 38 dos 96 distritos da capital têm nome de município em outro lugar
  (ex.: Lapa/PR, Santana/AP, Pinheiros/ES; Socorro, Pedreira e Tremembé são municípios do próprio estado).
  Das 16 cidades monitoradas, só **Santo André** tem homônimo (PB).

## Problema de ambiente encontrado
O pacote `@esbuild/win32-x64` (binário usado pelo `tsx`) **não estava instalado** e o `package-lock.json`
não tem entrada para ele — `tsx` falhava com "The package @esbuild/win32-x64 could not be found".
Isso afeta também `npm run worker:dev` e `npm run db:seed`. Contorno aplicado:
`npm install --no-save @esbuild/win32-x64@0.28.2`. **Não corrigido no lockfile** — uma instalação limpa
voltará a falhar até o lockfile ser regenerado (decisão do usuário).

## Limitações conhecidas do núcleo de regras
- Regras olham só título + resumo do feed (não buscamos o artigo completo, por decisão de direitos autorais).
- Distritos só da capital; bairros de Osasco/Barueri etc. ainda não reconhecidos (sem base oficial carregada).
- "Gravidade" de alagamento sem impacto descrito fica **não informada** (intencional) — o app precisará
  de um visual próprio para isso.
- Notícia que relata ocorrência e anuncia obra ao mesmo tempo vai para `UNCERTAIN` → moderação.

## Execuções — 24/11/2026 (2ª parte: Etapas 2 e 3)

### Banco (Etapa 2)
Migration `20261124120000_news_intelligence`, **só aditiva** (nenhum DROP): 9 tabelas, 13 enums, trigger de ponto
(reaproveita `set_location_from_coordinates`) e CHECKs com as regras de publicação. Aplicada com `prisma migrate deploy`
no banco de desenvolvimento e no de testes; `npm run db:check-drift` → "No difference detected".

`test/schema.int-spec.ts` — **16/16** contra PostgreSQL/PostGIS reais. O banco recusa: fonte ligada sem termos conferidos;
intervalo < 5 min; URL duplicada (e `skipDuplicates` devolve 0); URL `javascript:`; DUPLICATE sem original; análise
repetida para a mesma versão de regras (versão nova convive); relevante sem temporalidade; **coordenada sem precisão de
logradouro**; **confiança baixa publicada sem moderador**; artigo em dois eventos; **push crítico de alerta preliminar sem
revisor**; retratação sem motivo; job encerrado sem término. O trigger grava `POINT(-46.79 -23.53)`.

### Conectores (Etapa 3)
- `src/sources/http.ts`: timeout (inclusive de **conexão**), limite de 5 MB (com e sem Content-Length), charset do cabeçalho
  ou do XML, gzip, 429/503 com `Retry-After`, 5xx/rede = temporário, 4xx = permanente, até 3 redirecionamentos,
  **bloqueio SSRF** (loopback, redes privadas, 169.254.169.254, IPv6 local — também após redirecionamento), requisição condicional.
  Limitação: a checagem de DNS e a conexão resolvem o nome separadamente (janela de *DNS rebinding*); as URLs de fonte
  só são definidas por administradores.
- `src/sources/adapters.ts`: RSS/Atom (desembrulha o redirecionador da Folha) e GDELT DOC 2.0.
- `src/collector/collector.ts`: registra `news_collection_jobs`; pré-filtro de tema (só guarda itens sobre alagamento);
  `createManyAndReturn + skipDuplicates` (idempotente); backoff por fonte 5→15→45 min… até 6 h, ou o `Retry-After` se maior;
  agendamento respeita o backoff, reprocessamento manual não; **detecção de feed parado** (> 7 dias).
- Testes: unitários **151/151** (`http.spec.ts` com servidor HTTP local); integração **24/24** (`collector.int-spec.ts`).

### Conferência das fontes (24/11/2026)
| Fonte | Resultado | Decisão |
|---|---|---|
| Agência Brasil (últimas) | 200, RSS; robots.txt sem bloqueio | ligada |
| g1 SP — `/rss/g1/sao-paulo/` | 200, mas **itens de 2018** (feed abandonado) | trocada por `/rss/g1/sp/sao-paulo/` (itens do dia) |
| Folha Cotidiano | 200, RSS 0.91 em ISO-8859-1, links por redirecionador; robots.txt sem bloqueio para `*` | ligada |
| CNN Brasil | 200, RSS; robots.txt sem bloqueio | ligada |
| Prefeitura de Osasco | 200, RSS WordPress; robots.txt sem bloqueio | ligada (OFFICIAL) |
| Defesa Civil SP `/feed/` | devolve página HTML com script anti-robô | **fora** (não contornamos bloqueios) |
| GDELT DOC 2.0 | servidor leva ~11 s para conectar; respondeu **429 em todas as tentativas** deste IP, mesmo com minutos de intervalo | ligada, mas sem dados até o limite liberar; conector trata como falha temporária |

A licença de reprodução da Agência Brasil não foi confirmada automaticamente — não importa para o uso atual (só título,
link e resumo do feed), mas fica a conferir antes de exibir resumos no app.

### Primeira coleta REAL (`npm run news:collect-once`)
380 itens lidos de 5 fontes; o pré-filtro guardou **15** sobre alagamento/chuva. Avaliação manual de cada um:

| Rodada | Corretos | Erros relevantes |
|---|---|---|
| Regras `rules-1` (escritas **antes** de ver estes textos) | 9/15 | **2 alertas falsos com push** ("Aparecida, em São Paulo" → capital; "árvore cai em Moema" → alagamento em Moema), 1 alerta perdido (descartado como previsão), 1 crítico subestimado (sem push errado), 2 ambiguidades indevidas |
| Regras `rules-2` (corrigidas a partir deles) | 15/15 no meu julgamento | — mas não é mais medida independente |

Correções feitas (`rules-2`): municípios paulistas fora da área (IBGE) e "X, em São Paulo" = estado; "cidade/prefeitura de
São Paulo" e "Zona Sul de SP" identificam a capital ("zona sul" sozinha não — existe no Rio); distrito citado em frase de
outro incidente (árvore, desabamento…) não localiza o alagamento; "deixa carros submersos", "foi bloqueado",
"desapareceu", "buscas por mulher", "caiu no rio" passaram a contar. Três casos parafraseados viraram regressão no corpus (C38–C40).

**Medida honesta pendente:** coletar de novo em outro dia e avaliar notícias que as regras ainda não viram.

### Suíte completa de integração (executada pelo usuário, 24/11/2026)
`npm.cmd run test:int` com a migration `20261124120000_news_intelligence` (reset completo do banco de testes):
API **99/99** (11 suítes), worker de notificações **10/10**, news-worker **24/24**. A migration nova não quebrou nada
das fases anteriores. As linhas `prisma:error … Unique constraint failed` no log são esperadas: vêm dos testes que
provam que e-mail repetido e reenvio com o mesmo `clientRequestId` não duplicam registros.

## Execuções — 24/11/2026 (3ª parte: Etapa 6)

### Gazetteer no banco
- **Municípios:** contornos da API de Malhas v3 do IBGE (`qualidade=maxima`), 16 cidades, salvos em
  `src/geo/data/malhas-municipios.json` com a origem. Conferido no PostGIS: Osasco com área entre 55 e 75 km²
  e o centro da cidade dentro do contorno.
- **Região metropolitana:** `ST_Union` dos 16 contornos, calculada no banco. Cobre Osasco e Guarulhos e não cobre Campinas.
- **Distritos da capital (96): sem contorno.** A API do IBGE responde 400 ("o parâmetro intrarregiao NÃO aceita valores")
  para distritos. Não desenhamos polígono: evento de distrito aparece com o nome do distrito sobre a área da cidade.
  O contorno oficial está no GeoSampa (Prefeitura de SP) — pendente.
- Migration `20261124140000_news_event_location_keys` (aditiva): `city_ibges`, `district_ibges`, `places` + índice GIN.
  Aplicada em dev e teste; `db:check-drift` sem diferenças.

### Agrupamento (`src/events/event-builder.ts`)
Por artigo, numa transação: análise gravada em `news_analyses` (evidências literais, motivos, `model_version = none`)
→ descarte com motivo, ou agrupamento sob *advisory lock* por cidade → recálculo do evento a partir de todas as fontes
(gravidade máxima, precisão, confiança, decisão e região). Idempotente (artigo já ligado não é reprocessado).
Decisão de moderador prevalece; evento descartado não recebe fontes novas. `expireStaleEvents` → DESATUALIZADO após 6 h.

Integração **44/44** (`events.int-spec.ts`: 20 testes, repetida 3 vezes, estável), incluindo 4 matérias da mesma
cidade processadas **em paralelo → 1 evento**. Unitários **157/157**.

### Notícias reais → eventos (`npm run news:build-events`)
Primeira execução sobre os 15 artigos reais: 6 eventos, com **3 erros de raciocínio meus**, todos de confirmação:
| Erro | Correção |
|---|---|
| "SP registra 10 mortes em um mês" (local ambíguo — o estado) contou como 2ª fonte → evento crítico **verificado** | fonte com local ambíguo agrupa como contexto, não confirma |
| Matéria só com a cidade confirmou um caso específico do **Jabaquara** → crítico verificado | em evento de distrito, só confirma quem cita o distrito |
| Matéria só com a cidade era anexada ao evento de distrito **mais recente** (arbitrário) | escolha determinística (`pickMatch`): com vários distritos candidatos, abre evento próprio |
| A matéria que citava o Ipiranga deixou de contar por ser do mesmo veículo de outra matéria (árvore em Moema) | elegíveis primeiro, depois agrupamento por origem |

Resultado final: 6 eventos. Só **um verificado** (g1 + Folha, alagamentos na capital na tarde de 23/11). Quatro
críticos ficam **preliminares, com revisão urgente e sem push crítico**. Um vai para moderação (auditoria do TCU sobre
El Niño, sem local) e 5 ficam desatualizados, porque as notícias são de 22–23/11. Mesma ressalva de antes: avaliação
feita sobre dados que orientaram as correções.

## Execuções — 24/11/2026 (4ª parte: Etapa 4)

### Desenho
- Filas (nomes em `@alertacidade/shared-types`): `news-collect`, `news-analyze` (jobId = id do artigo), `news-maintenance`.
- Agendador: um *job scheduler* do BullMQ por fonte **ligada**, com o intervalo da fonte; conferido com `news_sources` a cada 5 min (fonte desligada perde o seu). Coleta agendada que falha **não** é repetida pela fila — vale o backoff da fonte; coleta manual com falha temporária é repetida (3×), **exceto 429**.
- Análise: 5 tentativas com backoff exponencial (10 s); esgotou → artigo `FAILED` com o erro e job retido 30 dias na lista de falhos (a "fila de mortos"). `npm run news:reprocess-failed` reenfileira.
- Manutenção: eventos desatualizados e **artigos órfãos** (gravados sem job, ex.: processo caiu entre o INSERT e o enfileiramento) — também na inicialização.
- Logs estruturados (JSON por linha) e contagem das filas a cada minuto. Coleta manual: `npm run news:collect-now -- <fonte|all>`.

### Testes
Unitários **159/159**; integração **52/52** (repetida 2×): `queues.int-spec.ts` cobre agendador (criação, intervalo,
remoção, idempotência), fluxo completo coleta → análise → evento pelas filas reais, falha agendada × manual, 429,
jobId duplicado processado uma vez, recuperação de órfão, falha persistente (3 tentativas → FAILED → reprocessado com
sucesso) e falha temporária (2ª tentativa resolve).
Durante o desenvolvimento: o *backoff* curto do teste não era aplicado (corrigido: parâmetro de `queueOptions`) e uma
conexão Redis esquecida impedia o Jest de encerrar.

### Processo real (banco de desenvolvimento, fontes reais)
| Cenário | Observado |
|---|---|
| Inicialização | 6 agendadores; 5 fontes RSS coletadas pelo agendador; GDELT 429 → backoff 5 → 15 → 45 min |
| Redis parado 15 s com o worker rodando | um aviso por fila + "Redis indisponível"; religado → "Redis reconectado" em ~4 s; coleta pedida em seguida processada |
| Ruído no log durante a queda | **antes:** dezenas de rastros `AggregateError` por segundo (filas e workers sem ouvinte de erro); **depois:** 4 linhas por queda |
| Duas instâncias do worker ao mesmo tempo (aconteceu sem querer) | 6 coletas divididas entre as duas (4 + 2), **nenhuma processada duas vezes** |
| Requisição condicional | Agência Brasil respondeu **304** na segunda coleta (feed não baixado de novo) |
| 429 em coleta manual | **antes:** a fila repetia (2 tentativas extras contra o GDELT); **depois:** não repete |

Erro meu registrado: um script de teste meu enfileirou um job com o prefixo padrão do BullMQ (`bull`), porque o `.env`
não define `REDIS_PREFIX`; o worker usa `alertacidade`, então o job "sumiu". Foi o motivo do utilitário `news:collect-now`,
que usa a mesma configuração do worker.

**Não verificado:** encerramento gracioso por sinal. No Windows, o `timeout` encerra o processo sem entregar SIGTERM
(o log não mostra "encerrando"); o caminho de Ctrl+C (SIGINT) existe no código, mas não foi exercitado aqui. O
encerramento abrupto foi exercitado três vezes, e a inicialização seguinte recuperou sem perda.

## Execuções — 24/11/2026 (5ª parte: Etapa 7)

### API (`apps/api/src/news`) — perfis MODERATOR/ADMIN, Swagger `admin-news`
| Rota | Função |
|---|---|
| `GET /admin/news/metrics` | notícias coletadas/relevantes, eventos por status, ativos por gravidade (inclui "não informada"), fontes e falhas de coleta em 24 h |
| `GET /admin/news/review` | fila (padrão: não finais; **urgentes primeiro**) com filtros de status, gravidade, confiança, cidade, urgência, período e busca por título/N-código |
| `GET /admin/news/events/:id` | fontes com **evidências literais**, evidências anuladas, ambiguidades, decisão automática e auditoria |
| `PATCH /admin/news/events/:id` | corrige título, gravidade (`NONE` = não informada) e local (cidade ou distrito monitorado) |
| `POST …/approve · reject · resolve` | validar (exige local), descartar (exige motivo), encerrar |
| `POST …/merge` | duplicidade: fontes passam para outro evento; recálculo pedido ao news-worker pela fila |
| `GET /admin/news/regions · sources · collections` | opções de local, saúde das fontes, histórico de coletas |
| `POST /admin/news/collect` | coleta imediata pela fila (sem empilhar pedidos repetidos) |
| `PATCH /admin/news/sources/:id` | **só ADMIN**: liga/desliga; ligar exige termos conferidos |

Mesmo padrão da moderação de ocorrências: controle otimista (`expectedVersion` → 409) e auditoria com antes/depois e IP
**na mesma transação**. O que o moderador corrige (status, gravidade, local) não é mais sobrescrito pelo recálculo automático.
Desvio do enunciado: as ações ficam em `/admin/news/events/:id/approve` (e não `/admin/news/:id/approve`), porque o que se
modera é o evento, não um artigo.

### Painel (`/news`)
Indicadores; abas **Eventos** (colunas do enunciado: título, portal, cidade, data, gravidade estimada, confiança, status),
**Fontes** (coletar agora; ligar/desligar só para ADMIN) e **Coletas** (falhas com o erro). Tela de análise com aviso
"não é comunicado oficial", evidências, link para a notícia original (`target=_blank`, `rel=noopener noreferrer`),
validar/descartar/encerrar, corrigir gravidade e local, marcar duplicidade e trilha de auditoria. Gravidade nula aparece
como **"Não informada"**, nunca como baixa.

### Testes
- API e2e **113/113** (99 anteriores + 14 novos em `news-admin.e2e-spec.ts`): permissões (401/403, fonte só ADMIN), fila e
  filtros, evidências no detalhe, validar sem local → 422, corrigir local para distrito e validar com auditoria, local fora da
  área → 422, **dois moderadores simultâneos → 201 + 409** com uma só auditoria, descarte exige motivo, encerrar, mesclar com
  recálculo na fila, ligar fonte sem termos → 422, coleta manual deduplicada na fila, indicadores. Rodado com
  `npm run test:int:deploy` (variante nova sem reset; o reset completo continua sendo `npm run test:int`).
- Contratos: os enums novos em `shared-types` conferem com o banco (16/16).
- Painel (Vitest) **18/18** (7 novos). Build de produção do painel OK.
- news-worker: unitários 159/159, integração 52/52.

### Com dados reais (API rodando no banco de desenvolvimento)
Indicadores, fila, detalhe (evidências literais das duas fontes do N-15), regiões (112) e Swagger com as 12 rotas conferidos.
**Problema encontrado:** eventos desatualizados continuavam marcados como "revisão urgente" e subiam para o topo da fila.
Corrigido: ao ficar desatualizado, o evento perde a urgência (teste acrescentado; aplicado ao banco de dev).
**Não verificado:** a navegação no navegador (as telas foram testadas com Testing Library e o build passou, mas não abri o
painel num navegador real nesta etapa).

## Execuções — 24/11/2026 (6ª parte: Etapa 10)

### Achado antes de começar: o app quebraria
`DomainEvent.fromJson` exigia `payload.occurrenceId` (um `news.alert.*` no `/sync` derrubaria a sincronização inteira) e
`NotificationKind.fromApi` lançava exceção para tipo desconhecido (a aba Alertas ficaria em erro). Corrigido: tipos novos
tolerados, alerta de notícia com ícone próprio, toque não diz mais "ocorrência removida". `flutter test` **65/65**,
`flutter analyze` limpo. **O app já instalado no celular é anterior a esta correção — reinstalar antes de ligar o news-worker no
banco que ele usa.**

### Desenho
- `syncPublication` (news-worker) deriva o alerta do evento e grava, **na mesma transação**: `news_alerts` (nível, status,
  gravidade publicada), a **decisão de push** (`notified_severity`, `last_notified_at`) e o evento `news.alert.published|updated|resolved|retracted|expired`
  no outbox. É chamada no recálculo de todo evento, na normalização e na expiração; a API pede o recálculo após cada decisão do
  moderador; uma reconciliação periódica cobre pedidos perdidos (fila fora do ar).
- Regras de push: sem gravidade → não; preliminar → só ALTA; crítico só confirmado (2 fontes independentes, fonte oficial ou
  moderador — também CHECK no banco); novo aviso só se a gravidade subir ou o alerta deixar de ser preliminar; encerramento/correção
  avisa quem recebeu; expiração é silenciosa.
- Worker de notificações: destinatários = área de interesse cruzando o ponto do evento ou, sem ponto, o contorno oficial (IBGE) da
  cidade/região (distrito sem contorno usa o da cidade); gravidade ≥ mínima de cada pessoa; sem área conhecida → ninguém.
  Textos seguem os exemplos do enunciado, dizem a origem (notícia não confirmada / fontes independentes / comunicado oficial) e
  nunca afirmam que uma via é segura.
- Migrations `20261124180000_news_alert_notifications` (tipos `NEWS_ALERT`/`NEWS_ALERT_UPDATE`, `notifications.news_event_id`,
  CHECK ocorrência-ou-notícia) e `20261124181000_news_alert_published_severity`. Aplicadas em dev e teste; drift sem diferenças.

### Testes
- news-worker integração **60/60** (+8 de publicação: preliminar alto com push; 2ª fonte → "confirmado"; 3ª fonte igual não repete;
  crítico de fonte única sem push e liberado pelo moderador; moderado sem push e encerrado sem aviso; retirada com motivo e aviso;
  expiração silenciosa; fonte oficial → nível OFICIAL; confiança baixa nunca cria alerta; idempotência; reconciliação).
- Worker de notificações: unitários **17/17** (+7 de mensagens), integração **16/16** (+6: área cruzando o contorno, gravidade
  mínima, push desligado, distrito sem contorno, sem área → ninguém, `notify:false` respeitado, correção só para quem recebeu,
  deep link do push com `newsEventId`).
- API e2e **113/113** (aprovação agora informa `publicationQueued` e o recálculo aparece na fila).

### Ponta a ponta com processos reais (`npm run news:e2e -- http://localhost:3100`)
API (publicador do outbox) + news-worker + worker de notificações rodando contra o banco de **testes** (prefixo `alertacidade-e2e`,
push pelo provedor de log):

| Passo | Resultado |
|---|---|
| Notícia alta de fonte única enfileirada | aviso "Alerta de alagamento — Osasco / Notícia ainda não confirmada relata interdição de via…" em **422 ms** |
| Moderador valida pela API (HTTP) | aviso "Alerta de alagamento confirmado — Osasco" em **242 ms** |
| 2ª fonte com a mesma gravidade | agrupada no mesmo evento; **nenhum aviso repetido** |
| Moderador descarta | "Alerta corrigido — Osasco" (`NEWS_ALERT_UPDATE`) em **229 ms**; alerta `RETRACTED` com o motivo |
| Outbox do alerta | `news.alert.published → updated → retracted` |

Na primeira tentativa o roteiro saiu contaminado: a notícia agrupou com um evento de Osasco deixado pelo e2e da API no banco de
testes e a validação foi (corretamente) recusada como transição para o mesmo status. O roteiro passou a limpar os eventos do banco
de testes antes de começar.

**Não verificado nesta etapa:** entrega do push num aparelho real (pendência da Fase 4) e a notificação chegando pelo Socket.IO ao
app (o worker emite para a sala do usuário; o teste conferiu a gravação na caixa de alertas).

### Ambiente
Um processo Jest travado (de um teste de filas, mais cedo) segurava o motor do Prisma e impedia o `prisma generate`. O usuário
encerrou um dos dois processos; o cliente (`index.js`/`index.d.ts`) foi gerado — só o binário do motor (mesma versão) e a cópia
do `schema.prisma` em `node_modules/.prisma/client` ficaram da geração anterior. PID 8296 ainda ativo no fim da etapa.

### Correção após o teste ponta a ponta: condição de corrida na publicação
O log do news-worker na verificação com processos reais mostrou a manutenção `sweep-orphans` falhando com
`Unique constraint failed on the fields: (event_id)`: a **reconciliação periódica** e o **processamento de uma notícia**
sincronizaram o mesmo evento ao mesmo tempo e os dois tentaram criar o alerta. O `UNIQUE(event_id)` impediu alerta ou outbox
duplicados, mas um job falhou à toa. Correção: `syncPublication` trava a linha do evento (`SELECT … FOR UPDATE`) — a segunda
sincronização espera a primeira e encontra o alerta pronto; a reconciliação também passou a seguir para os demais eventos se um falhar.

Sobre o teste de regressão: a **primeira versão passava mesmo sem a trava** — o pool do Prisma abre conexões sob demanda
(medido: a segunda transação só começou 4,1 s depois, quando a primeira já tinha terminado), então a corrida nunca acontecia.
Versão final: aquece o pool, segura a transação A aberta, confere que B começou antes da liberação; **sem a trava reproduz o
mesmo erro do teste real; com a trava passa (3/3)**. news-worker integração **61/61**.

## Execuções — 24/11/2026 (7ª parte: Etapa 8, rotas públicas da API)

Antes da camada no mapa, a API ganhou a leitura pública dos alertas (`apps/api/src/news/news-public.*`, Swagger `news`,
qualquer usuário autenticado):

| Rota | Uso |
|---|---|
| `GET /news/events` | Mapa e tela de notícias. `scope=active` (padrão): alerta `ACTIVE`, evento publicado **e `expires_at` no futuro** (se o news-worker parar, um alerta vencido não continua parecendo ativo); `scope=all`: também encerrados e expirados. **Retirado nunca é listado.** Filtros: `lat/lng/radius`, `severity`, `level`, `cityIbge`, `source`, `periodHours`; ordenação por distância ou recência; paginação. |
| `GET /news/events/:id` | Detalhes com todas as fontes (mais recente primeiro, com `independent`). Abre também alerta **retirado**, com o motivo — é o destino do aviso de correção. Evento nunca publicado → 404. |
| `GET /news/regions/:id/boundary` | Contorno IBGE simplificado (~50 m, sempre `MultiPolygon`) para desenhar o alerta regional; `Cache-Control: private, max-age=86400`. São Paulo: 15 KB (original 23 KB); Osasco: 2,4 KB. |

- Área de um alerta = ponto (precisão ≤ rua) ou contorno da região; distrito sem contorno usa o da cidade — **o mesmo critério
  do worker de notificações**, então quem recebeu o push vê o alerta no raio do mapa. Alerta sem área conhecida não entra em
  busca por raio. Para o rótulo do alerta regional vai `center` (`ST_PointOnSurface`, sempre dentro do contorno).
- Gravidade exibida = `published_severity` do alerta (o que foi publicado), não a estimativa corrente do evento.
- Nada da moderação sai pela rota pública (nota do moderador, motivos da decisão, confiança interna, quem moderou); só
  `reviewedByModerator`. Links das fontes passam por `safeUrl` (só http/https), além do CHECK do banco.

### Testes
- API unitários **43/43** (+2: `safeUrl`, `pickHeadline`); e2e **124/124** (+11 em `test/news-public.e2e-spec.ts`: 401 sem token,
  alerta regional com contorno/centro/fonte principal/consequência, raio cruzando o contorno, ponto de rua com distância e
  ordenação, distrito herdando o contorno da cidade, região sem contorno fora da busca por raio, ativo × histórico × retirado ×
  não publicado × vencido sem manutenção, filtros, validação 400, detalhes com fontes, retirado com motivo, GeoJSON + cache).
- Na primeira execução o teste do contorno falhou: a simplificação devolvia `Polygon` para cidade de uma parte só. Corrigido com
  `ST_Multi` (o app recebe sempre o mesmo tipo).

**Não verificado:** consulta com dados reais — o banco de desenvolvimento ainda não tem nenhum `news_alerts` (os eventos coletados
lá são anteriores à Etapa 10). Falta a parte do app (camada no mapa).

## Execuções — 24/11/2026 (8ª parte: Etapa 8, camada no mapa do app)

- `lib/domain/news.dart` (modelos tolerantes: nível/status/gravidade desconhecidos caem no caso conservador; contorno
  GeoJSON `[lng, lat]`), `lib/data/news_repository.dart`, `lib/features/news/` (`news_state.dart`, `news_widgets.dart`,
  `news_detail_page.dart`), rota `/news/:id`.
- Mapa: marcador de notícia = quadrado com jornal (oficial = prédio público), diferente da bolha redonda dos relatos;
  alerta regional = contorno IBGE translúcido na cor da gravidade (cinza tracejado sem gravidade) + rótulo no centro para
  tocar; chip "Notícias" liga/desliga a camada; mesmo raio, gravidade e período dos filtros do mapa. Resumo ao tocar
  conforme o wireframe 7.9 (origem sempre dita: "Notícia ainda não confirmada. Não é comunicado oficial." etc.) com
  "Ver notícia original" (só http/https, navegador externo) e "Detalhes".
- Detalhes: situação (retirado com motivo / encerrado / sem atualizações — "isso não confirma que a via esteja liberada"),
  local e abrangência, todas as fontes com aviso de republicação.
- Tempo real: `news.alert.*` recarrega a camada e o detalhe aberto. Central de Alertas e **toque no push** abrem `/news/:id`
  (`pushRoute`: só monta rota com UUID válido). Legenda explica os formatos de marcador.
- **Defeito encontrado pelos testes (também existia no resumo de ocorrências):** ao fechar o resumo, o cartão que saía
  na animação ficava sem largura (`Positioned` sem `left`) → erro de layout. Corrigido.

### Testes
- `flutter analyze` sem problemas; `flutter test` **78/78** (+11 em `test/news_test.dart`: modelos, contorno, valores
  desconhecidos, marcadores + área tracejada, resumo → detalhes, chip, fechar resumo, retirado com motivo; +2 de `pushRoute`).
- API real (processo `node dist/main.js` apontando para o banco de **testes**, com 2 alertas marcados "[TESTE emulador]"):
  `GET /news/events` devolveu o alerta de rua (826 m da Sé) e o regional de São Caetano do Sul (contorno, centro, 7,9 km).
- **Não verificado:** app no aparelho. O emulador chegou a instalar o APK, mas foi encerrado a pedido do usuário (PC
  sobrecarregado); o teste fica no celular.

### No celular real (Redmi 25062RN2DL, Android 16, USB + `adb reverse`) — API e workers no banco de TESTES
- Camada no mapa conferida pelo usuário com 2 alertas "[TESTE emulador]" (rua perto da Sé; área de São Caetano do Sul).
- **Push: pendência da Fase 4 resolvida.** O logcat mostrava `register()` falhando com
  `IllegalStateException: API disabled … firebase_messaging_installation_id_enabled`: o envio por FID do
  `firebase_messaging` 17 vem desligado. Com a `meta-data` no `AndroidManifest.xml`, o aparelho foi cadastrado
  (`[push] aparelho cadastrado na API`, linha em `device_tokens`).
- Cadeia real: moderador aprovou pela API um evento "[TESTE celular]" de gravidade alta → news-worker recalculou → alerta
  `VERIFIED` → worker de notificações. A conta do celular **não** recebeu: o usuário tinha acabado de mudar a gravidade
  mínima para Crítica no app (filtro correto). O moderador elevou a gravidade para Crítica (a 1ª tentativa recebeu 409 do
  controle otimista, porque o recálculo tinha mudado a versão) → `NEWS_ALERT` "Alerta crítico de alagamento — São Paulo",
  `push_status = SENT` cerca de 1 s depois. **Notificação recebida no celular** e o toque abriu os detalhes (confirmado pelo usuário).
- Observação: ao subir no banco de testes, a reconciliação do news-worker publicou eventos deixados pelas suítes e o
  worker criou notificações para contas de teste (sem aparelho → ficam `PENDING`). Para demos, usar banco limpo.

## Execuções — 24/11/2026 (9ª parte: aviso imediato à moderação)

Decisão do usuário: **manter o moderador** nos dois casos de risco (confiança baixa; push crítico de fonte única) e
reduzir a demora avisando a equipe na hora. Nos dados reais do banco de dev, 5 de 6 eventos foram publicados sem
moderador; 1 de confiança baixa expirou sem ninguém olhar e 1 crítico de fonte única ficou no mapa sem push.

### Desenho
- news-worker (`recompute`): quando o evento **passa a ser** urgente, grava `news.review.urgent` no outbox na mesma
  transação. Recalcular de novo ou a decisão do moderador não repetem o aviso.
- **Novo risco encontrado e tratado:** todo evento do outbox ia para todos os sockets e para o `GET /sync`; o aviso traz
  título de notícia **ainda não publicada**. Agora há eventos "só equipe" (`isStaffOnlyEvent`, `news.review.*`): o gateway
  emite só para as salas `role:MODERATOR`/`role:ADMIN`; o `/sync` os omite para cidadãos, e o cursor deles avança
  sobre esses eventos (o app já trata lacuna de sequência com uma ressincronização).
- Worker de notificações (`processNewsReview`): notifica MODERATOR/ADMIN ativos, sem filtro de área; a notificação vai para a caixa de alertas e o tempo real
  sempre; push só para quem não desligou os alertas (os demais ficam `SKIPPED`). Tipo `NEWS_REVIEW_URGENT` (migration
  `20261124200000_news_review_notifications`, aplicada em dev e teste; drift sem diferenças). Texto diz o que o público
  vê agora ("já no mapa, sem push" / "fora do app até a decisão").
- Painel: `useRealtime` passou a entender eventos de notícia (antes invalidava `['occurrence', undefined]`) e mostra o
  aviso fixo "Revisão urgente" com **Revisar** (abre o evento) e **Dispensar**.
- App: notificação `NEWS_REVIEW_URGENT` na central (ícone de martelo); tocar avisa que a revisão é no painel; o push
  abre a central de Alertas (`pushRoute`), nunca `/news/:id` de algo não publicado.

### Testes
- news-worker: integração **62/62** (+1: aviso uma vez só na transição; recálculo e aprovação não repetem; alto de fonte
  única não avisa), unitários 159/159.
- Worker de notificações: unitários **19/19** (+2), integração **17/17** (+1: só equipe ativa, cidadão com área cobrindo a
  cidade não recebe, suspenso não recebe, push `SKIPPED` com alertas desligados, reentrega sem duplicar, `type` no push).
  O teste de mensagens achou um defeito: com título longo, o corte em 500 caracteres eliminava a frase "o que o público
  vê"; agora corta o título.
- API: unitários 43/43; e2e **125/125** (+1: moderador recebe pelo socket; cidadão não recebe nem pelo socket nem pelo
  `/sync`, e o cursor dele passa do evento). **Conferido que o teste falha sem o filtro** (cidadão recebeu o evento).
- Painel: Vitest **21/21** (+3), build ok. App: `flutter analyze` limpo, `flutter test` **79/79** (+1).
- Limpeza: o e2e `news-public` deixava regiões fictícias no banco de testes e quebrava a contagem do gazetteer do
  news-worker (16 cidades / 96 distritos); agora apaga o que cria.

### Com processos reais (API + news-worker + worker de notificações no banco de TESTES, painel e celular)
Conta do celular promovida a MODERATOR **só no banco de testes**; matérias "[TESTE celular]" de fonte única descrevendo
pessoas ilhadas e resgates, passando pela análise real do news-worker.

| Hora | Passo | Resultado |
|---|---|---|
| 20:27 | Matéria (Osasco) analisada ao iniciar o news-worker | N-897 crítico, `PUBLISHED_PRELIMINARY`, urgente, **sem push a cidadãos**; push "Revisão urgente … Osasco" `SENT` e **recebido no celular** (toque abre a central; item com martelo) |
| 20:34:19 | 2ª matéria (Guarulhos) devolvida à fila (`reprocess-failed`) | N-898 em ~10 s; faixa **"Revisão urgente" apareceu no painel sem recarregar**; push recebido no celular |
| 20:35:41 | Moderador clicou Revisar → Validar no painel | auditoria `news_event.approved`; alerta `VERIFIED`, urgência retirada |
| 20:35:42 | — | push de cidadão "Alerta crítico de alagamento — Guarulhos" `SENT` (0,6 s) e recebido: o crítico só sai depois da validação |

N-897, não revisado, continua preliminar e sem push — como deve. Foram 63 avisos de equipe por evento: o banco de testes
acumula contas MODERATOR/ADMIN das suítes, que sem aparelho ficam `SKIPPED`.

## Execuções — 24/11/2026 (10ª parte: Etapa 9, tela "Notícias e monitoramento")

- API: `GET /news/filters` (cidades monitoradas do gazetteer + fontes **ligadas**; só nome/código, nada da operação).
- App: rota `/news` (`news_monitor_page.dart`, `news_feed_state.dart`), aberta pelo cartão **"Notícias e monitoramento"** da
  central de Alertas ("N alertas em vigor nas cidades monitoradas"; sem 5ª aba). Lista o histórico recente
  (`scope=all`: em vigor + encerrados + sem atualizações; retirados nunca), mais novos primeiro, últimos 3 dias por padrão.
- Filtros (pílulas com seta, como no mapa): Cidade, Período (24 h / 3 dias / 7 dias), Gravidade, Fonte, Verificação;
  "Limpar" quando há filtro. Cartão do wireframe: faixa na cor da gravidade (cinza se encerrado), gravidade, "● Recente"
  (evidência ≤ 2 h) ou a situação, verificação, título, "fonte · data · cidade", resumo do feed, nº de fontes e
  "Ver original" (desabilitado sem link). Toque → detalhes.
- Estados: carregando (esqueleto), vazio (regiões monitoradas / com filtro → "Limpar filtros"), falha ("Tentar
  novamente"), **sem internet → última consulta salva no aparelho** com aviso e data; dados salvos só valem para os
  mesmos filtros (outra consulta offline mostra "Sem conexão", nunca a lista errada) e não paginam.
- **Achado:** o Riverpod 3 repete automaticamente um provider que falhou; a tela de erro era trocada por "carregando"
  e a nova tentativa consumia a resposta seguinte. A lista agora não repete sozinha (`retry: null`): o erro aparece na
  hora com "Tentar novamente".
- Tempo real: `news.alert.*` também recarrega a lista e o contador da central.

### Testes
- API e2e `news-public` **12/12** (+1: filtros só com cidades monitoradas e fontes ligadas, sem dados da operação, 401).
- App: `flutter analyze` limpo; `flutter test` **87/87** (+7 em `test/news_monitor_test.dart`: carregando, vazio com e sem
  filtro, falha + tentar de novo, sem internet com dados salvos e com outra consulta sem dados, cartão completo e
  encerrado, filtros múltiplos indo para a API + abrir detalhes, carregar mais; +1 em `alerts_test.dart`: entrada com contador).

### No celular (Redmi, Android 16), API real no banco de TESTES
Conferido pelo usuário: cartão da central com "2 alertas em vigor"; lista com os 2 alertas de TESTE (Guarulhos verificado,
Osasco preliminar); filtros Cidade, Verificação e Fonte; "Limpar"; abrir detalhes. **Modo avião:** puxar para atualizar
manteve a lista com o aviso "Sem conexão. Mostrando as notícias salvas em …"; trocar o período offline mostrou "Sem
conexão" (sem lista errada); ao voltar, "Tentar novamente" recarregou. O logcat confirma que a API ficou inacessível
durante o teste (`ApiException(network)` e falha de DNS dos mapas): o aviso veio do cache, não de resposta pelo cabo USB.


## Execuções — 24/11/2026 (11ª parte: Etapa 11 — falhas, precisão e segurança)

### Segurança

| Ameaça | Resultado | Evidência |
|---|---|---|
| **SSRF por IPv4 embutido em IPv6** | **Falha real encontrada e corrigida.** O Node normaliza `http://[::ffff:127.0.0.1]/` para `::ffff:7f00:1`; o filtro (prefixo de texto) achava público e a requisição chegaria ao loopback. Também passavam link-local `fe90–febf::`, `fec0::`, multicast `ff00::/8`, NAT64 `64:ff9b::/96` (ex.: metadados de nuvem), `::a.b.c.d`, 6to4, Teredo, `198.18/15`, redes de documentação | `isPrivateAddress` reescrito com parser IPv6 de verdade (falha fechada para texto que não é IP); +24 casos e teste contra servidor local real (`[::ffff:127.0.0.1]`, `2130706433`, `0x7f.1`, `127.1` → recusados, **0 requisições** chegaram). **Com o filtro antigo, 13 dos testes novos falham** |
| **DNS rebinding** (DNS responde IP público na checagem e interno na conexão) | Brecha fechada: o IP agora é conferido **no momento da conexão** (`lookup` próprio no agente do undici); qualquer endereço interno na resposta recusa (permanente, não é repetido) | `guardedLookup` com resolvedor injetado: público passa; interno, misto e vazio → `EPRIVATE` |
| Esquemas/credenciais/redirecionamento para rede interna, feed gigante, "billion laughs", timeout | Já cobertos nas Etapas 3–4 | `http.spec.ts`, `rss.spec.ts` |
| **"Prompt injection" (texto adversário nas notícias)** — sem modelo de linguagem, o risco é o texto mudar o fluxo | Não muda: instruções ("SYSTEM: ignore as regras…", JSON com `pushAllowed: true`) em notícia sem alagamento → descartada; em notícia real, a gravidade vem só das evidências ("gravidade crítica" escrito no texto não conta) | `adversarial.spec.ts` (18 casos) |
| Fonte comum se passando por oficial ("Defesa Civil confirma…") | "Oficial" depende de **quem publica** (`reliability` da fonte), nunca do texto: agregador/desconhecida → aguarda moderação, urgente, sem push; veículo estabelecido → preliminar sem push | idem |
| Repetição de palavras-chave / alarmismo | Termos graves sem cidade identificável não publicam; "caos/apocalíptico" não contam como gravidade | idem |
| HTML/script/links no feed | Tags e `javascript:` removidos do título/resumo; links `javascript:`, `data:`, `file:`, `ftp:`, com credenciais → recusados | idem |
| Textos patológicos (ReDoS) | 4 padrões de 2–10 mil caracteres analisados em < 250 ms cada (medido: ≤ 5 ms) | idem |
| Texto da fonte no push de cidadão | Nunca entra: título e "consequência" maliciosos não aparecem; só frases fixas + cidade do gazetteer | `news-messages.spec.ts` (+1) |
| XSS no painel | Nenhum `dangerouslySetInnerHTML`/`innerHTML` em `apps/admin/src` (React escapa) | busca no código |
| Admin alterar URL de fonte para alvo interno | A API só permite ligar/desligar (`UpdateNewsSourceDto` tem só `enabled`); URLs vêm do catálogo no código | revisão |

### Precisão com notícias reais (conjunto de teste, separado do corpus simulado)
Retrato de **25/11/2026 00:08 UTC**: **280 itens** de 5 fontes reais (Agência Brasil 10, CNN Brasil 60, Folha Cotidiano 100,
g1 SP 100, Prefeitura de Osasco 10; GDELT fora — 429 para este IP). Rótulos feitos por mim (Claude) lendo título e resumo,
**a conferir pelo grupo** (`apps/news-worker/eval/`). 17 itens sobre alagamento, 8 que deveriam virar alerta (todos do
temporal de 22–23/11 na capital).

| Métrica (antes de qualquer ajuste) | Resultado |
|---|---|
| Precisão do alerta | **88,9 % (8/9)** |
| Recall do alerta | **100 % (8/8)** |
| Push indevido | **0** |
| Filtro do coletor: itens fora do tema descartados | 99,6 % (262/263) |
| Filtro do coletor: recall sobre alagamento | 94,1 % (16/17) — o perdido é prevenção (limpeza de córregos), que não deve virar alerta |

**Único falso alerta:** "Casal morre afogado… em Campo Largo (PR)" — o texto diz "região metropolitana **de Curitiba**" e o
gazetteer lia qualquer "região metropolitana" como Grande SP (publicava preliminar, sem push, urgente). Corrigido
(`regiao metropolitana` só vale sozinha ou "de São Paulo") com teste do caso real e de Recife/Baixada Santista.
Depois do ajuste o mesmo retrato dá 100 %/100 % — **número não independente** (a correção foi feita olhando estes dados);
a próxima medição deve usar um retrato novo. Casos difíceis acertados: "árvore cai em Moema" (o resumo relata ruas
alagadas e carros submersos no mesmo temporal → alerta correto), Mogi das Cruzes (Grande SP mas fora das 16 cidades →
moderação), previsões, "estado de atenção" e notícias de RS/PR/interior/litoral → fora.
Limites: amostra pequena e de um único episódio de chuva; um só rotulador.

### Falhas com processos reais (news-worker no banco de testes)

| Falha | Comportamento | Resultado |
|---|---|---|
| PostgreSQL parado 27 s (`docker stop`) | Processo continua vivo (1 processo); coleta agendada que caiu na janela falhou e ficou registrada (não é repetida pela fila; o recuo é da fonte) | Banco de volta → matéria nova analisada e agrupada (N-918) |
| Redis parado 25 s | Log "Redis indisponível, reconectando" → "Redis reconectado"; processo vivo | Matéria nova processada depois (N-919) |
| Já cobertos antes | fonte fora do ar/backoff, 429 com Retry-After, timeout, feed inválido/HTML, análise falhando N vezes → FAILED → reprocesso, falha temporária, job perdido (processo caiu) → manutenção reenfileira, corrida reconciliação × notícia, Redis fora na API (outbox pendente) | `collector.int-spec`, `queues.int-spec`, `publication.int-spec`, Fase 4 |

Efeito colateral do teste: as fontes fictícias "teste-*" (ligadas para o filtro do app) foram coletadas e o example.com
respondeu 404; desligadas em seguida.

### Testes
news-worker unitários **203/203** (+18 conteúdo adversário, +24 endereços, +2 SSRF/rebinding, +5 região metropolitana),
integração **62/62**; worker de notificações unitários **20/20**.

## Execuções — 24/11/2026 (12ª parte: Etapa 12 — documentação)

- `README.md`: estado da Fase 7 (concluída) e da Fase 4 (push num celular real), seção "Monitoramento de notícias"
  (como rodar, rotas públicas e administrativas, testes e avaliação), links da documentação.
- `docs/architecture/07-news-intelligence.md`: nova seção **7.11 — o que mudou em relação ao plano** (rules-2, sem LLM,
  fontes adotadas, área pelo contorno na consulta em vez de trigger, tipos de evento, agrupamento, moderação com aviso
  urgente, eventos "só equipe", rotas, app, SSRF, avaliação) e a pendência do vínculo automático com relatos.
- `docs/architecture/01-arquitetura.md` (requisitos de SD na Fase 7) e `05-roadmap.md` (Fase 7; o critério da Fase 6
  passou a citar o enunciado oficial — não existe "seção 19").
- `docs/academic/roteiro-demonstracao.md`: bloco de 5–7 min de notícias (passos 14–19), sem inventar notícias:
  sem chuva recente, mostrar histórico, moderação e a avaliação com notícias reais.
- `docs/academic/news-intelligence.md`: material para o trabalho escrito, organizado pelas seções do enunciado
  (objetivo, introdução, fundamentos, plano, projeto, trechos de código, resultados, interdisciplinaridade, bibliografia).
- Scripts na raiz: `news:snapshot`, `news:eval-real`.
- Conferência final: API e2e **126/126** (inclui o teste de `GET /news/filters`).
