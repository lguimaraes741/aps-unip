# Relatório — Fase 6 (Finalização) — em andamento

Data: 23/11/2026. Critérios de aceitação tirados do **enunciado oficial da APS** (`docs/academic/enunciado-aps.md`),
que substitui as referências antigas a "seções 15 e 19 da especificação".

## Critérios do enunciado

| Critério | Situação | Evidência |
|---|---|---|
| Aplicação baseada em sistemas distribuídos, para dispositivo móvel, sobre informação ambiental urbana (alagamentos) | ✅ | Fases 1–5; requisitos de SD abaixo |
| Demonstrável em dispositivo portátil ou simulador | ✅ | App validado no emulador (fase-3.md) e com a API real por testes ao vivo (fase-4.md, fase-5.md) |
| Refinamento, tratamento de erros, funções extras e relatórios adicionais | ✅ | Testes de falha e revisão de segurança abaixo; extras: painel web, relatórios + CSV, auditoria, tempo real, push |
| Documento: estrutura 1–11, Arial 12, espaçamento 1,5, A4, margens 2,5 cm, limites de páginas | ⏳ | Aguarda nomes/RA do grupo, curso/campus e o modelo da ficha de APS |
| Dissertação: elementos usados, efeito na formação, interdisciplinaridade | ⏳ | Dentro do documento |
| Apresentação do programa em funcionamento | ✅ roteiro | `docs/academic/roteiro-demonstracao.md` |

## Testes de falha (processos reais)

| Falha | Comportamento observado | Onde |
|---|---|---|
| **PostgreSQL parado** (novo) | Health 503 `{database: down}`; login, listagem e `/sync` → 503 "Banco de dados temporariamente indisponível. Tente novamente." **sem detalhes internos**; publicador do outbox registra a falha e espera com backoff; API e worker continuam no ar. Banco religado → health 200 em ~1 s **sem reiniciar nada**; registro aceito, evento publicado na 1ª tentativa, log "Publicação do outbox normalizada" | esta fase |
| Redis parado | Health `degraded` (200); REST continua; evento fica pendente no banco com o erro; volta → publicado | fase-4.md |
| Worker parado | Evento publicado e guardado na fila do Redis; ao religar, processado em 80 ms | fase-4.md |
| Redis **e** API parados com evento pendente | Ao religar, o evento é publicado e o cliente offline recupera exatamente os eventos perdidos por `GET /sync` | fase-4.md |
| Cliente perde a conexão | App reconecta e recupera pelo `/sync` (teste ao vivo com o código real do app) | fase-4.md |
| Token expira durante o uso | App e painel renovam uma única vez (fila/promessa compartilhada) e reconectam o socket | fase-4.md, fase-5.md |
| Dois moderadores ao mesmo tempo | Um vence, o outro recebe 409 e a tela recarrega | fase-5.md |
| Rajadas concorrentes (15–20 requisições) | Contadores exatos, sem duplicidade; sem 500 após ajuste do `maxWait` | fase-2.md, fase-4.md |
| Push para aparelho inexistente | FCM responde `installation-id-not-registered`; worker marca FAILED e remove o identificador | fase-4.md |
| App sem rede ao enviar ocorrência | Rascunho salvo no aparelho; reenvio não duplica (`clientRequestId`); fotos retomam | fase-3.md |

## Revisão de segurança

| Item | Situação |
|---|---|
| SQL injection | ✅ Nenhum `$queryRawUnsafe`/`$executeRawUnsafe`; consultas cruas usam *tagged templates* parametrizados |
| Senhas | ✅ Argon2id; política de força; mensagem idêntica para e-mail inexistente e senha errada |
| Sessões | ✅ Access token de 15 min; refresh token rotativo com detecção de reuso (hash no banco); logout e troca de senha revogam; suspensão revoga; socket desconecta quando o token expira |
| Força bruta | ✅ Limite global + limite específico em `/auth/*` (429 com `Retry-After`); recuperação de senha bloqueia após 5 tentativas; código de uso único |
| Autorização | ✅ Guard global (tudo exige JWT salvo `@Public`); perfis por rota (testes 401/403 para cidadão e moderador); dono verificado em remoção, fotos, alertas e aparelhos |
| Entrada | ✅ `whitelist` + `forbidNonWhitelisted` (campos extras recusados, ex.: `role` no cadastro); limites de paginação, período e exportação |
| Upload | ✅ Tipo pelo conteúdo (assinatura), 10 MB, reprocessamento com remoção de EXIF/GPS, nome gerado pelo servidor |
| Exportação | ✅ CSV contra injeção de fórmulas (sem quebrar números negativos) |
| Cabeçalhos/CORS | ✅ Helmet; CORS por lista, `*` proibido em produção |
| **Swagger em produção** | 🔧 **Corrigido:** estava sempre público (expunha o mapa da API, inclusive rotas administrativas). Agora `SWAGGER_ENABLED`: ligado fora de produção, desligado em produção salvo pedido explícito (teste unitário) |
| **Painel sem CSP** | 🔧 **Corrigido:** o refresh token fica em `sessionStorage`; o build de produção agora inclui Content-Security-Policy (`script-src 'self'`, conexões só com a API e o OSM). Conferido no HTML gerado; **falta conferir no navegador** que o painel de produção abre sem violações no console |
| Segredos | ✅ `.env`, `google-services.json` e chave do Firebase fora do Git; chave do worker fora do repositório; JWT com segredo ≥ 32 caracteres e recusa do valor de exemplo em produção |
| Erros | ✅ Respostas genéricas em português; detalhes só no log do servidor (confirmado com o banco fora) |
| LGPD | ✅ Exportação e exclusão (anonimização) da conta; EXIF removido; alerta guarda a distância, não a posição; área de interesse escolhida (sem rastreamento); e-mail do autor só para ADMIN; auditoria sem campos sensíveis |
| App Android | ✅ HTTP sem TLS só no build de depuração; refresh token no armazenamento seguro (Keystore) |
| Dependências | ✅ `npm audit --omit=dev`: só a CLI do Prisma (`effect`, `deepmerge-ts` via `@prisma/config`) — ferramenta de desenvolvimento, não roda em produção |

Pontos conhecidos (documentados, não corrigidos): e-mail de recuperação sem provedor real (código no log em dev, R15); IP da auditoria é o do proxy se houver um na frente (configurar `trust proxy` na implantação); assinatura do APK de release ainda com a chave de debug.

## Requisitos de Sistemas Distribuídos (conferência)
A tabela em `docs/architecture/01-arquitetura.md` (seção 1.2) foi conferida contra o código:
- **Item 7 corrigido no texto:** dizia "app com fila offline"; o que existe é rascunho persistente com reenvio idempotente (sem envio automático em segundo plano).
- **Item 5 atualizado:** cita o cursor de entrega `published_sequence` (Fase 4) em vez do `sequence` de inserção.
Demais itens conferem com a implementação e têm testes (ver fases 1–5).

## Funcionalidade ausente encontrada ao escrever o roteiro
O roteiro de demonstração citava "exportar dados (LGPD)" no app, mas o app não tinha esse botão (só a API: `GET /users/me/export`, com teste e2e desde a Fase 2). **Implementado:** Perfil → Privacidade → "Exportar meus dados" gera `alertacidade-meus-dados-AAAA-MM-DD.json` e abre o compartilhamento do Android. `flutter analyze` sem problemas e `flutter test` 56/56; a tela de compartilhamento em si só pode ser vista num aparelho (conferência visual pendente).

## Regressão após as mudanças desta fase
- API: unitários **36/36**, integração **99/99**. Worker: **10/10**. Painel: **11/11**, build com CSP. App: **56/56** + 2 testes ao vivo (pulados sem `LIVE_TESTS`).

## Pendente
- Documento acadêmico (.docx): aguarda dados do grupo e o modelo da ficha.
- ~~Exportação de dados num aparelho~~ — feita em 24/11 no celular (Perfil → Privacidade → Exportar meus dados), confirmada pelo usuário.
- ~~Conferência visual do painel de produção (CSP) no navegador~~ — feita em 24/11 pelo usuário (build de produção na porta 5173: login, navegação, mapa e tempo real sem erro de CSP no console). **Achado:** servido com `vite preview` (porta padrão
  4173), o painel dava "erro na comunicação com o servidor" — a API só autoriza a origem `http://localhost:5173`
  (`CORS_ORIGINS`), como deve ser. O script `preview` do painel passou a usar a porta 5173 e há o atalho
  `npm run admin:preview` (build de produção + servidor). Em produção real, `CORS_ORIGINS` deve listar o domínio do painel.
- Herdados da Fase 4: cenário com 2 aparelhos (push num aparelho real feito em 24/11, inclusive com o app fechado).
