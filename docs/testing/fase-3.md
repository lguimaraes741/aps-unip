# Relatório de testes — Fase 3 (Mobile) — em andamento

Ambiente: Windows 11, Flutter 3.50.1 (stable), Dart 3.14, Android SDK 36 / plataforma 37, NDK 28.2,
emulador `Medium_Phone_API_37.0` (aceleração WHPX). Data: 23/11/2026.

## Executados

### `flutter analyze` — ✅ sem problemas

### `flutter test` — ✅ 30/30 aprovados

| Arquivo | Casos |
|---|---|
| `test/api_client_test.dart` | 5 requisições simultâneas recebendo 401 → **uma única** renovação de token e todas repetidas com sucesso; falha na renovação encerra a sessão; rotas `/auth/*` não recebem token nem tentam renovar; erros por campo preservados |
| `test/models_test.dart` | conversão das respostas da API (datas em UTC, opcionais, enums desconhecidos → erro); detalhes, linha do tempo e regra de confirmação; paginação; filtros no formato da API; rascunho preserva a chave de idempotência e as fotos pendentes |
| `test/core_test.dart` | tempo relativo e distância em pt-BR; `ApiException` (validação, 429, 503, sem conexão); validações iguais às da API; regras de redirecionamento por sessão |
| `test/widgets_test.dart` | badges com texto e ícone; `OccurrenceCard` com gravidade, status, distância e selo de demonstração; botão em carregamento não reenvia; `ErrorState` offline com nova tentativa; `LoginPage` valida antes de chamar a API e exibe o erro retornado |

### Build e execução no emulador
- `flutter build apk --debug`: ✅ `build/app/outputs/flutter-apk/app-debug.apk` (após instalar o NDK 28.2, exigido pelos plugins nativos).
- Instalado e aberto no emulador: ✅ boas-vindas e login renderizados com a fonte Inter e a paleta do design system.
- Login com a API fora do ar: ✅ botão entra em carregamento (sem envio duplicado) e depois exibe "O servidor demorou para responder. Tente novamente." — o app não trava.

## Validação no emulador com a API real — 23/11/2026

Ambiente: API local (`npm run api:dev`) com PostgreSQL/PostGIS no Docker, banco populado pelo seed; emulador `Medium_Phone_API_37.0` com GPS simulado em -23.5505, -46.6333 (Praça da Sé). Interação feita com `adb` (toques, digitação e capturas de tela), conferindo os dados direto no banco.

| Fluxo | Resultado |
|---|---|
| Health da API | ✅ `database: up`, `postgis: 3.5.2` |
| Login (`cidada.a@alertacidade.demo`) | ✅ entra e vai para o mapa; validação local de e-mail exibida antes de chamar a API |
| Mapa | ✅ tiles do OpenStreetMap, círculo de 5 km, 3 marcadores do seed dentro do raio, lista "Ocorrências próximas" com distância (560 m) |
| Detalhes | ✅ gravidade, status, selo **Demonstração**, aviso "não é comunicado oficial", minimapa, histórico |
| Confirmar → contestar → confirmar | ✅ tela e banco coerentes (`confirm_count`/`contest_count` e uma única linha em `confirmations`) |
| Registrar ocorrência com GPS e foto da galeria | ✅ coordenadas exatas do GPS; no banco: `MODERATE`/`PENDING`, `is_demo=false`, coluna `location` preenchida pelo trigger, 1 foto, eventos `occurrence.created` e `occurrence.updated` no outbox |
| Meus registros | ✅ totais iguais aos do banco ("Pendentes" soma `PENDING` + `UNDER_REVIEW`, igual à API) |
| Perfil e preferências de notificação | ✅ gravidade mínima e área de interesse salvas; coluna `location` preenchida pelo trigger |
| Remover ocorrência | ✅ soft delete no banco e evento no outbox (com o defeito abaixo, já corrigido) |
| Sessão persistente | ✅ ao reabrir o app, o usuário continua logado |

### Defeitos encontrados e corrigidos
1. **Remoção não atualizava "Meus registros":** depois de remover, a lista e os totais continuavam mostrando o item até puxar para atualizar. Causa: `occurrence_detail_page.dart` só invalidava `nearbyOccurrencesProvider`. Correção: invalidar também `myReportsProvider` e `mySummaryProvider`. ✅ Revalidado no emulador: 4 → 3 imediatamente.
2. **Botão "Registrar ocorrência" cobria o título da lista e o primeiro card:** o botão tinha posição fixa e a lista ocupa 28% da altura. Correção: o botão acompanha o topo da lista arrastável e some quando ela está quase em tela cheia (`map_page.dart`). ✅ Revalidado.
3. **Bairro repetido** ("Praça da Bandeira, Centro · Centro"): nova função `Formatters.place`, que não repete o bairro já presente no endereço, usada nos detalhes e no compartilhamento. Coberta por teste. ✅ Revalidado.
4. **Teclado continuava aberto depois do login:** os formulários de autenticação agora tiram o foco do campo ao enviar.

Após as correções: `flutter analyze` sem problemas e `flutter test` ✅ 31/31 (+1 teste do formatador).

### Observações
- Os dois registros de teste criados (`Teste de validacao no emulador` e `Teste de remocao no emulador`) foram removidos pelo próprio app (soft delete). As preferências da conta de demonstração foram restauradas.
- O `adb shell input text` perde caracteres se o teclado ainda estiver abrindo, então é preciso esperar ~2 s depois de tocar no campo. Isso é limitação da automação, não do app.
- O item 4 (teclado após o login) foi corrigido no código, mas não revalidado no emulador, porque a sessão persistente pulou a tela de login.

## Itens finais da Fase 3 — 23/11/2026

| Item | Resultado |
|---|---|
| Teclado depois do login | ✅ sair da conta → entrar com o teclado aberto (`mInputShown=true`) → depois de "Entrar", `mInputShown=false` e o mapa abre sem teclado. O logout volta para a tela de boas-vindas. |
| Recuperação de senha (`cidadao.b`) | ✅ o código de 6 dígitos aparece no log da API (dev); código errado → "Código inválido ou expirado"; código certo → senha redefinida e volta para o login; login com a senha nova ✅. Pela API: reutilizar o código → 400; senha antiga → 401. A senha original foi restaurada com `npm run db:seed` (login 200). |
| Tempo de abertura | Debug, abertura a frio medida com `am start -W` (3 vezes): **5,9 s / 3,6 s / 3,8 s**. Os ~24 s anotados antes valiam só para a primeira abertura logo após instalar. APK release compilado: **60 MB** (debug: 204 MB). **A abertura da release não foi medida**: o emulador foi encerrado por falta de memória (0,1 GB livres de 15,9 GB com Docker + emulador + Gradle) e, por decisão do usuário, deixou de ser usado por consumir muito desempenho. |

### Observações
- **Release e HTTP:** só o build debug libera tráfego sem TLS (`network_security_config_debug.xml`, para `10.0.2.2`/`localhost`). A release exige HTTPS, então não conversa com a API local em `http://10.0.2.2:3000`. Isso é intencional; para testar a release é preciso uma API com HTTPS.
- **Assinatura:** a release ainda usa a chave de debug (padrão do template). Gerar uma chave própria antes da entrega.
- **Memória da máquina:** depois de builds Android, rodar `gradlew --stop` em `apps/mobile/android` libera vários GB.

## Pendente
- Medir a abertura da release num aparelho Android físico (via USB) ou num momento com memória livre.
- Cenário de dois emuladores/aparelhos (Fase 4).