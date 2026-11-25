import { fold } from './normalize';

/**
 * Texto comparável (sem acentos, minúsculo) que lembra de onde veio cada caractere.
 * As regras casam padrões no texto dobrado, mas a evidência guardada é o trecho ORIGINAL
 * — o moderador vê exatamente o que a fonte escreveu.
 */
export class FoldedText {
  readonly folded: string;
  private readonly map: number[] = [];
  private masked: string;

  constructor(readonly original: string) {
    let out = '';
    const chars = [...original];
    let offset = 0;
    for (const ch of chars) {
      const f = fold(ch);
      for (let k = 0; k < f.length; k++) this.map.push(offset);
      out += f;
      offset += ch.length;
    }
    this.map.push(original.length);
    this.folded = out;
    this.masked = out;
  }

  /** Texto dobrado com os trechos já consumidos substituídos por espaços. */
  get current(): string {
    return this.masked;
  }

  /** Consome um trecho: padrões aplicados depois não o veem mais (evita contar a mesma evidência duas vezes). */
  mask(start: number, end: number): void {
    this.masked = this.masked.slice(0, start) + ' '.repeat(end - start) + this.masked.slice(end);
  }

  /** Trecho original correspondente ao intervalo [start, end) do texto dobrado. */
  excerpt(start: number, end: number): string {
    return this.original.slice(this.map[start], this.map[Math.max(start, end - 1)] + 1).trim();
  }

  /** Intervalos de frases/orações (separadores: . ; ! ? quebra de linha, ", mas"). */
  clauseRanges(): Array<[number, number]> {
    const ranges: Array<[number, number]> = [];
    const sep = /[.;!?\n]+|,\s*(?:mas|porem|contudo|entretanto)\s+/g;
    let last = 0;
    for (const m of this.folded.matchAll(sep)) {
      if (m.index! > last) ranges.push([last, m.index!]);
      last = m.index! + m[0].length;
    }
    if (last < this.folded.length) ranges.push([last, this.folded.length]);
    return ranges;
  }

  clauseAt(index: number): [number, number] {
    return this.clauseRanges().find(([s, e]) => index >= s && index < e) ?? [0, this.folded.length];
  }
}
