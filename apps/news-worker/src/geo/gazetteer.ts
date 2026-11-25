import data from './data/ibge-localidades.json';
import { mentionsFlood } from '../analysis/rules';
import { FoldedText } from '../text/folded';
import { fold } from '../text/normalize';
import { Evidence, LocationPrecision } from '../types';

/**
 * Extração geográfica (docs/architecture/07-news-intelligence.md, 7.5 etapa 5).
 *
 * Fonte dos nomes: IBGE, API de Localidades (ver `data/ibge-localidades.json`, campo `source`).
 * Este módulo NÃO produz coordenadas: só identifica cidades/distritos/logradouros citados.
 * Coordenadas virão da malha do IBGE (área do município/distrito) ou de geocodificação de um
 * logradouro — nunca inventadas (Etapa 6).
 *
 * Homônimos são o problema central: 38 dos 96 distritos da capital têm nome de município
 * de outro lugar (Lapa/PR, Santana/AP, Pinheiros/ES…), e alguns são palavras comuns
 * ("Socorro", "Saúde", "Liberdade"). Por isso distritos só são aceitos com contexto.
 */

export interface CityRef {
  ibge: string;
  name: string;
  state: string;
}
export interface DistrictRef {
  ibge: string;
  name: string;
  cityIbge: string;
}

export interface LocationExtraction {
  cities: CityRef[];
  districts: DistrictRef[];
  /** Logradouros, pontes, túneis, córregos citados (texto original). Ainda sem coordenadas. */
  places: string[];
  /** Menciona a Grande São Paulo / região metropolitana sem cidade específica. */
  metroRegion: boolean;
  /** Fora das regiões monitoradas (ex.: só cita cidades do RS). */
  outOfScope: boolean;
  /** Motivos de dúvida — qualquer item aqui manda o evento para moderação. */
  ambiguities: string[];
  precision: LocationPrecision;
  evidence: Evidence[];
}

export interface LocationContext {
  /** Cidade padrão da fonte (ex.: feed "G1 São Paulo" → capital). Ajuda a aceitar distritos. */
  sourceCityIbge?: string;
}

const SAO_PAULO_IBGE = '3550308';

const UFS: Record<string, string> = {
  AC: 'Acre', AL: 'Alagoas', AP: 'Amapá', AM: 'Amazonas', BA: 'Bahia', CE: 'Ceará', DF: 'Distrito Federal',
  ES: 'Espírito Santo', GO: 'Goiás', MA: 'Maranhão', MT: 'Mato Grosso', MS: 'Mato Grosso do Sul', MG: 'Minas Gerais',
  PA: 'Pará', PB: 'Paraíba', PR: 'Paraná', PE: 'Pernambuco', PI: 'Piauí', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
  RS: 'Rio Grande do Sul', RO: 'Rondônia', RR: 'Roraima', SC: 'Santa Catarina', SP: 'São Paulo', SE: 'Sergipe', TO: 'Tocantins',
};
/** Gentílicos/regiões que indicam outro estado (texto sem acento). */
/** Regiões do estado de SP fora da área monitorada (Grande SP). */
const OTHER_SP_REGIONS =
  /(?<![a-z])(?:interior paulista|interior de sao paulo|interior do estado|litoral (?:norte |sul )?(?:paulista|de sao paulo)|baixada santista|vale do paraiba|vale do ribeira)(?![a-z])/;
const OTHER_STATE_DEMONYMS =
  /(?<![a-z])(?:gauch[oa]s?|minein?r[oa]s?|cariocas?|fluminenses?|baian[oa]s?|pernambucan[oa]s?|paranaenses?|catarinenses?|capixabas?|cearenses?|goian[oa]s?|maranhenses?|paraenses?|amazonenses?|potiguares?|nordeste|nordestin[oa]s?)(?![a-z])/;

interface CityEntry extends CityRef {
  patterns: string[];
}

/** Apelidos usuais na imprensa (sem acento), por código IBGE. "Embu" sozinho não entra: existe Embu-Guaçu. */
const ALIASES: Record<string, string[]> = {
  '3550308': ['capital paulista', 'cidade de sao paulo'],
  '3548708': ['sao bernardo'],
  '3548807': ['sao caetano'],
  '3552809': ['taboao'],
};

const MONITORED: CityEntry[] = data.monitoredCities.map((c) => ({
  ...c,
  patterns: [fold(c.name), ...(ALIASES[c.ibge] ?? [])],
}));

const MUNICIPALITY_UFS = new Map<string, string[]>();
for (const [name, uf] of data.brazilMunicipalities as Array<[string, string]>) {
  const key = fold(name);
  MUNICIPALITY_UFS.set(key, [...(MUNICIPALITY_UFS.get(key) ?? []), uf]);
}

const DISTRICTS = data.saoPauloDistricts.map((d) => ({ ...d, cityIbge: SAO_PAULO_IBGE }));
/** Distritos cujo nome é palavra comum: exigem preposição de lugar + maiúscula. */
const COMMON_WORD_DISTRICTS = new Set(['socorro', 'saude', 'liberdade', 'se', 'pedreira', 'penha', 'belem', 'consolacao', 'ponte rasa']);

const L = '(?<![\\p{L}\\d])';
const R = '(?![\\p{L}\\d])';
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const UF_TAG = new RegExp(
  `${L}(\\p{Lu}[\\p{L}'’-]*(?:\\s+(?:d[aeo]s?\\s+)?\\p{Lu}[\\p{L}'’-]*){0,4})\\s*(?:\\(|/|\\s[-–]\\s|,\\s*)(${Object.keys(UFS).join('|')})\\)?${R}`,
  'gu',
);
const STATE_NAMES = new RegExp(
  `${L}(?:no|na|do|da|em|de)\\s+(${Object.entries(UFS)
    .filter(([uf]) => uf !== 'SP')
    .map(([, n]) => escape(n))
    .sort((a, b) => b.length - a.length)
    .join('|')})${R}`,
  'gu',
);
const PLACES = new RegExp(
  `${L}(?:Avenida|Av\\.|Rua|R\\.|Estrada|Rodovia|Marginal|Ponte|Túnel|Viaduto|Praça|Largo|Alameda|Córrego|Ribeirão|Rio|Complexo Viário)\\s+(?:d[aeo]s?\\s+)?[\\p{Lu}\\d][\\p{L}\\d.'’-]*(?:\\s+(?:d[aeo]s?\\s+|e\\s+)?[\\p{Lu}\\d][\\p{L}\\d.'’-]*){0,5}`,
  'gu',
);
const SP_STATE_CONTEXT = /(?:estado|governo|interior|litoral(?: norte| sul)?|tribunal de justica|assembleia legislativa|policia militar) de sao paulo$/;
/**
 * Grande SP. "Região metropolitana" sozinha vale (as fontes paulistas escrevem assim), mas "região
 * metropolitana DE outra cidade" não — achado da avaliação com notícias reais (Etapa 11): "região
 * metropolitana de Curitiba" publicava um alerta de Campo Largo (PR) como se fosse da Grande SP.
 */
const METRO = /(?<![a-z])(?:grande sao paulo|grande sp|regiao metropolitana de sao paulo|regiao metropolitana(?! d[aeo]s? ))(?![a-z])/;
const SP_CITY_CONTEXT = /(?<![a-z])(?:zona (?:norte|sul|leste|oeste|central)(?: de (?:sao paulo|sp))?|capital paulista|centro expandido|cidade de sao paulo|prefeitura de sao paulo)(?![a-z])/;
/** Identifica a CAPITAL sem depender da fonte ("zona sul" sozinha também existe no Rio). */
const SP_CITY_EXPLICIT = /(?<![a-z])(?:zona (?:norte|sul|leste|oeste|central) de (?:sao paulo|sp)|capital paulista|cidade de sao paulo|prefeitura de sao paulo)(?![a-z])/;
/** Incidentes que não são alagamento — o distrito citado junto deles não localiza o alagamento. */
const OTHER_INCIDENT = /(?<![a-z])(?:arvores?|incendio|acidente|colisao|desabamento|deslizamento|queda de energia|falta de energia|raios?|assalto)(?![a-z])/;
/**
 * Municípios paulistas FORA da área monitorada (Aparecida, Ubatuba…). Nomes que também são
 * distritos da capital (Tremembé, Pedreira, Socorro…) ficam de fora: são ambíguos por natureza.
 * Caso real (24/11/2026): "O município de Aparecida, em São Paulo, teve alagamentos" — sem esta
 * lista, "São Paulo" (o estado) virava alerta para a capital.
 */
const DISTRICT_KEYS = new Set(data.saoPauloDistricts.map((d) => fold(d.name)));
const OTHER_SP_CITIES = (data.brazilMunicipalities as Array<[string, string]>)
  .filter(([n, uf]) => uf === 'SP' && !MONITORED.some((c) => c.name === n) && !DISTRICT_KEYS.has(fold(n)))
  .map(([n]) => n)
  .sort((a, b) => b.length - a.length);
const OTHER_SP_ALT = OTHER_SP_CITIES.map(escape).join('|');
const OTHER_SP_CITY_MENTION = new RegExp(`${L}(?:em|de|do|da|no|na|para|município de|cidade de)\\s+(${OTHER_SP_ALT})${R}|^(${OTHER_SP_ALT})${R}`, 'gu');
/** "Aparecida, em São Paulo" / "Ubatuba, no estado de São Paulo": aqui "São Paulo" é o estado. */
const STATE_USAGE_BEFORE = new RegExp(`(?:${OTHER_SP_CITIES.map((n) => escape(fold(n))).join('|')})\\s*,?\\s*(?:em|no estado de|estado de)\\s*$`);

const LOCATIVE_BEFORE = /(?:^|[\s,(])(?:em|no|na|nos|nas|do|da|dos|das|de|bairro|bairros|distrito|regiao|subprefeitura)\s+(?:d[aeo]s?\s+)?$/;

export function extractLocation(title: string, summary: string | null, ctx: LocationContext = {}): LocationExtraction {
  const original = [title, summary ?? ''].filter(Boolean).join('. ');
  const text = new FoldedText(original);
  const out: LocationExtraction = {
    cities: [],
    districts: [],
    places: [],
    metroRegion: false,
    outOfScope: false,
    ambiguities: [],
    precision: 'UNKNOWN',
    evidence: [],
  };

  const positions = new Map<string, number>();

  // 1) "Cidade (UF)", "Cidade/UF", "Cidade - UF": desambiguação explícita.
  const foreign: string[] = [];
  for (const m of original.matchAll(UF_TAG)) {
    const name = m[1];
    const uf = m[2];
    const ufs = MUNICIPALITY_UFS.get(fold(name));
    if (!ufs?.includes(uf)) continue;
    const monitored = uf === 'SP' ? MONITORED.find((c) => fold(c.name) === fold(name)) : undefined;
    if (monitored) pushCity(out, positions, monitored, m[0], m.index!);
    else foreign.push(`${name}/${uf}`);
    maskOriginal(text, m.index!, m.index! + m[0].length);
  }

  // 2) Nomes de outros estados e gentílicos.
  const otherStates = [...original.matchAll(STATE_NAMES)].map((m) => m[1]);
  const demonym = OTHER_STATE_DEMONYMS.exec(text.folded)?.[0];
  const otherSpRegion = OTHER_SP_REGIONS.exec(text.folded)?.[0];
  const otherSpCities = [...new Set([...original.matchAll(OTHER_SP_CITY_MENTION)].map((m) => m[1] ?? m[2]))];

  // 3) Região metropolitana.
  const metro = METRO.exec(text.current);
  if (metro) {
    out.metroRegion = true;
    out.evidence.push({ label: 'região metropolitana', excerpt: text.excerpt(metro.index, metro.index + metro[0].length) });
    text.mask(metro.index, metro.index + metro[0].length);
  }

  // 4) Cidades monitoradas (nomes mais longos primeiro: "Santana de Parnaíba" antes de "Santana").
  const byLength = MONITORED.flatMap((c) => c.patterns.map((p) => ({ c, p }))).sort((a, b) => b.p.length - a.p.length);
  for (const { c, p } of byLength) {
    const r = new RegExp(`(?<![a-z0-9])${escape(p)}(?![a-z0-9])`, 'g');
    for (const m of [...text.current.matchAll(r)]) {
      const start = m.index!;
      const end = start + m[0].length;
      text.mask(start, end);
      if (c.ibge === SAO_PAULO_IBGE) {
        const window = text.folded.slice(Math.max(0, start - 60), end);
        if (SP_STATE_CONTEXT.test(window)) continue;
        if (otherSpCities.length > 0 && STATE_USAGE_BEFORE.test(text.folded.slice(Math.max(0, start - 60), start))) continue;
      }
      pushCity(out, positions, c, text.excerpt(start, end), start);
      const homonyms = (MUNICIPALITY_UFS.get(fold(c.name)) ?? []).filter((uf) => uf !== 'SP');
      if (homonyms.length > 0 && otherStates.some((s) => homonyms.some((uf) => UFS[uf] === s))) {
        out.ambiguities.push(`"${c.name}" também é município em ${homonyms.join(', ')}, estado citado no texto`);
      }
    }
  }

  // 5) Distritos da capital — só com contexto de São Paulo e preposição de lugar.
  const spContext =
    out.cities.some((c) => c.ibge === SAO_PAULO_IBGE) || SP_CITY_CONTEXT.test(text.folded) || ctx.sourceCityIbge === SAO_PAULO_IBGE;
  const districtsByLength = [...DISTRICTS].sort((a, b) => b.name.length - a.name.length);
  for (const d of districtsByLength) {
    const r = new RegExp(`${L}${escape(d.name)}${R}`, 'gu'); // case-sensitive: exige maiúscula
    for (const m of [...original.matchAll(r)]) {
      const before = fold(original.slice(Math.max(0, m.index! - 25), m.index!));
      if (!LOCATIVE_BEFORE.test(before)) continue;
      const key = fold(d.name);
      const otherUfs = (MUNICIPALITY_UFS.get(key) ?? []).filter((uf) => uf !== 'SP');
      if (foreign.some((f) => fold(f.split('/')[0]) === key)) continue; // "Lapa (PR)"
      if (!spContext) {
        if (!COMMON_WORD_DISTRICTS.has(key) && out.cities.length === 0 && otherUfs.length === 0) {
          out.ambiguities.push(`distrito "${d.name}" citado sem indicar a cidade`);
        }
        continue;
      }
      if (otherUfs.length > 0 && otherStates.some((s) => otherUfs.some((uf) => UFS[uf] === s))) {
        out.ambiguities.push(`"${d.name}" pode ser o município em ${otherUfs.join(', ')}`);
        continue;
      }
      // A frase do distrito precisa ser sobre o alagamento — ou ao menos não sobre outro incidente.
      // Caso real: "árvore cai sobre carros em Moema… ruas ficaram alagadas [na capital]".
      const [cs, ce] = text.clauseAt(m.index!);
      const clause = text.folded.slice(cs, ce);
      if (!mentionsFlood(clause) && OTHER_INCIDENT.test(clause)) continue;
      if (!out.districts.some((x) => x.ibge === d.ibge)) {
        out.districts.push(d);
        out.evidence.push({ label: 'distrito da capital', excerpt: m[0] });
      }
      maskOriginal(text, m.index!, m.index! + m[0].length);
    }
  }
  // A capital também é identificada por "zona sul", "cidade de São Paulo", distrito ou — em fonte
  // da própria capital — pela sigla ("Chuva em SP").
  const spAbbrev = /(?<![\p{L}])(?:em|de|na|no|da|do) SP(?![\p{L}])/u.exec(original);
  const spCityEvidence =
    out.districts.length > 0 ? 'distrito da capital'
    : SP_CITY_EXPLICIT.exec(text.folded)?.[0] ??
      (ctx.sourceCityIbge === SAO_PAULO_IBGE ? (SP_CITY_CONTEXT.exec(text.folded)?.[0] ?? spAbbrev?.[0] ?? null) : null);
  if (spCityEvidence && !out.cities.some((c) => c.ibge === SAO_PAULO_IBGE)) {
    pushCity(out, positions, MONITORED.find((c) => c.ibge === SAO_PAULO_IBGE)!, spCityEvidence, Number.MAX_SAFE_INTEGER);
  }
  // "São Paulo" solto + outra cidade paulista citada: pode ser o estado. Distritos ou "zona sul"
  // resolvem a dúvida; sem eles, vai para moderação.
  if (otherSpCities.length > 0 && out.districts.length === 0 && !SP_CITY_CONTEXT.test(text.folded) && out.cities.some((c) => c.ibge === SAO_PAULO_IBGE)) {
    out.ambiguities.push(`"São Paulo" pode ser o estado: o texto também cita ${otherSpCities.join(', ')}`);
  }

  // Ordem de menção no texto (a busca acima vai do nome mais longo ao mais curto).
  out.cities.sort((a, b) => (positions.get(a.ibge) ?? 0) - (positions.get(b.ibge) ?? 0));

  // 6) Logradouros e marcos (sem coordenadas ainda).
  const cityNames = new Set([...MUNICIPALITY_UFS.keys()]);
  for (const m of original.matchAll(PLACES)) {
    const place = m[0].replace(/[.,]$/, '').trim();
    const rest = fold(place.replace(/^\S+\s+(?:d[aeo]s?\s+)?/, ''));
    if (/^rio de janeiro|^rio grande/.test(fold(place)) || cityNames.has(rest) && /^rio\s/i.test(place)) continue;
    if (!out.places.includes(place)) out.places.push(place);
  }

  // 7) Fora da área e precisão.
  const foreignSignals = foreign.length + otherStates.length + (demonym ? 1 : 0) + (otherSpRegion ? 1 : 0) + otherSpCities.length;
  if (out.cities.length === 0 && !out.metroRegion && foreignSignals > 0) {
    out.outOfScope = true;
  } else if (out.cities.length > 0 && foreign.length > 0) {
    out.ambiguities.push(`também cita localidades fora da área monitorada: ${foreign.join(', ')}`);
  }
  if (otherSpCities.length > 0) {
    out.evidence.push({ label: 'município paulista fora da área monitorada', excerpt: otherSpCities.join(', ') });
  }

  if (out.districts.length === 1) out.precision = 'NEIGHBORHOOD';
  else if (out.districts.length > 1) out.precision = 'REGION';
  else if (out.cities.length === 1) out.precision = 'CITY';
  else if (out.cities.length > 1 || out.metroRegion) out.precision = 'REGION';
  return out;
}

function pushCity(out: LocationExtraction, positions: Map<string, number>, c: CityRef, excerpt: string, position: number): void {
  if (!positions.has(c.ibge) || position < positions.get(c.ibge)!) positions.set(c.ibge, position);
  if (out.cities.some((x) => x.ibge === c.ibge)) return;
  out.cities.push({ ibge: c.ibge, name: c.name, state: c.state });
  out.evidence.push({ label: 'cidade', excerpt });
}

/** Mascara no texto dobrado um trecho achado no texto ORIGINAL (os índices coincidem quando a dobra preserva o comprimento). */
function maskOriginal(text: FoldedText, start: number, end: number): void {
  // FoldedText preserva o comprimento para letras latinas comuns (á → a), então os índices coincidem.
  if (text.folded.length === text.original.length) text.mask(start, end);
}

export const MONITORED_CITIES: readonly CityRef[] = MONITORED.map(({ ibge, name, state }) => ({ ibge, name, state }));
