# Auditoria de UX/UI — app AlertaCidade (Etapa 1)

Data: 23/11/2026. Base: capturas das telas **reais** do app (roteador e widgets de produção, dados de exemplo),
geradas por `apps/mobile/test/screenshots/screens_test.dart` — pasta `docs/ux/antes/`. O mapa aparece cinza nas
capturas porque o teste não baixa os tiles do OpenStreetMap; no aparelho o mapa é desenhado normalmente.

Referências: o print de inspiração enviado pelo usuário (mapa com busca flutuante e marcadores em "bolhas",
detalhes com cabeçalho colorido e medidor de nível, folha explicando os níveis) e o documento
"Prompt especializado em UX/UI" do grupo (princípios, navegação, fluxos, acessibilidade).

## Pontos fortes (manter)
- Estados de tela completos: carregamento (skeleton), vazio, erro com "Tentar novamente", aviso de sem conexão.
- Gravidade e status com **texto + ícone**, nunca só cor; avisos de "relato de cidadão, não oficial" e 199/193.
- Barra inferior com destaque em pílula e contador de alertas não lidos.
- Tempo real, rascunho do registro e envio idempotente já funcionam (o problema é de apresentação, não de robustez).
- Alertas: lido × não lido claro, filtros no servidor, "Marcar todos como lidos".

## Problemas encontrados (por prioridade)

### P1 — atrapalham as tarefas principais
| # | Tela | Problema | Evidência | Princípio |
|---|---|---|---|---|
| 1 | Mapa | O botão "+ Registrar ocorrência" **cobre marcadores**: o marcador da ocorrência crítica selecionada fica escondido atrás dele | `04-mapa-marcador-selecionado.png` (ponta vermelha sob o botão) | Não sobrepor informação ao mapa |
| 2 | Mapa | Cabeçalho azul + chips ocupam ~19% da altura; com o painel inferior, o **mapa fica com ~55%** da tela | `03-mapa.png` | Mapa deve ocupar a maior parte |
| 3 | Mapa | Tocar num marcador **não mostra um resumo**: só destaca o card no painel lá embaixo; não há como fechar tocando no mapa | `04-…` | Fluxo A (marcador → resumo → detalhes) |
| 4 | Mapa | Todos os pinos têm o mesmo ícone; **só a cor diferencia a gravidade**; não há legenda | `03-mapa.png` | Acessibilidade: não depender só de cor |
| 5 | Registro | Formulário único com 5 seções em rolagem longa; sem indicação de progresso; botão **"Escolher n…" truncado** | `07-nova-ocorrencia.png` | Fluxo em etapas, "Etapa X de 4" |
| 6 | Detalhes | **Confirmar/Contestar** ficam na 2ª tela de rolagem; o topo não comunica a gravidade (cabeçalho neutro) | `05-detalhes.png`, `06-…` | Destacar confirmação; clareza |

### P2 — refinamento
| # | Tela | Problema |
|---|---|---|
| 7 | Mapa | Menu "⋮" no cabeçalho (regra: não esconder funções em três pontos) e sino que **duplica a aba Alertas** |
| 8 | Mapa | Botões "+ / −" de zoom ocupam a lateral e repetem o gesto de pinça (manter só "minha localização") |
| 9 | Mapa | Chips de filtro cortados na borda ("Pe…") sem indicar que há mais; filtro ativo pouco evidente; sem "Limpar filtros" visível |
| 10 | Listas | Selo "Demonstração" quebra para uma linha própria → cards altos; miniatura vazia ocupa muito espaço |
| 11 | Meus registros | Os 4 indicadores ocupam ~30% da tela; "Ativos" é redundante com Pendentes/Validados |
| 12 | Navegação | Rótulo "Meus registros" longo na barra (o documento do grupo pede "Registros") |
| 13 | Detalhes | Ações "Salvar/Compartilhar" só como ícones no topo, sem texto |

## Melhorias propostas (o que muda, tela a tela)

**Mapa**
- Barra superior **flutuante e compacta** sobre o mapa: pílula de busca com o logo à esquerda e o botão de filtros à direita (com contador de filtros ativos). Sai o cabeçalho azul, o sino e o "⋮".
- Chips rápidos logo abaixo (Gravidade, Status, Raio, Período) com "Limpar" quando houver filtro ativo.
- **Marcadores em "bolhas"** brancas com o pino na cor da gravidade **e um ícone próprio por nível** (não só cor); selecionado fica maior.
- Tocar no marcador abre um **card de resumo flutuante** (faixa na cor da gravidade com "Atualizada há…", título, local/distância, status, **Salvar** e **Compartilhar** em pílulas, "Ver detalhes"); tocar no mapa ou no × fecha.
- Painel inferior recolhido mostra "N ocorrências próximas" + **Legenda**; o botão de registrar fica **acima do painel, sem cobrir o mapa**; sai o zoom +/−.

**Detalhes**
- **Cabeçalho na cor da gravidade** com formas curvas, voltar, título curto e "Atualizada às…"; o conteúdo sobe num painel arredondado.
- Card principal com **medidor de gravidade** (semicírculo de 4 níveis) e "Entenda os níveis" → folha com os 4 níveis explicados.
- **Confirmar/Contestar logo abaixo**, antes de descrição e mapa; Salvar/Compartilhar em pílulas com texto; fotos em carrossel.
- Sem dados inventados: o print mostra temperatura/clima — o projeto não tem essa fonte, então não entra.

**Registrar** — assistente em **4 etapas** (Onde → O que → Fotos → Revisar) com barra "Etapa X de 4", botão "Continuar" fixo embaixo, revisão com "Editar" por bloco e tela de **sucesso** com o número do registro, "Ver ocorrência" e "Voltar ao mapa". Rascunho e envio idempotente continuam.

**Meus registros** — indicadores compactos numa linha (Total, Pendentes, Validadas, Resolvidas), que também filtram; cards compactos.

**Navegação** — rótulos "Mapa · Alertas · Registros · Perfil".

## Metas de usabilidade (hipóteses, não resultados)
- Ocorrências próximas visíveis com no máximo 2 ações após abrir o app.
- Registrar um alagamento em até 2 minutos por quem conhece o fluxo.
- Nenhuma ação destrutiva sem confirmação.
- ≥ 90% de sucesso nas tarefas do plano de testes (a definir com usuários reais).
