# News Intelligence — material para o trabalho escrito da APS

Texto de apoio para o documento acadêmico (Arial 12, espaçamento 1,5), organizado pelas seções do enunciado
(item III.5). Os números vêm de execuções registradas em `docs/testing/fase-7.md`; detalhes técnicos em
`docs/architecture/07-news-intelligence.md`. **Revisar a redação e adaptar à voz do grupo.**

---

## 3. Objetivo e motivação (trecho sobre o módulo)

Além dos relatos dos cidadãos, o AlertaCidade monitora **notícias públicas** sobre alagamentos na Grande São Paulo e
as transforma em alertas georreferenciados **rastreáveis**: cada alerta mostra de onde veio a informação, quantas
fontes independentes a confirmam e se é ou não um comunicado oficial. A motivação é dupla: em temporais, a imprensa e
os órgãos públicos costumam noticiar alagamentos antes que haja relatos suficientes no aplicativo; e, ao mesmo tempo,
notícia não confirmada, antiga ou de outra cidade pode gerar alarme falso. O módulo foi projetado para ampliar a
informação disponível **sem** perder a cautela: gravidade e confiança são medidas separadas, alerta crítico de fonte
única não gera notificação sem corroboração, e uma notícia nunca é apresentada como alerta da Defesa Civil.

## 4. Introdução (trecho)

Sistemas de alerta baseados em notícias precisam resolver três problemas: **coletar** de muitas fontes sem
sobrecarregá-las nem depender delas (fontes saem do ar, limitam requisições, mudam de formato); **interpretar** textos
escritos para pessoas — distinguir uma ocorrência atual de uma previsão, de uma obra de prevenção ou de uma matéria
histórica, e localizar o fato (cidade, distrito, rua); e **decidir** quando publicar e quando notificar, sabendo que o
erro mais caro é o alarme falso. No AlertaCidade esses problemas foram tratados como um sistema distribuído: um
processo independente faz a coleta e a análise, comunica-se com a API por filas e por eventos persistidos, e
qualquer falha (fonte, banco, Redis) é isolada e recuperada sem afetar o registro de ocorrências pelos cidadãos.

## 5. Fundamentos (conceitos usados no módulo)

- **Filas de mensagens (BullMQ sobre Redis):** desacoplam produtores e consumidores; cada etapa (coleta, análise,
  manutenção) tem sua fila, tentativas com espera crescente (*backoff*) e uma área de falhas (*dead-letter*) para
  reprocessamento. O agendamento periódico fica no Redis (*job scheduler*), único mesmo com vários processos.
- **Transactional Outbox:** a decisão de publicar um alerta e o evento que avisa os clientes são gravados na **mesma
  transação** do banco; um publicador entrega o evento depois. Assim, nenhuma notificação sai sem a decisão estar
  persistida, e nenhuma decisão fica sem aviso (entrega "pelo menos uma vez", com idempotência nos consumidores).
- **Concorrência:** agrupamento de notícias sob *advisory lock* do PostgreSQL (duas notícias do mesmo episódio
  processadas em paralelo não criam dois eventos) e trava da linha do evento (`SELECT … FOR UPDATE`) na publicação —
  necessária depois que o teste com processos reais mostrou uma corrida entre a reconciliação periódica e o
  processamento de uma notícia.
- **Dados geográficos (PostGIS):** o gazetteer usa os **contornos oficiais dos municípios (IBGE)**; um alerta de
  cidade inteira é a área do município, e os destinatários são as pessoas cuja área de interesse cruza essa área
  (`ST_DWithin`) — o mesmo critério usado no mapa.
- **Classificação por regras determinísticas:** relevância, temporalidade (atual, previsão, prevenção, histórico,
  resolvido), gravidade por evidências de impacto (pessoas ilhadas, via interditada…, nunca por adjetivos) e
  confiança pela qualidade das fontes (independência, fonte oficial, ambiguidade do local). Nenhum modelo de
  linguagem é usado (decisão do grupo: sem custo) — o que torna cada decisão explicável e testável.
- **Segurança de coletas (SSRF):** o servidor busca URLs externas; é preciso impedir que uma URL ou um
  redirecionamento o façam acessar a rede interna (inclusive por IPv4 embutido em IPv6 e por *DNS rebinding*).
- **Tempo real com audiência:** eventos públicos vão a todos os clientes autenticados; eventos de moderação só às
  salas de moderadores e administradores (Socket.IO com Redis), e a ressincronização (`/sync`) respeita a mesma regra.

## 6. Plano de desenvolvimento (elementos e ferramentas)

| Elemento | Ferramenta / tecnologia |
|---|---|
| Processo de coleta e análise | Node.js 22 + TypeScript 5.9 (`apps/news-worker`) |
| Filas e agendamento | BullMQ 5 sobre Redis 7.4 |
| Persistência e geografia | PostgreSQL 17 + PostGIS 3.5, Prisma 6.19 (migrations com CHECKs e triggers) |
| Fontes | RSS 2.0/Atom (Agência Brasil, g1 SP, Folha Cotidiano, CNN Brasil, Prefeitura de Osasco) e GDELT DOC 2.0; termos de uso conferidos em 24/11/2026 |
| Gazetteer | Malha municipal do IBGE (16 cidades monitoradas da Grande SP) e lista de distritos |
| API e tempo real | NestJS 11, Socket.IO com adaptador Redis, outbox transacional |
| Notificações | Worker de notificações (BullMQ) + Firebase Cloud Messaging |
| Painel de moderação | React + Vite |
| Aplicativo | Flutter 3.50 (flutter_map, Riverpod) |
| Testes | Jest (unitários e integração com PostGIS e Redis reais), Vitest, flutter_test; ferramentas de avaliação com notícias reais |

Execução em 12 etapas, na ordem 1 → 5 → 2 → 3 → 6 → 4 → 7 → 10 → 8 → 9 → 11 → 12: primeiro as regras (testáveis sem
rede), depois banco, conectores, gazetteer e agrupamento, filas, painel, publicação e notificações, telas do app,
testes de falha/precisão/segurança e documentação.

## 7. Projeto (estrutura e módulos)

```
fonte RSS/GDELT ──► fila news-collect ──► coletor (http seguro, parser, deduplicação por URL canônica)
                                               │ artigos sobre alagamento
                                               ▼
                    fila news-analyze ──► regras → gazetteer → agrupamento em evento → política de publicação
                                               │ mesma transação: news_alerts + decisão de push + outbox
                                               ▼
        publicador do outbox (API) ──► Socket.IO (app e painel)   ──► worker de notificações → FCM
                                   └─► fila occurrence-events ───┘    (destinatários por área IBGE)
        fila news-maintenance: expiração de alertas, reconciliação, recálculo após moderação
```

| Módulo (`apps/news-worker/src`) | Responsabilidade |
|---|---|
| `sources/` | Conectores RSS e GDELT, cliente HTTP com limite de tempo/tamanho, `Retry-After`, proteção SSRF, catálogo |
| `collector/` | Coleta por fonte, recuo progressivo em falhas, gravação idempotente |
| `analysis/` | Regras de relevância, temporalidade, gravidade (com trecho que justifica) e confiança |
| `geo/` | Gazetteer IBGE (cidades, distritos, homônimos de outros estados) e contornos |
| `dedup/`, `events/` | Independência das fontes, agrupamento em eventos, publicação e reconciliação |
| `policy/` | Política de publicação e de notificação (versionada: `rules-2`) |
| `evaluation/` | Corpus simulado e avaliação com notícias reais |

Na API: `src/news` (rotas públicas e administrativas). No app: `lib/features/news` (camada do mapa, detalhes, tela
de notícias). No painel: páginas `NewsPage` e `NewsEventDetailPage`.

## 8. Linhas de código — sugestões de trechos (limite de 10 páginas)

1. `apps/news-worker/src/policy/publication.ts` — política de publicação (crítico só com corroboração).
2. `apps/news-worker/src/events/publication.ts` — `syncPublication`: alerta + decisão de push + outbox na mesma transação, com `FOR UPDATE`.
3. `apps/news-worker/src/sources/http.ts` — `isPrivateAddress` e `guardedLookup` (SSRF e DNS rebinding).
4. `apps/api/src/realtime/realtime.gateway.ts` e `apps/api/src/events/sync.controller.ts` — eventos "só equipe".
5. `apps/notification-worker/src/notification-worker.ts` — destinatários por área (`newsAreaRecipients`).

## 9. Resultados e verificação

| Verificação | Resultado |
|---|---|
| Testes automatizados do módulo | news-worker 203 unitários + 62 de integração (PostGIS e Redis reais); API e2e 126; worker de notificações 20 + 17; painel 21; app 87 |
| Cadeia completa com processos reais | notícia → alerta → push recebido no celular cerca de 1 s após a decisão; moderador valida no painel → push crítico liberado 0,6 s depois |
| Precisão com **280 notícias reais** (5 fontes, 25/11/2026; rótulos feitos pelo Claude, **a conferir pelo grupo**) | precisão 88,9 %, recall 100 %, **nenhum push indevido**; o único falso alerta (cidade do Paraná lida como Grande SP) foi corrigido |
| Falhas | PostgreSQL e Redis derrubados com o processo rodando: o news-worker reconectou e seguiu processando; fonte fora do ar, 429 e timeout entram em recuo por fonte |
| Segurança | duas falhas de SSRF encontradas e corrigidas (IPv4 em IPv6; DNS rebinding); textos adversários (instruções, falsa fonte oficial, HTML, ReDoS) não mudam decisões |

**Limitações:** a avaliação real tem amostra pequena, de um único episódio de chuva, e um só rotulador; o vínculo
automático entre notícia e relato de cidadão não foi implementado; o GDELT limita requisições para o IP usado.

## Interdisciplinaridade (para a dissertação)

O módulo combinou **Sistemas Distribuídos** (filas, outbox, idempotência, concorrência, tolerância a falhas, tempo
real), **Banco de Dados** (transações, travas, restrições CHECK, consultas geográficas), **Processamento de Linguagem
Natural** em versão determinística (normalização, padrões, negação), **Geoprocessamento** (malhas do IBGE, PostGIS),
**Segurança da Informação** (SSRF, conteúdo não confiável, controle de acesso por perfil), **Engenharia de Software**
(testes automatizados, avaliação com conjunto de teste separado) e **Ética/Comunicação** (não apresentar notícia como
comunicado oficial, explicar a origem de cada alerta, evitar alarme falso).

## Bibliografia sugerida (conferir formatação ABNT)

- COULOURIS, G.; DOLLIMORE, J.; KINDBERG, T.; BLAIR, G. *Sistemas Distribuídos: conceitos e projeto*. 5. ed. Porto Alegre: Bookman, 2013.
- TANENBAUM, A. S.; VAN STEEN, M. *Distributed Systems*. 3. ed. 2017.
- KLEPPMANN, M. *Designing Data-Intensive Applications*. Sebastopol: O'Reilly, 2017.
- RICHARDSON, C. *Microservices Patterns*. Shelter Island: Manning, 2018 (padrão Transactional Outbox).
- OWASP. *Server-Side Request Forgery Prevention Cheat Sheet*. OWASP Cheat Sheet Series.
- IETF. RFC 6890 — *Special-Purpose IP Address Registries*; RFC 4291 — *IP Version 6 Addressing Architecture*.
- IBGE. *Malha Municipal* (malhas territoriais). Instituto Brasileiro de Geografia e Estatística.
- THE GDELT PROJECT. *GDELT DOC 2.0 API*.
- RSS ADVISORY BOARD. *RSS 2.0 Specification*.
- Documentação oficial: PostGIS, PostgreSQL, BullMQ, NestJS, Socket.IO, Flutter.
