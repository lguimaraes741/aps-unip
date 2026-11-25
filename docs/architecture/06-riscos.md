# 6. Riscos técnicos e mitigação

| # | Risco | Prob. | Impacto | Mitigação |
|---|---|---|---|---|
| R1 | **Docker indisponível** na máquina de desenvolvimento (23/11/2026: WSL instalado, mas "no virtualization available" — recurso Plataforma de Máquina Virtual inativo) | Alta | Alto | PowerShell como admin: `wsl.exe --install --no-distribution` (ou `dism /online /enable-feature /featurename:VirtualMachinePlatform /all`) e reiniciar. Alternativa: PostgreSQL+PostGIS nativos para Windows com as mesmas variáveis do `.env` |
| R2 | **Flutter/Android SDK não instalados** (constatado) | Alta | Alto | Instalar antes da Fase 3; validar com `flutter doctor` |
| R3 | Emulador Android não alcança `localhost` | Alta | Médio | Usar `10.0.2.2` no emulador; URL da API configurável por `--dart-define` |
| R4 | Firebase exige projeto, `google-services.json` e conta | Média | Médio | Worker com *provider* de push plugável: FCM real quando configurado; *provider* de log em dev — a fila, dedup e retries funcionam igual |
| R5 | Perda de eventos entre banco e fila | Média | Alto | Transactional Outbox (Fase 4) |
| R6 | Eventos duplicados após retry/reconexão | Alta | Médio | Idempotência em todas as camadas (ver arquitetura 1.3) |
| R7 | Condição de corrida em confirmações e moderação simultânea | Média | Médio | `UNIQUE` + upsert; `version` otimista (409 Conflict) — já testado no nível do banco |
| R8 | Tiles do OpenStreetMap: política de uso limita tráfego intenso | Média | Baixo | Volume acadêmico é pequeno; User-Agent identificando o app; provedor de tiles configurável |
| R9 | Vulnerabilidades em dependências | Média | Médio | Hoje: 4 *high* (`effect`, `deepmerge-ts`) e 3 *moderate* (`glob`, `minimatch`), todas em **ferramentas de desenvolvimento** (CLI do Prisma e do Nest), não no runtime. Reavaliar ao migrar para Prisma 7 estável; `npm audit` na Fase 6 |
| R10 | Fotos com EXIF expõem localização da casa do usuário | Média | Alto (LGPD) | Reprocessar imagem no servidor removendo metadados (Fase 2) |
| R11 | Relatos falsos ou ofensivos | Média | Médio | Moderação, denúncias, rate limit por usuário, selo claro "relato de cidadão" vs "validado pela moderação" |
| R12 | Usuário confundir o app com serviço oficial | Média | Alto | Aviso nas boas-vindas, no Swagger e no rodapé; números 199/193 visíveis |
| R13 | Escopo grande para o prazo da APS | Alta | Alto | Fases entregam versões funcionais incrementais; priorizar critérios de aceitação da seção 19 |
| R14 | Documentação divergir da implementação | Média | Alto | Relatório de testes por fase em `docs/testing/` com saídas reais; nada marcado como concluído sem evidência |
| R15 | E-mail de recuperação sem provedor real | Alta | Médio | `MailService` isolado: em dev o código vai para o log; trocar por SMTP/serviço transacional antes de qualquer uso real |
