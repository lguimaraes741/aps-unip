import { FoldedText } from '../text/folded';
import { ArticleText, EventType, Evidence, RULES_VERSION, Severity, SEVERITY_ORDER, Temporality } from '../types';

/**
 * Camadas 1 e 2 da análise (docs/architecture/07-news-intelligence.md, 7.5 e 7.7):
 * regras determinísticas sobre título + resumo. Não usa rede nem modelo de linguagem.
 *
 * Princípios:
 *  - gravidade vem de FATOS relatados (ilhados, via interditada…), nunca de adjetivos;
 *  - negação ("não houve ilhados") e modalização ("pode transbordar") anulam a evidência;
 *  - sem evidência de impacto, a gravidade é NULA ("não informada") — nunca "baixa".
 */

/** Publicações mais antigas que isto não descrevem situação atual. */
export const CURRENT_WINDOW_HOURS = 72;

export interface RuleAnalysis {
  rulesVersion: string;
  isRelevant: boolean;
  irrelevantReason: string | null;
  eventType: EventType | null;
  temporality: Temporality;
  temporalityReasons: string[];
  severity: Severity | null;
  /** Evidências aceitas, da mais grave para a menos grave. */
  severityEvidence: Array<Evidence & { severity: Severity }>;
  /** Evidências encontradas mas anuladas por negação/modalização (transparência para o moderador). */
  discardedEvidence: Array<Evidence & { why: 'negação' | 'possibilidade/previsão' }>;
  consequences: string[];
  alarmistLanguage: boolean;
  timeHints: string[];
  missing: string[];
  /** Caso ambíguo: candidato à camada 3 (modelo de linguagem) ou à moderação. */
  needsReview: boolean;
}

// ---------------------------------------------------------------------------
// Padrões (texto sem acento, minúsculo). `B`/`E` = fronteira de palavra.
// ---------------------------------------------------------------------------

const B = '(?<![a-z0-9])';
const E = '(?![a-z0-9])';
const re = (body: string) => new RegExp(`${B}(?:${body})${E}`, 'g');

const FLOOD_TERMS = re(
  "alag(?:a|am|ou|aram|ado|ada|ados|adas|amento|amentos|ando|ar)|enchentes?|inund(?:a|am|ou|aram|ado|ada|ados|adas|acao|acoes|ar)|transbord\\w*|enxurradas?|cheias? d[oe]s? (?:rio|corrego|ribeirao)|debaixo d'?agua|agua invad\\w*|invadid[oa]s? pela agua",
);
/** Impacto típico de enchente, mas que só conta COM contexto de chuva ("ilhados" também ocorre em bloqueios de rodovia). */
const IMPACT_TERMS = re('ilhad[oa]s?|desabrigad[oa]s?|desalojad[oa]s?|resgat\\w+');
const RAIN_TERMS = re('chuvas?|temporal|temporais|tempestades?|aguaceiro');
/** Usos figurados que não são alagamento ("enxurrada de críticas"). */
const METAPHORS = re(
  '(?:enxurradas?|inundad[oa]s?|inund(?:a|am|ou|aram)) de (?:criticas|mensagens|pedidos|reclamacoes|processos|ligacoes|fake news|informacoes|candidatos|turistas|propostas|ofertas|emails|comentarios|memes)',
);

const OCCURRENCE = [
  re('alaga|alagam|alagou|alagaram|inunda|inundou|inundaram|transborda|transbordou|transbordaram|invade|invadiu|invadiram|ilhad[oa]s?|resgat(?:e|es|a|am|ou|aram|ado|ados|ada|adas)|arrastad[oa]s?'),
  re('(?:provoca|provocou|provocam|provocaram|causa|causou|causam|causaram|deixa|deixou|deixam|deixaram|registra|registrou|registram|registraram|teve|tem|gera|gerou|forma|formou)[^.;]{0,60}?(?:alagamentos?|enchentes?|inundac(?:ao|oes)|pontos? de alagamento|ruas? alagadas?)'),
  re("(?:ficam|ficou|ficaram|fica|esta|estao|seguem|segue|amanhece|amanheceu|continuam|continua)\\s+(?:\\w+\\s+)?(?:alagad[oa]s?|inundad[oa]s?|debaixo d'?agua|submers[oa]s?|interditad[oa]s?)"),
  re('(?:ruas?|avenidas?|vias?|casas|imoveis|bairros?|tune(?:l|is)|marginal|estacao|estacoes|corredor)\\s+(?:\\w+\\s+){0,3}?(?:alagad[oa]s?|inundad[oa]s?)'),
  re('pontos? de alagamento'),
  // Casos reais do g1 (24/11/2026): "deixa carros submersos", "Túnel Anhangabaú foi bloqueado".
  re("(?:deixa|deixou|deixam|deixaram) (?:\\w+ ){0,3}?(?:submers[oa]s|alagad[oa]s?|ilhad[oa]s|desalojad[oa]s|desabrigad[oa]s|interditad[oa]s?|debaixo d'?agua)"),
  re('(?:foi|foram|esta|estao|segue|seguem) (?:\\w+ )?(?:bloquead[oa]s?|interditad[oa]s?|fechad[oa]s?|alagad[oa]s?|inundad[oa]s?)'),
  re('interdita|interditam|interditou|interditaram|bloqueia|bloqueiam|bloqueou|bloquearam'),
  // Alagamento/chuva como SUJEITO: "Alagamento deixa trânsito lento", "Temporal atinge bairros".
  re('(?:alagamentos?|enchentes?|inundac(?:ao|oes)|chuvas?|temporal|temporais|tempestades?|aguas?|enxurradas?) (?:\\w+ ){0,3}?(?:deixa|deixou|deixam|deixaram|provoca|provocou|causa|causou|atinge|atingiu|atingem|atingiram|complica|complicou|afeta|afetou|fecha|fechou|arrasta|arrastou)'),
  re('(?:familias|pessoas|moradores|criancas|idosos) (?:\\w+ ){0,2}?(?:desalojad[oa]s|desabrigad[oa]s|ilhad[oa]s)'),
];

const PREVENTION = re(
  'para (?:prevenir|evitar|reduzir|combater|conter|minimizar)|contra (?:alagamentos|enchentes|inundacoes)|anuncia|anunciou|inaugura|inaugurou|entrega|entregou|investe|investimento|licitacao|lanca|lancou|prevencao|antienchentes?|combate as? (?:enchentes|alagamentos)|piscinao|piscinoes|desassoreamento|limpeza de (?:bueiros|galerias|corregos)',
);
const FORECAST = re(
  'previsao|preve|prevista|previsto|alerta (?:para|de) (?:chuvas?|temporais?|tempestades?|risco)|podem? (?:alagar|causar|provocar|transbordar|chover|haver|ocorrer)|devem? (?:chover|causar|provocar|ocorrer)|risco (?:de|para) (?:alagamentos?|enchentes?|inundac(?:ao|oes)|transbordamentos?)|frente fria|estado de atencao|aviso de (?:chuva|tempestade)|proxim(?:os|as) (?:dias|horas)',
);
/** Enquadram a notícia inteira no passado ("Há 10 anos, enchente…"). */
const HISTORICAL_FRAME = re('ha \\d+ anos|anos depois|relembr\\w+|aniversario|memoria|marcou a historia');
/** Só comparam com o passado ("repete cenário de 2011"): valem apenas se não houver relato de ocorrência. */
const PAST_REFERENCE = re('ano passado|(?:em|de) (?:19|20)\\d\\d');
/** "liberada" só conta perto de uma via ("verba liberada para obras" não é normalização). */
const RESOLVED = re(
  "(?:vias?|avenidas?|ruas?|pistas?|faixas?|pontes?|tune(?:l|is)|marginal|marginais|trechos?|estradas?|rodovias?|acessos?|passagem|estac(?:ao|oes)|viadutos?)[^.;]{0,40}?(?:liberad[oa]s?|reabert[oa]s?|desinterditad[oa]s?)|(?:liberad[oa]s?|reabert[oa]s?) (?:para o|ao) (?:trafego|transito)|agua (?:ja )?(?:baixou|escoou|recuou)|nivel d[oe] (?:rio|corrego) (?:baixa|baixou|recua|recuou)|(?:transito|situacao|circulacao) (?:normalizad[oa]|volta ao normal|se normaliza)|sem pontos de alagamento|encerr\\w+ (?:o )?estado de (?:alerta|atencao)",
);

const ALARMIST = re('caos|caotic[oa]s?|tragedia|diluvio|apocalip\\w*|cenario de guerra|assustador\\w*|terror|desespero|catastrof\\w*|devastador\\w*|fim do mundo');

const NEGATION = /(?<![a-z])(?:nao|nem|nenhum|nenhuma|ninguem|sem)(?![a-z])[^]*$/;
const MODAL = /(?<![a-z])(?:pode|podem|poderia|poderao|risco|possibilidade|chance|deve|devem|evitar|prevenir|caso|previsao|alerta para)(?![a-z])[^]*$/;
const LOOKBEHIND_CHARS = 35;

interface SeverityPattern {
  severity: Severity;
  label: string;
  pattern: RegExp;
}

/**
 * ORDEM IMPORTA: cada casamento consome o trecho (FoldedText.mask). Por isso os padrões
 * mais específicos vêm antes ("faixa interditada" = MODERADO antes de "interditada" = ALTO;
 * "carros ilhados" = ALTO antes de "ilhados" = CRÍTICO).
 */
const SEVERITY_PATTERNS: SeverityPattern[] = [
  { severity: 'MODERATE', label: 'via parcialmente afetada', pattern: re('parcialmente (?:interditad[oa]s?|bloquead[oa]s?|alagad[oa]s?)|(?:uma das |duas )?faixas? (?:\\w+ ){0,3}?(?:interditad[oa]s?|bloquead[oa]s?)') },
  { severity: 'HIGH', label: 'veículos ilhados ou submersos', pattern: re('(?:carros?|veiculos?|onibus|caminh(?:ao|oes)|motos?) (?:\\w+ ){0,2}?(?:ilhad[oa]s?|submers[oa]s?|boiando|arrastad[oa]s?)') },

  { severity: 'CRITICAL', label: 'pessoas ilhadas', pattern: re('ilhad[oa]s?') },
  { severity: 'CRITICAL', label: 'resgate em andamento ou realizado', pattern: re('resgat(?:e|es|a|am|ou|aram|ado|ados|ada|adas|ando)') },
  { severity: 'CRITICAL', label: 'pessoa arrastada pela água', pattern: re('(?:arrastad[oa]s?|levad[oa]s?) pela (?:correnteza|enxurrada|agua|forca da agua)') },
  {
    severity: 'CRITICAL',
    label: 'pessoa arrastada pela água',
    pattern: re('(?:enxurradas?|correntezas?|aguas?) (?:\\w+ ){0,2}?(?:arrast|lev)(?:a|am|ou|aram) (?:\\w+ ){0,3}?(?:pessoas?|homem|homens|mulher|mulheres|crianca|criancas|idos[oa]s?|jovens?|moradore?s?|motoristas?|familias?|bebe)'),
  },
  { severity: 'CRITICAL', label: 'desaparecidos', pattern: re('desaparecid[oa]s?|desaparec(?:e|eu|eram|em)|buscas? (?:por|de) (?:uma |um )?(?:pessoas?|mulher|homem|crianca|jovem|idos[oa]|morador[a]?|vitimas?)') },
  { severity: 'CRITICAL', label: 'pessoa arrastada pela água', pattern: re('(?:arrastad[oa]s?|levad[oa]s?|caiu|cairam) (?:por|em|no|na|para dentro de) (?:um |uma |o |a )?(?:rio|corrego|ribeirao|canal|bueiro|galeria)') },
  { severity: 'CRITICAL', label: 'mortes', pattern: re('morre|morreu|morreram|mortes?|mort[oa]s|obitos?|vitimas? fata(?:l|is)|sem vida') },
  { severity: 'CRITICAL', label: 'evacuação', pattern: re('evacu(?:a|am|ou|aram|ada|adas|ado|ados|acao|acoes)') },
  { severity: 'CRITICAL', label: 'desabrigados', pattern: re('desabrigad[oa]s?') },
  { severity: 'CRITICAL', label: 'emergência ou calamidade decretada', pattern: re('calamidade publica|situacao de emergencia') },

  { severity: 'HIGH', label: 'imóveis interditados', pattern: re('(?:imoveis|casas|predios|residencias|moradias|escolas) (?:\\w+ ){0,2}?interditad[oa]s') },
  { severity: 'HIGH', label: 'via interditada', pattern: re('interditad[oa]s?|interdit(?:a|am|ou|aram)|interdicao|interdicoes|bloquead[oa]s?|bloque(?:ia|iam|ou|aram)|fechad[oa]s? (?:para|ao) (?:o )?transito|intransitave(?:l|is)') },
  { severity: 'HIGH', label: 'transbordamento de rio ou córrego', pattern: re('transbord(?:a|am|ou|aram|ando|amento|amentos)') },
  { severity: 'HIGH', label: 'imóveis atingidos', pattern: re("(?:invad\\w*|atingi\\w*|inund\\w*|alag\\w*|entrou|entra) (?:\\w+ ){0,3}?(?:casas|imoveis|residencias|moradias|comercios|lojas|predios|escolas|hospita(?:l|is))|(?:casas|imoveis|residencias|moradias|comercios|lojas) (?:\\w+ ){0,2}?(?:alagad[oa]s|inundad[oa]s|invadid[oa]s|atingid[oa]s)") },
  { severity: 'HIGH', label: 'desalojados', pattern: re('desalojad[oa]s?') },
  { severity: 'HIGH', label: 'alagamento extenso', pattern: re('alagamentos? (?:extensos?|de grandes proporcoes)|bairros? inteiros?') },

  { severity: 'MODERATE', label: 'impacto no trânsito', pattern: re('lentidao|congestionamentos?|transito (?:lento|complicado|intenso|travado|parado)|km de (?:lentidao|congestionamento)') },
  { severity: 'MODERATE', label: 'via transitável com dificuldade', pattern: re('transitave(?:l|is)|dificuldade (?:de|para) (?:circular|passar|transitar)') },

  { severity: 'LOW', label: 'acúmulo pontual de água', pattern: re("acumulo de agua|bols(?:ao|oes) d[e']\\s?agua|pocas d'?agua|alagamento pontual|pequenos? transtornos?|sem (?:grandes )?transtornos") },
];

const TIME_HINTS = re(
  'nesta (?:segunda|terca|quarta|quinta|sexta)(?:-feira)?|neste (?:sabado|domingo)|hoje|ontem|(?:na|nesta) (?:manha|tarde|noite|madrugada)|\\d{1,2}h(?:\\d{2})?',
);

// ---------------------------------------------------------------------------

/**
 * Pré-filtro da coleta (camada 1): o item fala de alagamento? Só esses são armazenados —
 * guardar centenas de notícias alheias ao tema não tem utilidade e amplia o que copiamos das fontes.
 */
/** Um trecho (já sem acentos) fala de alagamento ou de impacto típico de enchente? Usado pela extração de local. */
export function mentionsFlood(foldedClause: string): boolean {
  return has(FLOOD_TERMS, foldedClause) || has(IMPACT_TERMS, foldedClause) || /submers|arrastad|virarem rios/.test(foldedClause);
}

export function isFloodCandidate(title: string, summary: string | null): boolean {
  const text = new FoldedText([title, summary ?? ''].filter(Boolean).join('. '));
  for (const m of text.folded.matchAll(METAPHORS)) text.mask(m.index!, m.index! + m[0].length);
  return has(FLOOD_TERMS, text.current) || (has(IMPACT_TERMS, text.current) && has(RAIN_TERMS, text.current));
}

export function analyzeByRules(article: ArticleText, now: Date = new Date()): RuleAnalysis {
  const text = new FoldedText([article.title, article.summary ?? ''].filter(Boolean).join('. '));

  const result: RuleAnalysis = {
    rulesVersion: RULES_VERSION,
    isRelevant: false,
    irrelevantReason: null,
    eventType: null,
    temporality: 'UNCERTAIN',
    temporalityReasons: [],
    severity: null,
    severityEvidence: [],
    discardedEvidence: [],
    consequences: [],
    alarmistLanguage: false,
    timeHints: [],
    missing: [],
    needsReview: false,
  };

  for (const m of text.folded.matchAll(METAPHORS)) text.mask(m.index!, m.index! + m[0].length);
  if (!has(FLOOD_TERMS, text.current) && !(has(IMPACT_TERMS, text.current) && has(RAIN_TERMS, text.current))) {
    result.irrelevantReason = 'Não menciona alagamento, enchente, inundação ou transbordamento (nem impacto com chuva)';
    return result;
  }
  result.isRelevant = true;

  const f = text.current;
  result.eventType = /transbord/.test(f) && /(?<![a-z])(?:rio|rios|corregos?|ribeirao|represa)(?![a-z])/.test(f)
    ? 'RIVER_OVERFLOW'
    : /enxurrada/.test(f)
      ? 'FLASH_FLOOD'
      : 'FLOODING';

  const t = classifyTemporality(text, article.publishedAt, now);
  result.temporality = t.temporality;
  result.temporalityReasons = t.reasons;

  // Gravidade: padrões em ordem, consumindo os trechos casados.
  for (const p of SEVERITY_PATTERNS) {
    for (const m of [...text.current.matchAll(p.pattern)]) {
      const start = m.index!;
      const end = start + m[0].length;
      const excerpt = text.excerpt(start, end);
      text.mask(start, end);
      const [clauseStart] = text.clauseAt(start);
      const before = text.folded.slice(Math.max(clauseStart, start - LOOKBEHIND_CHARS), start);
      if (NEGATION.test(before)) {
        result.discardedEvidence.push({ label: p.label, excerpt, why: 'negação' });
      } else if (MODAL.test(before)) {
        result.discardedEvidence.push({ label: p.label, excerpt, why: 'possibilidade/previsão' });
      } else {
        result.severityEvidence.push({ label: p.label, excerpt, severity: p.severity });
      }
    }
  }
  result.severityEvidence.sort((a, b) => SEVERITY_ORDER.indexOf(b.severity) - SEVERITY_ORDER.indexOf(a.severity));
  result.severity = result.severityEvidence[0]?.severity ?? null;
  result.consequences = [...new Set(result.severityEvidence.map((e) => e.label))];
  result.alarmistLanguage = has(ALARMIST, text.folded);
  result.timeHints = [...text.folded.matchAll(TIME_HINTS)].map((m) => text.excerpt(m.index!, m.index! + m[0].length));

  if (result.severity === null) result.missing.push('gravidade: nenhum impacto concreto descrito');
  if (result.timeHints.length === 0) result.missing.push('horário do evento');
  if (!article.publishedAt) result.missing.push('data de publicação');

  result.needsReview =
    result.temporality === 'UNCERTAIN' ||
    (result.temporality === 'CURRENT' && result.severity === null) ||
    (result.alarmistLanguage && result.severity === null);
  return result;
}

function classifyTemporality(text: FoldedText, publishedAt: Date | null, now: Date): { temporality: Temporality; reasons: string[] } {
  const f = text.current;
  const found = (r: RegExp) => [...f.matchAll(r)].map((m) => text.excerpt(m.index!, m.index! + m[0].length));

  const resolved = found(RESOLVED);
  if (resolved.length > 0) return { temporality: 'RESOLVED', reasons: resolved.map((e) => `indica normalização: "${e}"`) };

  const currentYear = now.getUTCFullYear();
  const frame = found(HISTORICAL_FRAME);
  if (frame.length > 0) return { temporality: 'HISTORICAL', reasons: frame.map((e) => `referência ao passado: "${e}"`) };

  if (publishedAt) {
    const ageHours = (now.getTime() - publishedAt.getTime()) / 3_600_000;
    if (ageHours > CURRENT_WINDOW_HOURS) {
      return { temporality: 'HISTORICAL', reasons: [`publicada há ${Math.floor(ageHours)} h (limite ${CURRENT_WINDOW_HOURS} h)`] };
    }
    if (ageHours < -1) return { temporality: 'UNCERTAIN', reasons: ['data de publicação no futuro'] };
  }

  const occurrence = OCCURRENCE.flatMap(found);
  const past = found(PAST_REFERENCE).filter((e) => Number(/(?:19|20)\d\d/.exec(e)?.[0] ?? 0) < currentYear);
  if (occurrence.length === 0 && past.length > 0) {
    return { temporality: 'HISTORICAL', reasons: past.map((e) => `referência ao passado: "${e}"`) };
  }
  const prevention = found(PREVENTION);
  const forecast = found(FORECAST);

  if (occurrence.length > 0) {
    if (prevention.length > 0) {
      return { temporality: 'UNCERTAIN', reasons: [`relata ocorrência ("${occurrence[0]}") mas o foco parece ser ação preventiva ("${prevention[0]}")`] };
    }
    if (!publishedAt) return { temporality: 'UNCERTAIN', reasons: ['relata ocorrência, mas sem data de publicação para confirmar que é atual'] };
    return { temporality: 'CURRENT', reasons: occurrence.slice(0, 3).map((e) => `relata ocorrência: "${e}"`) };
  }
  if (prevention.length > 0) return { temporality: 'PREVENTION', reasons: prevention.slice(0, 3).map((e) => `ação preventiva: "${e}"`) };
  if (forecast.length > 0) return { temporality: 'FORECAST', reasons: forecast.slice(0, 3).map((e) => `previsão/risco: "${e}"`) };
  return { temporality: 'UNCERTAIN', reasons: ['menciona alagamento sem verbo de ocorrência, previsão ou prevenção'] };
}

/** RegExp com flag g guarda lastIndex entre chamadas de test(); zera antes de usar. */
function has(r: RegExp, s: string): boolean {
  r.lastIndex = 0;
  const ok = r.test(s);
  r.lastIndex = 0;
  return ok;
}
