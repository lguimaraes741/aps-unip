# Como o AlertaCidade funciona — explicação para leigos

Visão geral do sistema em linguagem simples: as peças, o banco de dados, as linguagens, o caminho de um alagamento
registrado, o monitoramento de notícias, a segurança e o que acontece quando algo falha. Os detalhes técnicos estão em
[especificacoes-tecnicas.md](especificacoes-tecnicas.md) e as regras em [regras-de-negocio.md](regras-de-negocio.md).

---

## A ideia em uma frase

Pessoas avisam pelo celular onde está alagando, o sistema confere e espalha esse aviso para quem está perto — e ainda
lê notícias da internet para descobrir alagamentos que ninguém registrou no app.

## As peças: como uma empresa

O sistema é dividido em **cinco programas** que trabalham juntos, cada um com uma função — como setores de uma empresa:

| Peça | Comparação | O que faz |
|---|---|---|
| **App** (celular) | O balcão de atendimento | Onde o cidadão vê o mapa, registra alagamentos e recebe alertas |
| **Painel web** (navegador) | A sala da supervisão | Onde moderadores conferem os registros e administradores gerenciam tudo |
| **API** | A recepção central | Recebe todos os pedidos do app e do painel, confere se a pessoa pode fazer aquilo e guarda no banco |
| **Worker de notificações** | O carteiro | Descobre quem precisa ser avisado e manda a notificação no celular |
| **News-worker** | O repórter | Lê sites de notícias, entende o que está acontecendo e cria alertas |

Eles são **separados de propósito**: se o "repórter" travar lendo um site lento, o "balcão" continua atendendo
normalmente. Essa é a essência de um **sistema distribuído** — o tema da disciplina: várias partes independentes que
conversam entre si, e a queda de uma não derruba as outras.

## O banco de dados: a memória do sistema

### PostgreSQL — o arquivo central
É onde tudo fica guardado de forma permanente: usuários, ocorrências, registros das fotos, confirmações, alertas e
notícias. Funciona como uma coleção de planilhas muito organizadas (as **tabelas**) com regras rígidas. Exemplos:

- uma ocorrência **não pode** ter data no futuro;
- uma pessoa **não pode** confirmar a mesma ocorrência duas vezes;
- um alerta crítico de notícia **não pode** gerar notificação sem confirmação.

Mesmo que o código tivesse um erro, o banco recusaria dados inválidos — é uma segunda camada de proteção.

### PostGIS — um "mapa" dentro do banco
É uma extensão do PostgreSQL que entende **geografia**. Com ela o banco responde perguntas como "quais alagamentos estão
a até 5 km desta pessoa?" ou "quem tem área de interesse dentro do contorno da cidade de Osasco?". Os contornos das
cidades são os oficiais do **IBGE**.

### Redis — o quadro de recados rápido
Não guarda nada permanente. Serve para os programas **passarem recados entre si** muito rápido — por exemplo, "chegou
uma ocorrência nova, alguém avise as pessoas". Ele organiza esses recados em **filas**, como senhas de atendimento: cada
tarefa espera sua vez, e, se der erro, é tentada de novo depois.

## As linguagens e ferramentas

| Linguagem | Onde | Por quê |
|---|---|---|
| **TypeScript** | API, workers e painel | É JavaScript com "verificação de tipos": o computador avisa erros antes de o programa rodar |
| **Dart** (com **Flutter**) | App do celular | O Flutter, do Google, cria apps bonitos e rápidos para Android |
| **SQL** | Banco de dados | A linguagem para guardar e consultar dados no PostgreSQL |

Ferramentas principais:

- **NestJS** — o "esqueleto" da API, que organiza as rotas e a segurança;
- **Prisma** — o tradutor entre o código e o banco;
- **React** — monta as telas do painel;
- **Firebase** (Google) — entrega a notificação no celular;
- **Docker** — liga o banco e o Redis no computador com um único comando.

## Caminho 1 — a vida de um alagamento registrado

1. **Maria abre o app** e vê o mapa com os alagamentos perto dela.
2. **Ela registra uma ocorrência:** o GPS marca o local, o app preenche o endereço sozinho, ela escolhe a gravidade
   (baixa, moderada, alta ou crítica) e tira uma foto.
3. **O app manda tudo para a API**, junto com um "crachá digital" (o *token*) que prova quem é a Maria.
4. **A API confere:** o título tem o tamanho certo? A data é dos últimos 7 dias? A foto é mesmo uma imagem? E ela
   **apaga a localização escondida dentro da foto**, por privacidade.
5. **A API guarda a ocorrência no banco** como "Pendente" e, **na mesma operação**, anota no banco: "aconteceu uma
   ocorrência nova". Essa técnica se chama **outbox** (caixa de saída): garante que o aviso nunca se perde, mesmo se
   algo cair logo depois.
6. **Um "carteiro interno" da API** pega essa anotação e faz duas coisas:
   - avisa em **tempo real** todos os celulares e o painel abertos — a ocorrência aparece na tela sem ninguém atualizar;
   - coloca na **fila do Redis** a tarefa "avisar quem está perto".
7. **O worker de notificações** pega a tarefa e pergunta ao banco: "quem tem área de interesse que cobre esse ponto e
   quer receber alertas dessa gravidade?". Para cada pessoa, guarda o alerta na **central de Alertas** dela e pede ao
   **Firebase** para tocar a notificação no celular.
8. **João, que mora a 300 m, recebe:** "Alagamento de gravidade alta a 300 m (Sé)". Ele toca e vê a ocorrência. Se ele
   também viu, toca em **Confirmar**.
9. **No painel, a moderadora valida a ocorrência.** O status vira "Validada" no app de todo mundo na hora, e a Maria
   recebe: "Sua ocorrência foi validada".

## Caminho 2 — o "repórter": monitoramento de notícias

1. **Periodicamente** — a cada 15 minutos para os portais de notícia e a cada 30 minutos para a Prefeitura de Osasco —,
   o news-worker visita as fontes (g1, Folha, Agência Brasil, CNN Brasil, Prefeitura de Osasco e o GDELT) e pega só os
   títulos e resumos que os próprios sites publicam.
2. **Filtra:** é sobre alagamento? Notícias de outros assuntos são descartadas.
3. **Interpreta a notícia com regras:**
   - **É agora?** Previsão ("pode chover"), obra de prevenção e notícia antiga não contam.
   - **Qual a gravidade?** "Pessoas ilhadas" é crítica; "via interditada" é alta. Adjetivos como "caos" **não** contam —
     só fatos. Sem fato relatado, a gravidade fica "não informada" (nunca "baixa").
   - **Onde?** Identifica a cidade e o bairro pelos nomes do IBGE, só nas 16 cidades monitoradas da Grande São Paulo.
4. **Junta notícias do mesmo episódio:** se o g1 e a Folha falam do mesmo alagamento em Osasco na mesma tarde, vira
   **um alerta só**, com as duas fontes.
5. **Decide com cautela:**
   - **uma fonte só** → publica como "Notícia ainda não confirmada";
   - **duas fontes independentes ou fonte oficial** → "Verificado" ou "Comunicado oficial";
   - **gravidade crítica com uma fonte só** → aparece no mapa, mas **não manda notificação** até um moderador conferir — e
     a equipe de moderação é avisada na hora.
6. As notícias aparecem no **mapa** do app (ícone de jornal) e na tela **"Notícias e monitoramento"**.

Não usamos inteligência artificial paga para entender as notícias (decisão do grupo: nada que gere custo). São **regras
escritas à mão**, o que torna cada decisão explicável. Num teste com **280 notícias reais**: das 9 notícias que o
sistema publicaria como alerta, 8 estavam certas; nenhuma das 8 que deveriam virar alerta ficou de fora; e não houve
nenhuma notificação indevida. O único erro (uma cidade do Paraná confundida com a Grande São Paulo) foi corrigido.

## Segurança, em palavras simples

- **Senhas** nunca ficam guardadas como texto — só num formato embaralhado que não dá para desfazer (Argon2id).
- **Login** gera um "crachá" que vale 15 minutos e é renovado sozinho; se alguém tentar usar um crachá antigo roubado,
  o sistema percebe e cancela todas as sessões daquela conta.
- **No máximo 10 tentativas de login por minuto**, contra quem tenta adivinhar senhas.
- **Perfis:** cidadão, moderador e administrador — cada um só faz o que pode.
- **Privacidade (LGPD):** a pessoa pode baixar todos os seus dados ou apagar a conta; a localização só é usada com
  permissão.
- **Proteção do servidor:** ao ler notícias, o sistema nunca acessa endereços internos da rede — achamos e corrigimos
  duas falhas desse tipo durante os testes.

## Se algo quebrar, o que acontece?

Essa foi uma parte importante do projeto, porque é o coração de "sistemas distribuídos". Testamos derrubando cada peça
de propósito:

| O que cai | O que acontece |
|---|---|
| **Redis** | O app continua registrando; os avisos ficam esperando no banco e saem quando ele volta |
| **Worker de notificações (o carteiro)** | As tarefas esperam na fila; quando ele volta, entrega tudo |
| **Banco de dados** | O news-worker espera e retoma sozinho quando o banco volta |
| **Internet do celular** | Ao reconectar, o app busca exatamente o que perdeu; a tela de notícias mostra a última versão salva |
| **Um site de notícias** | O sistema espera um tempo maior antes de tentar de novo; os outros sites continuam |

## Como o sistema fica "no ar"

O sistema roda **no PC do grupo**. O **Cloudflare Tunnel** cria um endereço público na internet
(`https://….trycloudflare.com`) que funciona como um "cano" seguro até esse computador. O app (arquivo APK) é gerado
apontando para esse endereço, por isso funciona em qualquer rede — inclusive no 4G. Para isso, o PC precisa ficar
ligado com os programas rodando; se o túnel reiniciar, o endereço muda e é preciso gerar um APK novo. Passo a passo em
[como-colocar-no-ar.md](como-colocar-no-ar.md).
