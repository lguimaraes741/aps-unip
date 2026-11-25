import { XMLParser } from 'fast-xml-parser';
import { stripHtml, truncate } from '../text/normalize';

/**
 * Leitura de feeds RSS 2.0 e Atom. Guarda apenas o que o próprio feed publica
 * (título, link, data, autor, resumo) — nunca busca o artigo completo.
 */

export const SUMMARY_MAX = 500;

export interface RawNewsItem {
  externalId: string | null;
  title: string;
  url: string;
  publishedAt: Date | null;
  summary: string | null;
  author: string | null;
}

export class FeedParseError extends Error {}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  processEntities: true,
  htmlEntities: true,
  // Proteção contra "billion laughs": entidades declaradas no DOCTYPE não são expandidas.
  ignoreDeclaration: true,
  ignorePiTags: true,
  isArray: (name) => name === 'item' || name === 'entry' || name === 'link',
});

export function parseFeed(xml: string): RawNewsItem[] {
  if (/<!ENTITY/i.test(xml)) throw new FeedParseError('Feed declara entidades XML (recusado por segurança)');
  let doc: Record<string, any>;
  try {
    doc = parser.parse(xml, true);
  } catch (error) {
    throw new FeedParseError(`XML inválido: ${(error as Error).message}`);
  }

  const rssItems: any[] | undefined = doc?.rss?.channel?.item ?? doc?.['rdf:RDF']?.item;
  const atomEntries: any[] | undefined = doc?.feed?.entry;
  if (!rssItems && !atomEntries) {
    if (doc?.rss?.channel || doc?.feed) return []; // feed válido, sem itens
    throw new FeedParseError('Documento não é RSS nem Atom');
  }

  const items = rssItems ? rssItems.map(fromRss) : atomEntries!.map(fromAtom);
  return items.filter((i): i is RawNewsItem => i !== null);
}

function text(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number') return String(v);
  if (typeof v === 'object' && '#text' in (v as object)) return String((v as Record<string, unknown>)['#text']);
  return null;
}

function cleanSummary(v: unknown): string | null {
  const raw = text(v);
  if (!raw) return null;
  const clean = stripHtml(raw);
  return clean ? truncate(clean, SUMMARY_MAX) : null;
}

function date(v: unknown): Date | null {
  const raw = text(v);
  if (!raw) return null;
  const d = new Date(raw.trim());
  return Number.isNaN(d.getTime()) ? null : d;
}

function fromRss(item: any): RawNewsItem | null {
  const title = text(item.title);
  const link = (item.link as unknown[] | undefined)?.map(text).find(Boolean) ?? null;
  const guid = text(item.guid);
  const url = link ?? (guid && /^https?:\/\//.test(guid) ? guid : null);
  if (!title || !url) return null;
  return {
    externalId: guid,
    title: stripHtml(title),
    url: url.trim(),
    publishedAt: date(item.pubDate ?? item['dc:date']),
    summary: cleanSummary(item.description ?? item['content:encoded']),
    author: text(item['dc:creator'] ?? item.author),
  };
}

function fromAtom(entry: any): RawNewsItem | null {
  const title = text(entry.title);
  const links = (entry.link as any[] | undefined) ?? [];
  const alternate = links.find((l) => !l['@rel'] || l['@rel'] === 'alternate') ?? links[0];
  const url = alternate?.['@href'] as string | undefined;
  if (!title || !url) return null;
  return {
    externalId: text(entry.id),
    title: stripHtml(title),
    url: url.trim(),
    publishedAt: date(entry.published ?? entry.updated),
    summary: cleanSummary(entry.summary ?? entry.content),
    author: text(entry.author?.name),
  };
}
