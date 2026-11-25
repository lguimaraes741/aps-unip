# Avaliação com notícias reais (Etapa 11)

- `snapshot-AAAAMMDD.json` — retrato dos feeds RSS COMPLETOS das fontes ligadas, tirado com
  `npm run snapshot-feeds -w @alertacidade/news-worker -- eval/snapshot-AAAAMMDD.json`. Guarda só o que o próprio
  feed publica (título, resumo ≤ 500 caracteres, link e data), para avaliação acadêmica do classificador.
- `labels-AAAAMMDD.json` — rótulo de cada item (chave = URL): `alert` (deveria virar alerta: alagamento ocorrido
  nas últimas 72 h numa das 16 cidades monitoradas) e `flood` (texto sobre alagamento, inclusive previsão,
  prevenção ou outra região). **Rótulos feitos pelo Claude lendo título e resumo — a conferir pelo grupo.**
- `npm run eval-real -w @alertacidade/news-worker -- eval/snapshot-AAAAMMDD.json eval/labels-AAAAMMDD.json`
  calcula as métricas e lista cada erro. Sem o arquivo de rótulos, lista os itens com a decisão do sistema.

Um retrato usado para corrigir regras deixa de ser medida independente: avalie mudanças em um retrato NOVO.
