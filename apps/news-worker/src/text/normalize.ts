/**
 * Normalização de texto usada por todas as regras.
 * Tudo é comparado SEM acentos e em minúsculas ("Carapicuíba" ≡ "carapicuiba").
 */

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú',
  agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç',
  ldquo: '"', rdquo: '"', lsquo: "'", rsquo: "'", ndash: '–', mdash: '—', hellip: '…',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return NAMED_ENTITIES[code] ?? m;
  });
}

/** Remove HTML (resumos de feeds costumam trazer <p>, <img>, <a>) e compacta espaços. */
export function stripHtml(s: string): string {
  const noTags = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/p>/gi, '. ')
    .replace(/<[^>]+>/g, ' ');
  return decodeEntities(noTags).replace(/\s+/g, ' ').replace(/(\.\s*){2,}/g, '. ').trim();
}

/** Sem acentos, minúsculas, apóstrofos tipográficos unificados. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[’‘`´]/g, "'")
    .toLowerCase();
}

const STOPWORDS = new Set(
  'a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela pelos pelas para pra com sem e ou que se ao aos apos ate sobre entre como mais menos ja nesta neste nessa nesse esta este isso foi sao ser tem ha apos durante'.split(' '),
);

/** Tokens significativos (sem acento, sem stopwords, ≥ 3 letras). */
export function tokens(s: string): string[] {
  return fold(s)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

export function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Divide em trechos (frases/orações) para que negações e modalizadores não vazem entre frases. */
export function clauses(s: string): string[] {
  return s
    .split(/[.;!?\n]+|,\s*(?:mas|porem|contudo|entretanto)\s+/i)
    .map((c) => c.trim())
    .filter(Boolean);
}
