# Declaração de uso de ferramentas de Inteligência Artificial

Texto para o README e para o trabalho escrito da APS (sugestão: seção própria antes da Bibliografia, ou dentro de
"Plano de desenvolvimento — ferramentas utilizadas"). **Revisar e completar os campos entre colchetes antes de entregar.**

---

## Ferramenta utilizada

O grupo utilizou o **Claude** (Anthropic), por meio do **Claude Code** — assistente de programação que roda no
terminal, lê e edita os arquivos do projeto e executa comandos (testes, builds, banco de dados) com a autorização do
usuário — durante [período: ex. novembro de 2026].

## Como a ferramenta foi usada

| Atividade | Participação da IA | Participação do grupo |
|---|---|---|
| Definição do tema e da proposta | — | [O grupo escolheu o tema (alagamentos urbanos) e submeteu a proposta ao coordenador] |
| Requisitos e regras de trabalho | Propôs especificação, arquitetura e plano por fases | Aprovou a especificação e o plano; definiu as regras de trabalho (desenvolver por fases, só afirmar que algo funciona com execução comprovada, nunca apresentar dados fictícios como reais) |
| Decisões de produto | Apresentou alternativas, riscos e recomendações | Tomou as decisões, por exemplo: fontes de notícia só gratuitas (GDELT e RSS) e nada que gere custo; manter a moderação humana para casos de risco; aprovar a auditoria de UX e o mapa de navegação |
| Código (API, workers, painel, app) | Gerou e revisou a maior parte do código, a partir das decisões do grupo | [Descrever: revisão, ajustes, partes escritas pelo grupo, entendimento do código para a apresentação] |
| Testes automatizados | Escreveu e executou os testes; corrigiu os defeitos encontrados | Executou as suítes que exigem terminal próprio (ex.: integração com recriação do banco) e acompanhou os resultados |
| Testes em aparelho real | Preparou os cenários e conferiu os registros no banco e nos logs | Executou os testes no celular (login, mapa, registro, push, modo avião, painel) e relatou os resultados |
| Configuração de serviços externos | Orientou os passos | Criou e configurou a conta e o projeto do Firebase; instalou as ferramentas na máquina |
| Avaliação com notícias reais | Coletou as notícias, rotulou e calculou as métricas | [Conferir os rótulos em `apps/news-worker/eval/labels-20261124.json` e registrar aqui a conferência] |
| Documentação | Redigiu a documentação técnica, os relatórios de teste e textos de apoio | [Revisou, adaptou à voz do grupo e escreveu as partes de reflexão (formação, interdisciplinaridade)] |

## Responsabilidade e verificação

- Todo resultado apresentado foi **verificado por execução** (testes automatizados, processos reais e testes no
  aparelho), e as evidências estão registradas em `docs/testing/`. Afirmações sem execução comprovada foram
  marcadas como "não verificado".
- Erros cometidos pela ferramenta e encontrados durante os testes foram corrigidos e documentados nos relatórios
  (ex.: falhas de segurança na coleta de notícias, condição de corrida na publicação de alertas, problemas de
  layout no app).
- O grupo é responsável pelo conteúdo entregue, pelas decisões de projeto e pela apresentação do sistema.
  [Opcional: descrever como o grupo estudou o código gerado para poder explicá-lo na apresentação.]

## Reflexão (sugestão para a dissertação)

[Espaço para o grupo: o que aprendeu ao trabalhar com um assistente de IA — por exemplo, a importância de definir
requisitos claros, de exigir evidência de que algo funciona, de revisar decisões de segurança e de entender o código
antes de apresentá-lo; limites percebidos da ferramenta; efeito na formação.]
