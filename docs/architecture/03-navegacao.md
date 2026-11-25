# 3. Navegação

## 3.1 App mobile (GoRouter)

```mermaid
flowchart TD
  S[/splash/] -->|sem sessão| WEL[/welcome/]
  S -->|sessão válida| MAP
  WEL --> LOGIN[/login/]
  WEL --> REG[/register/]
  LOGIN --> FORGOT[/forgot-password/]
  FORGOT --> VERIFY[/forgot-password/verify/]
  VERIFY --> LOGIN
  LOGIN --> MAP
  REG --> MAP

  subgraph Shell["Shell com BottomNavigation"]
    MAP[/map/ Mapa]
    ALERTS[/alerts/ Alertas]
    MINE[/my-reports/ Meus registros]
    PROFILE[/profile/ Perfil]
  end

  MAP -->|FAB| NEW[/occurrences/new/]
  NEW -->|selecionar no mapa| PICK[/occurrences/new/location/]
  MAP -->|card ou marcador| DET[/occurrences/:id/]
  ALERTS --> DET
  MINE --> DET
  DET --> GAL[/occurrences/:id/photos/]
  ALERTS -->|banner raio| NPREF[/profile/notifications/]
  PROFILE --> NPREF
  PROFILE --> ACC[/profile/account/]
  PROFILE --> PWD[/profile/password/]
  PROFILE --> PRIV[/profile/privacy/]
  PROFILE --> ABOUT[/profile/about/]
```

| Rota | Tela | Acesso |
|---|---|---|
| `/splash` | Splash: restaura sessão (refresh token em armazenamento seguro) | público |
| `/welcome` | Boas-vindas + aviso "não é serviço de emergência" | público |
| `/login`, `/register` | Autenticação | público |
| `/forgot-password`, `/forgot-password/verify` | Recuperação por código de 6 dígitos | público |
| `/map` | Mapa + filtros + painel "Ocorrências próximas" | autenticado |
| `/alerts` | Central de alertas | autenticado |
| `/my-reports` | Meus registros (4 KPIs + filtros) | autenticado |
| `/profile/...` | Perfil e configurações | autenticado |
| `/occurrences/new` | Nova ocorrência (5 seções, rascunho salvo localmente) | autenticado |
| `/occurrences/:id` | Detalhes (também alvo de *deep link* do push) | autenticado |

Regras:
- *Redirect* global: sem sessão → `/welcome`; com sessão em rota pública → `/map`.
- Cada aba preserva sua pilha (`StatefulShellRoute`).
- Tocar uma notificação abre `/occurrences/:id` mesmo com o app fechado.
- Sair de `/occurrences/new` com dados preenchidos pede confirmação; o rascunho permanece salvo.
- Perfis moderador/administrador usam o painel web; no app veem as mesmas telas do cidadão.

## 3.2 Painel administrativo (React Router)

| Rota | Tela | Perfil |
|---|---|---|
| `/login` | Login | público |
| `/` | Dashboard (KPIs, gráficos, mapa, fila de moderação) | MODERATOR, ADMIN |
| `/occurrences` | Tabela com filtros e paginação | MODERATOR, ADMIN |
| `/occurrences/:id` | Análise: fotos, mapa, histórico, ações de moderação | MODERATOR, ADMIN |
| `/map` | Mapa administrativo em tela cheia | MODERATOR, ADMIN |
| `/reports` | Relatórios + exportação CSV | MODERATOR, ADMIN |
| `/users` | Gestão de usuários e perfis | ADMIN |
| `/audit` | Trilha de auditoria | ADMIN |
| `/settings` | Configurações da plataforma | ADMIN |

Itens da sidebar sem permissão não são exibidos — e a API recusa a operação de qualquer forma (a interface não é a barreira de segurança).
