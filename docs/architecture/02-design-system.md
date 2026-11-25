# 2. Design system — AlertaCidade

Fonte única: [`packages/design-tokens/tokens.json`](../../packages/design-tokens/tokens.json).
`npm run tokens:build` gera:

| Artefato | Consumidor |
|---|---|
| `dist/tokens.css` (variáveis `--ac-*`) | Painel React |
| `dist/index.js` + `index.d.ts` | Painel React (gráficos, mapa) |
| `dist/flutter/app_tokens.dart` (`AcColors`, `AcSeverityColors`, `AcStatusColors`, `AcTypeScale`…) | App Flutter |

`npm test -w @alertacidade/design-tokens` valida automaticamente o contraste WCAG 2.2 AA de todas as combinações de uso.

## 2.1 Cores

### Marca e neutros

| Token | Valor | Uso |
|---|---|---|
| `brand.primary` | `#0754B8` | Cabeçalho, botão primário, links, item ativo |
| `brand.primaryDark` | `#063B82` | Sidebar do painel, estado pressionado |
| `brand.primaryLight` | `#E8F2FF` | Fundo de chips selecionados, banners informativos |
| `neutral.background` | `#F5F7FB` | Fundo das telas |
| `neutral.surface` | `#FFFFFF` | Cards, painéis, folhas inferiores |
| `neutral.textPrimary` | `#111827` | Texto principal |
| `neutral.textSecondary` | `#5B6476` | Texto de apoio (**ajustado**, ver 2.2) |
| `neutral.border` | `#DCE3ED` | Divisórias e contornos |

### Gravidade × Status — informações separadas

A gravidade (informada pelo cidadão) e o status (fluxo de moderação) **nunca compartilham o mesmo elemento visual**:

- **Gravidade** → cor do marcador no mapa, barra lateral colorida do card e `SeverityBadge` (preenchido).
- **Status** → `StatusBadge` em formato de pílula com **ícone + texto** (cor nunca é o único indicador).

| Gravidade | Marca (`base`) | Marcador | Badge (fundo / texto) |
|---|---|---|---|
| Baixa | `#16A34A` | `#16A34A` | `#DCFCE7` / `#166534` |
| Moderada | `#F59E0B` | `#D97706` | `#FEF3C7` / `#92400E` |
| Alta | `#EF4444` | `#DC2626` | `#FEE2E2` / `#B91C1C` |
| Crítica | `#991B1B` | `#991B1B` | `#991B1B` / `#FFFFFF` |

| Status | Ícone (Material Symbols) | Badge (fundo / texto) |
|---|---|---|
| Pendente | `schedule` | `#FEF9C3` / `#854D0E` |
| Em análise | `manage_search` | `#E8F2FF` / `#063B82` |
| Validada | `verified` | `#CFFAFE` / `#155E75` |
| Rejeitada | `block` | `#F2F4F7` / `#344054` |
| Resolvida | `task_alt` | `#DCFCE7` / `#14532D` |

## 2.2 Ajustes de acessibilidade (medidos)

Os valores da especificação foram preservados como cor de marca (`base`); onde reprovavam no contraste, foi criada uma variante acessível:

| Combinação | Contraste | Mínimo WCAG | Ação |
|---|---|---|---|
| Marcador moderado `#F59E0B` sobre mapa claro | 2,15:1 | 3:1 | Marcador usa `#D97706` (≥ 3:1) |
| Texto pendente `#EAB308` sobre branco | 1,92:1 | 4,5:1 | Badge usa texto `#854D0E` sobre `#FEF9C3` |
| Texto secundário `#667085` sobre `surfaceMuted` `#EEF2F7` | < 4,5:1 | 4,5:1 | Texto secundário passou a `#5B6476` (5,55:1 sobre o fundo) |

## 2.3 Tipografia (Inter; fallback Roboto/Segoe UI)

| Estilo | Tamanho / linha | Peso | Uso |
|---|---|---|---|
| `kpi` | 32/40 | 700 | Números dos MetricCards |
| `headline` | 26/34 | 700 | Título de tela |
| `title` | 20/28 | 600 | Título de seção, nome da ocorrência |
| `subtitle` | 16/24 | 600 | Cabeçalho de card |
| `body` / `bodyStrong` | 15/22 | 400 / 600 | Texto geral |
| `label` | 14/20 | 500 | Botões, chips, campos |
| `caption` | 12/16 | 500 | Horário relativo, distância, legendas |

Os tamanhos escalam com a preferência de fonte do sistema (Flutter `TextScaler`, `rem` no painel); layouts não fixam altura de textos.

## 2.4 Espaçamento, raios, elevação, movimento

- **Grade de 4 px:** `xs 4 · sm 8 · md 12 · lg 16 · xl 24 · xxl 32 · xxxl 48`. Margem lateral de tela: 16.
- **Raios:** campos e chips 8 · cards 12 · folha inferior e diálogos 16/24 · pílulas 999.
- **Elevação:** `card` (sombra sutil), `raised` (FAB, painel flutuante), `overlay` (diálogos).
- **Movimento:** 120 ms (feedback), 200 ms (transições), 320 ms (folha inferior), curva *emphasized*. Respeita "reduzir movimento" do sistema.
- **Toque mínimo:** 48 × 48 dp.

## 2.5 Componentes reutilizáveis

Cada componente existe **uma única vez** por plataforma (`apps/mobile/lib/core/widgets/`, `apps/admin/src/components/`) e só consome tokens.

| Componente | Variações / estados | Observações |
|---|---|---|
| `AppHeader` | azul (mapa), branco (telas internas) | Logo, título, sino com contador, menu |
| `BottomNavigation` | 4 destinos | Mapa · Alertas · Meus registros · Perfil |
| `PrimaryButton` / `SecondaryButton` | normal, pressionado, desabilitado, carregando | Carregando bloqueia duplo envio |
| `OccurrenceCard` | compacto (lista do mapa), completo (Meus registros) | Barra lateral na cor da gravidade |
| `AlertCard` | lido / não lido | Ponto azul quando não lido |
| `SeverityBadge` / `StatusBadge` | 4 gravidades / 5 status | Status sempre com ícone |
| `FilterChip` | selecionado, não selecionado, com contador | |
| `SearchBar` | vazio, digitando, com sugestões | Debounce de 300 ms |
| `MapMarker` | 4 gravidades, selecionado, *cluster* com número | Resolvida: marcador com opacidade reduzida + ícone ✓ |
| `MapPreview` | estático, interativo | Detalhes e formulário |
| `MetricCard` | com/sem variação | Variação só com dados suficientes do período anterior |
| `Timeline` | itens de status | Detalhes da ocorrência |
| `PhotoUploader` | vazio, prévia, enviando (progresso), erro | Até 5 fotos |
| `EmptyState` / `ErrorState` / `LoadingSkeleton` | — | Toda tela usa os três |
| `ConfirmationDialog` | neutro, destrutivo | Ações sensíveis de moderação |
| `Snackbar/Toast` | sucesso, erro, info, offline | |
| `DemoBadge` | — | Selo "Demonstração" para registros `is_demo` |
| `OfflineBanner` | — | Barra fixa quando sem conexão |
