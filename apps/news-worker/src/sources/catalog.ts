import { NewsSourceReliability, NewsSourceType, Prisma } from '@prisma/client';

/**
 * Fontes aprovadas pelo usuário em 24/11/2026 (GDELT + RSS; nada pago).
 * `termsNote` diz EXATAMENTE o que foi conferido — não é parecer jurídico.
 * Em todas: armazenamos só título, link, data, autor e o resumo que o próprio feed publica.
 */
export interface CatalogSource {
  key: string;
  name: string;
  type: NewsSourceType;
  reliability: NewsSourceReliability;
  baseUrl: string;
  feedUrl: string;
  collectionIntervalSec: number;
  minRequestIntervalMs: number;
  defaultCityIbge?: string;
  config?: Prisma.InputJsonObject;
  enabled: boolean;
  termsNote: string;
}

const CHECKED = '24/11/2026: feed público respondeu 200; robots.txt sem bloqueio para User-agent *.';
export const TERMS_CHECKED_AT = new Date('2026-11-24T12:00:00-03:00');

export const SOURCE_CATALOG: CatalogSource[] = [
  {
    key: 'gdelt-brasil-alagamentos',
    name: 'GDELT (descoberta de notícias)',
    type: 'GDELT',
    // Agregador: aponta matérias de terceiros, sem resumo. Sozinho nunca passa de confiança baixa.
    reliability: 'AGGREGATOR',
    baseUrl: 'https://www.gdeltproject.org',
    feedUrl: 'https://api.gdeltproject.org/api/v2/doc/doc',
    collectionIntervalSec: 900,
    // A API pede no máximo 1 requisição a cada 5 s; usamos 10 s.
    minRequestIntervalMs: 10_000,
    config: {
      query: '(alagamento OR alagamentos OR enchente OR inundação OR transbordou) sourcecountry:brazil sourcelang:portuguese',
      timespan: '1d',
      maxRecords: 75,
    },
    enabled: true,
    termsNote: '24/11/2026: API aberta e gratuita; a própria API informa o limite de 1 requisição a cada 5 s (respondeu 429 em testes).',
  },
  {
    key: 'agencia-brasil-ultimas',
    name: 'Agência Brasil — Últimas notícias',
    type: 'RSS',
    reliability: 'ESTABLISHED_PRESS',
    baseUrl: 'https://agenciabrasil.ebc.com.br',
    feedUrl: 'https://agenciabrasil.ebc.com.br/rss/ultimasnoticias/feed.xml',
    collectionIntervalSec: 900,
    minRequestIntervalMs: 2_000,
    enabled: true,
    termsNote: CHECKED,
  },
  {
    key: 'g1-sao-paulo',
    name: 'g1 São Paulo',
    type: 'RSS',
    reliability: 'ESTABLISHED_PRESS',
    baseUrl: 'https://g1.globo.com/sp/sao-paulo/',
    feedUrl: 'https://g1.globo.com/rss/g1/sp/sao-paulo/',
    collectionIntervalSec: 900,
    minRequestIntervalMs: 2_000,
    defaultCityIbge: '3550308',
    enabled: true,
    // A URL antiga (/rss/g1/sao-paulo/) responde 200 mas parou em 2018 — detectado na 1ª coleta real.
    termsNote: CHECKED,
  },
  {
    key: 'folha-cotidiano',
    name: 'Folha de S.Paulo — Cotidiano',
    type: 'RSS',
    reliability: 'ESTABLISHED_PRESS',
    baseUrl: 'https://www1.folha.uol.com.br/cotidiano/',
    feedUrl: 'https://feeds.folha.uol.com.br/cotidiano/rss091.xml',
    collectionIntervalSec: 900,
    minRequestIntervalMs: 2_000,
    enabled: true,
    termsNote: `${CHECKED} Feed em ISO-8859-1, links via redirecionador (desembrulhados).`,
  },
  {
    key: 'cnn-brasil',
    name: 'CNN Brasil',
    type: 'RSS',
    reliability: 'ESTABLISHED_PRESS',
    baseUrl: 'https://www.cnnbrasil.com.br',
    feedUrl: 'https://www.cnnbrasil.com.br/feed/',
    collectionIntervalSec: 900,
    minRequestIntervalMs: 2_000,
    enabled: true,
    termsNote: CHECKED,
  },
  {
    key: 'prefeitura-osasco',
    name: 'Prefeitura de Osasco (notícias)',
    type: 'RSS',
    // Órgão público: comunicado institucional. Ainda assim só vira "oficial atual" se a matéria for recente.
    reliability: 'OFFICIAL',
    baseUrl: 'https://www.osasco.sp.gov.br',
    feedUrl: 'https://www.osasco.sp.gov.br/feed/',
    collectionIntervalSec: 1800,
    minRequestIntervalMs: 5_000,
    defaultCityIbge: '3534401',
    enabled: true,
    termsNote: CHECKED,
  },
];
