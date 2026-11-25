# AlertaCidade 2.0 — Regras de negócio e regras do aplicativo

Documento de referência das regras que o sistema aplica. Cada regra está implementada e coberta por testes
automatizados (evidências em `docs/testing/`). Detalhes técnicos (linguagens, banco, versões) estão em
[especificacoes-tecnicas.md](especificacoes-tecnicas.md).

> O AlertaCidade reúne **relatos de cidadãos** e **alertas identificados em notícias públicas**. **Não é um serviço
> oficial de emergência.** Em risco, ligue para a Defesa Civil (199) ou os Bombeiros (193) — o aviso aparece no app.

---

## 1. Perfis de usuário

| Perfil | Pode |
|---|---|
| **Cidadão** (`CITIZEN`) | Registrar ocorrências, confirmar/contestar as dos outros, salvar, denunciar, receber alertas, ver notícias, gerenciar a própria conta |
| **Moderador** (`MODERATOR`) | Tudo do cidadão + painel: moderar ocorrências, tratar denúncias, moderar eventos de notícia, dashboard e relatórios |
| **Administrador** (`ADMIN`) | Tudo do moderador + auditoria, gestão de usuários (perfil e suspensão), ligar/desligar fontes de notícia, excluir qualquer ocorrência |

- Toda rota da API exige login, exceto cadastro, login, recuperação de senha e health check.
- Itens de menu sem permissão nem aparecem no painel; a API recusa (403) de qualquer forma.
- **Sempre existe pelo menos um administrador ativo:** o último não pode ser rebaixado nem suspenso.
- Suspender uma conta encerra todas as sessões dela na hora.

## 2. Conta e acesso

| Regra | Valor |
|---|---|
| Nome | 2 a 120 caracteres |
| Senha | 8 a 72 caracteres, com letra maiúscula, minúscula e número |
| Aceite dos termos | Obrigatório no cadastro |
| Sessão | Token de acesso de **15 min** + token de renovação de **30 dias**, trocado a cada uso |
| Roubo de sessão | Reusar um token de renovação já trocado revoga **toda a família** de sessões |
| Tentativas de login/cadastro/recuperação | No máximo **10 por minuto** por origem (demais rotas: 120/min) |
| Recuperação de senha | Código de **6 dígitos**, válido por **15 min**, no máximo **5 tentativas**; a resposta é a mesma exista o e-mail ou não (não revela quem tem conta) |
| Senhas guardadas | Só o hash (Argon2id); tokens de renovação e códigos também só como hash |

## 3. Ocorrências (relatos de cidadãos)

### 3.1 Registro
| Campo | Regra |
|---|---|
| Título | 3 a 120 caracteres |
| Descrição | 10 a 2.000 caracteres |
| Endereço | 3 a 255 caracteres (preenchido automaticamente pelo GPS do aparelho, **sem sobrescrever** o que a pessoa digitou) |
| Bairro | Opcional, até 120 caracteres |
| Local | Latitude e longitude obrigatórias (GPS ou escolha no mapa) |
| Gravidade | Baixa, Moderada, Alta ou Crítica — escolhida por quem registra, com explicação de cada nível no app |
| Data do ocorrido | Nos **últimos 7 dias**; não pode estar no futuro (tolerância de 5 min para relógio adiantado) |
| Fotos | Até **5 por ocorrência**, até **10 MB** cada; o tipo é conferido pelo conteúdo do arquivo; o servidor reprocessa a imagem e **remove metadados** (inclusive a posição GPS gravada na foto) |
| Reenvio | Cada rascunho tem um identificador único: reenviar (falha de rede, toque duplo) **não duplica** o registro |
| Rascunho | Fica salvo no aparelho; só conta como rascunho se tiver conteúdo digitado pela pessoa (local e endereço automáticos não contam) |

Toda ocorrência nasce **Pendente** e entra na fila de moderação.

### 3.2 Ciclo de vida (status)

```
Pendente ──► Em análise ──► Validada ──► Resolvida
   │              │
   └──────────────┴──► Rejeitada
Pendente ──────────────► Validada
```

| De | Pode ir para |
|---|---|
| Pendente | Em análise, Validada, Rejeitada |
| Em análise | Validada, Rejeitada |
| Validada | Resolvida |
| Rejeitada / Resolvida | — (finais) |

- **Rejeitar exige justificativa** (3 a 500 caracteres), que aparece no histórico.
- **Moderação simultânea:** cada mudança informa a versão que o moderador viu; se outra pessoa alterou antes, a segunda
  recebe "alterada por outra pessoa" e precisa recarregar (nada é sobrescrito sem ver).
- Toda mudança de status gera um item na **linha do tempo** da ocorrência e um registro de **auditoria**.

### 3.3 Visibilidade
- O mapa mostra por padrão as ocorrências **ativas** (Pendente, Em análise, Validada).
- **Rejeitadas** só são vistas pela autora e pela equipe; a observação da moderação também.
- Ocorrências do *seed* de demonstração aparecem com o selo **"Demonstração"** (nunca como relatos reais).

### 3.4 Participação
- **Confirmar ou contestar:** uma manifestação por pessoa por ocorrência (pode trocar ou retirar); **não vale na
  própria ocorrência**; só enquanto ela está Pendente, Em análise ou Validada. Os contadores ficam exatos mesmo com
  muitos acessos ao mesmo tempo.
- **Salvar** ocorrências para acompanhar.
- **Denunciar** conteúdo (spam, ofensivo, informação falsa, dados pessoais, outro): uma denúncia por pessoa por
  ocorrência; a equipe marca como procedente ou improcedente.
- **Remover:** a autora só remove a própria ocorrência enquanto ela está **Pendente**; o administrador remove qualquer
  uma. A remoção tira a ocorrência do mapa e das listas para todos (exclusão lógica, com auditoria).

### 3.5 Mapa e filtros
- Raio de busca de **100 m a 50 km** (padrão 5 km), a partir da localização da pessoa (com permissão) ou de um ponto
  escolhido ("Buscar nesta área").
- Filtros: gravidade, status, período (até 30 dias) e busca por título, endereço ou bairro.
- Ordenação por distância (quando há ponto) ou pelas mais recentes.

## 4. Alertas e notificações

### 4.1 Preferências da pessoa
- **Área de interesse:** um ponto escolhido pela pessoa + raio de **100 m a 50 km**. O sistema não rastreia a
  localização continuamente (LGPD).
- **Gravidade mínima** para receber alerta (Baixa a Crítica).
- Alertas por push ligados ou desligados.

### 4.2 Quem recebe o quê
| Evento | Quem recebe |
|---|---|
| Nova ocorrência | Quem tem a ocorrência **dentro da área de interesse**, com gravidade **≥ mínima** escolhida, alertas ligados e conta ativa — **exceto a autora** |
| Ocorrência validada, rejeitada ou resolvida | A **autora** |
| Alerta de notícia | Ver 5.4 |
| Revisão urgente de notícia | Toda a equipe (moderadores e administradores ativos), sem filtro de área |

- O texto do alerta diz a distância e deixa claro que é **relato de cidadão** (ou notícia não confirmada, verificada
  ou comunicado oficial), sempre citando o 199.
- **Nunca duas vezes:** o mesmo evento não gera duas notificações para a mesma pessoa, mesmo com reentregas.
- A notificação guarda a **distância calculada**, nunca a posição da pessoa.
- Cada alerta fica na **central de Alertas** do app (filtros: todos, não lidos, críticos, próximos, resolvidos; marcar
  como lido) e, se houver aparelho cadastrado, chega como **push**. Tocar no push abre a ocorrência ou a notícia.
- Ao sair da conta, o aparelho deixa de receber push daquela conta.

### 4.3 Tempo real
- Mudanças (nova ocorrência, status, confirmação, remoção, alerta de notícia) aparecem no app e no painel **sem
  atualizar a tela**; se a conexão cair, ao voltar o app recupera exatamente o que perdeu.
- Eventos de moderação de notícias são **só para a equipe**: nunca chegam aos cidadãos.

## 5. Monitoramento de notícias (News Intelligence)

### 5.1 Fontes
- Só fontes públicas com termos de uso conferidos (RSS de veículos, GDELT, prefeitura). **Nunca** contornar paywall,
  login ou bloqueio; **nunca** baixar o artigo inteiro — só título, link, data, autor e o resumo do próprio feed
  (até 500 caracteres).
- Cada fonte respeita um intervalo mínimo entre coletas (**≥ 5 min**) e o pedido de espera da fonte (HTTP 429).
  Falhas repetidas fazem a fonte esperar mais (5, 15, 45 min… até 6 h); a fonte não é desligada sozinha.
- Só o administrador liga ou desliga fontes; uma fonte só pode ser ligada com os termos conferidos.
- A mesma notícia nunca é gravada duas vezes (mesmo endereço, ou republicada por outra fonte).

### 5.2 Análise de cada notícia
- **Relevância:** precisa tratar de alagamento/enchente.
- **Temporalidade:** só notícia de ocorrência **atual** (publicada nas últimas 72 h) vira alerta. Previsão, prevenção
  (obras, limpeza), histórico ("há 10 anos") e "estado de atenção" não viram alerta; "via liberada / água baixou"
  encerra um alerta existente.
- **Gravidade = impacto relatado**, pela evidência mais forte:
  Crítica (pessoas ilhadas, resgate, arrastado, morte, desabrigados, evacuação, calamidade) ·
  Alta (via interditada, rio transbordou, imóveis atingidos, carros submersos) ·
  Moderada (trânsito lento, via parcialmente alagada) · Baixa (bolsões, poças).
  Adjetivos ("caos", "tragédia") **não contam**; negações e possibilidades ("não houve feridos", "pode alagar") anulam
  a evidência. **Sem evidência, a gravidade é "não informada" — nunca "baixa".**
- **Local:** cidade e distrito pelos nomes do IBGE, só nas **16 cidades monitoradas** da Grande São Paulo; notícia de
  outra cidade, estado ou "região metropolitana de outra capital" fica fora; nomes repetidos em outros estados
  exigem contexto. Ponto no mapa só quando a fonte cita rua ou local exato.
- **Confiança = qualidade da evidência:** Alta (fonte oficial, ou 2 fontes independentes de imprensa coerentes em
  local e horário), Média (1 veículo estabelecido, local claro), Baixa (demais casos).
- **Independência:** domínios diferentes **e** textos não quase idênticos **e** sem a mesma agência citada.
  Republicação conta como a mesma fonte.
- **"Oficial" depende de quem publica** (fonte cadastrada como oficial), nunca do que o texto diz.

### 5.3 Agrupamento e publicação
- Notícias da mesma cidade numa janela de ±6 h, sem conflito de local, formam **um evento** (com todos os links).
  **Agrupar não é confirmar:** só fontes independentes e com local claro contam para a confiança.

| Situação | Resultado |
|---|---|
| Confiança baixa | **Aguardando validação** — não aparece no app |
| Confiança média | Publicado como **Preliminar** ("Notícia ainda não confirmada") |
| Confiança alta | Publicado como **Verificado** (ou **Comunicado oficial**, se a fonte é oficial) |
| Crítico de fonte única | Preliminar no mapa, **sem push**, e vai para a moderação como **urgente** |
| Sem notícia nova há mais de 6 h | Sai do mapa (fica no histórico como "sem atualizações recentes") |
| Moderador descarta | Alerta **retirado**: some do app; quem recebeu é avisado da correção |

- Notícia **nunca** é apresentada como alerta da Defesa Civil; todo alerta mostra a origem e as fontes.
- O moderador pode validar, descartar, encerrar, corrigir gravidade/local e juntar eventos duplicados; o que ele
  corrigiu não é sobrescrito pela automação. Toda ação vai para a auditoria.
- Quando um evento **passa a ser urgente**, a equipe recebe na hora um aviso (push + destaque no painel).

### 5.4 Push de notícia
| Nível | Push |
|---|---|
| Gravidade não informada | Nunca |
| Preliminar | Só gravidade **Alta** (crítica preliminar, nunca) |
| Verificado / Oficial | Conforme a gravidade mínima de cada pessoa |
| Mudanças | Novo push só se a gravidade **subir** ou o alerta passar de preliminar para verificado; encerramento e correção avisam **só quem recebeu** |

Destinatários: quem tem a área de interesse cruzando a área do alerta — o ponto, ou o **contorno oficial (IBGE) da
cidade** quando a notícia não cita rua. O texto do push usa frases fixas do sistema e o nome da cidade; **nunca copia
texto da notícia**.

### 5.5 No app
- Camada "Notícias" no mapa (pode ser escondida): quadrado com jornal = notícia; prédio público = comunicado
  oficial; área colorida = alerta da cidade inteira (cinza tracejado = gravidade não informada).
- Tela "Notícias e monitoramento" (pela central de Alertas): histórico recente com filtros de cidade, período,
  gravidade, fonte e verificação. Sem internet, mostra a última consulta salva, com aviso e data — só se os filtros
  forem os mesmos.
- Links das notícias abrem só endereços http/https, no navegador.

## 6. Privacidade (LGPD)
- Localização só com permissão explícita, e usada apenas para o mapa, o registro e a área de interesse escolhida.
- **Exportar meus dados:** o app gera um arquivo (JSON) com perfil, preferências, ocorrências registradas, manifestações, salvos e alertas recebidos.
- **Excluir conta:** exige a senha; anonimiza a conta na hora ("Usuário removido"), apaga sessões, aparelhos,
  preferências, alertas e salvos. Os relatos permanecem (interesse público) **sem autoria identificável**.
- Fotos têm os metadados removidos; a auditoria não guarda dados sensíveis (senhas, tokens).

## 7. Administração
- **Dashboard** com indicadores; **mapa** administrativo; **relatórios** por período com exportação **CSV** (protegida
  contra fórmulas maliciosas em planilhas).
- **Auditoria** (só administrador): quem fez, o quê, quando, de onde (IP) e o antes/depois.
- **Denúncias:** fila de abertas, marcar como procedente ou improcedente.
- **Usuários:** mudar perfil e suspender/reativar (com as travas da seção 1).
