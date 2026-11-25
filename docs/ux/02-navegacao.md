# Mapa de navegação e fluxos — app AlertaCidade (Etapa 2)

Proposta definitiva (substitui a seção 3.1 de `docs/architecture/03-navegacao.md` quando implementada).
Rotas já existentes são mantidas; as novas estão marcadas com **(novo)**.

## Mapa de navegação

```mermaid
flowchart TD
  splash[Splash] -->|sem sessão| welcome[Boas-vindas]
  splash -->|com sessão| map
  welcome --> login[Entrar] & register[Criar conta]
  login --> forgot[Recuperar senha] --> verify[Código + nova senha] --> login
  login --> map
  register --> map

  subgraph abas[Barra inferior fixa]
    map[Mapa]
    alerts[Alertas]
    mine[Registros]
    profile[Perfil]
  end

  map -->|toque no marcador| summary[[Resumo flutuante]] -->|Ver detalhes| detail[Detalhes da ocorrência]
  map -->|card da lista| detail
  map -->|Legenda / Entenda os níveis| levels[[Folha: níveis de gravidade]]
  map -->|Filtros| filters[[Folha: filtros]]
  map -->|+ Registrar| s1

  subgraph wizard[Registrar ocorrência — novo assistente]
    s1[1. Onde aconteceu?] --> s2[2. O que aconteceu?] --> s3[3. Fotos] --> s4[4. Revisar]
    s1 -.->|Escolher no mapa| picker[Selecionar no mapa]
    s4 -->|Enviar| ok[Sucesso — nº do registro **(novo)**]
  end
  ok -->|Ver ocorrência| detail
  ok -->|Voltar ao mapa| map

  alerts -->|toque no alerta| detail
  alerts -->|Raio personalizado| prefs[Notificações e raio]
  mine -->|toque no registro| detail
  detail -->|Entenda os níveis| levels
  profile --> prefs & password[Alterar senha] & delete[Excluir conta] & about[Sobre]
```

Regras: telas secundárias têm seta de voltar e respeitam o "voltar" do Android; ao voltar, mapa (posição e filtros),
listas (posição) e o rascunho do registro são preservados; folhas ( [[ ]] ) fecham com voltar, toque fora ou arrastar.

## Fluxos essenciais — toques necessários

| Fluxo | Caminho | Hoje | Proposto | Atrito removido |
|---|---|---|---|---|
| A — Consultar alagamento | Mapa → marcador → resumo → detalhes | 2 toques, mas o resumo não existe e o marcador pode estar sob o botão | **1 toque** vê o resumo; 2 abre detalhes | Resumo flutuante; marcadores nunca cobertos |
| B — Registrar | Mapa → Registrar → Onde → O que → Fotos → Revisar → Enviar | 1 tela longa com rolagem | 4 etapas curtas + sucesso | Progresso visível; erros por etapa; "Continuar" sempre no mesmo lugar |
| C — Confirmar relato | Mapa/Alertas → detalhes → Confirmar | Confirmar exige rolar 1 tela | Confirmar visível sem rolar | Botões logo após o resumo |
| D — Consultar notificações | Alertas → alerta → detalhes → voltar | Mantém posição | Igual | — |
| E — Acompanhar registro | Registros → filtrar → registro → histórico | Indicadores ocupam 30% da tela | Indicadores compactos que já filtram | Menos rolagem |
| F — Moderação (painel) | Dashboard → fila → análise → validar/rejeitar | Já implementado na Fase 5 | — | — |

## Pontos de atrito identificados
1. Botão de registrar sobre o mapa (cobre marcadores) — resolvido posicionando-o acima do painel inferior.
2. Mapa com pouca área útil — barra superior flutuante e compacta.
3. Gravidade só por cor nos pinos — ícone por nível + legenda.
4. Formulário longo — assistente em etapas.
5. Ações de confirmação fora da primeira tela — reordenação dos detalhes.
