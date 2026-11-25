import { CollectOutput, NewsSourceAdapter, SourceConfig } from './adapter';
import { FetchError, fetchText, FetchOptions } from './http';
import { parseFeed, RawNewsItem } from './rss';

type HttpOpts = Pick<FetchOptions, 'etag' | 'lastModified' | 'allowPrivateNetwork' | 'timeoutMs'>;

/**
 * Alguns portais embrulham o link num redirecionador de métricas
 * (Folha: `https://redir.folha.com.br/redir/online/cotidiano/rss091/*https://www1.folha.uol.com.br/...`).
 * Guardamos o destino real — é ele que identifica a notícia e é para ele que o usuário vai.
 */
export function unwrapRedirectLink(url: string): string {
  const star = /^https?:\/\/[^/]*redir[^/]*\/.*?\*(https?:\/\/.+)$/i.exec(url);
  return star ? star[1] : url;
}

export class RssAdapter implements NewsSourceAdapter {
  readonly type = 'RSS' as const;

  async collect(source: SourceConfig, http: HttpOpts): Promise<CollectOutput> {
    const res = await fetchText(source.feedUrl, http);
    if (res.notModified) return { items: [], httpStatus: 304, notModified: true, etag: res.etag ?? http.etag ?? null, lastModified: res.lastModified ?? http.lastModified ?? null };
    let items: RawNewsItem[];
    try {
      items = parseFeed(res.body);
    } catch (error) {
      // Feed quebrado ou página de erro no lugar do feed: permanente até alguém olhar a fonte.
      throw new FetchError(`feed inválido: ${(error as Error).message}`, false, res.status);
    }
    return {
      items: items.map((i) => ({ ...i, url: unwrapRedirectLink(i.url) })),
      httpStatus: res.status,
      notModified: false,
      etag: res.etag,
      lastModified: res.lastModified,
    };
  }
}

/**
 * GDELT DOC 2.0 (https://api.gdeltproject.org/api/v2/doc/doc). Gratuito e aberto, mas pede no
 * máximo 1 requisição a cada 5 s — e responde 429 com texto puro quando excedido.
 * Não traz resumo: só título, URL, domínio, idioma e "seendate" (quando o GDELT viu a matéria).
 */
export interface GdeltConfig {
  query: string;
  timespan?: string;
  maxRecords?: number;
}

interface GdeltArticle {
  url?: string;
  title?: string;
  seendate?: string;
  domain?: string;
  language?: string;
}

export function buildGdeltUrl(base: string, cfg: GdeltConfig): string {
  const u = new URL(base);
  u.searchParams.set('query', cfg.query);
  u.searchParams.set('mode', 'artlist');
  u.searchParams.set('format', 'json');
  u.searchParams.set('sort', 'datedesc');
  u.searchParams.set('maxrecords', String(Math.min(cfg.maxRecords ?? 75, 250)));
  u.searchParams.set('timespan', cfg.timespan ?? '1d');
  return u.toString();
}

/** "20261124T101500Z" → Date (UTC). */
export function parseGdeltDate(s: string | undefined): Date | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s ?? '');
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])) : null;
}

export function parseGdeltResponse(body: string): RawNewsItem[] {
  const text = body.trim();
  if (!text.startsWith('{')) {
    // O GDELT devolve mensagens de erro/limite em texto puro, às vezes com HTTP 200.
    const limited = /limit requests/i.test(text);
    throw new FetchError(`GDELT: ${text.slice(0, 160)}`, limited, limited ? 429 : null, limited ? 5_000 : null);
  }
  let json: { articles?: GdeltArticle[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new FetchError('GDELT: JSON inválido', true);
  }
  return (json.articles ?? [])
    .filter((a): a is Required<Pick<GdeltArticle, 'url' | 'title'>> & GdeltArticle => !!a.url && !!a.title)
    .map((a) => ({
      externalId: null,
      title: a.title.trim(),
      url: a.url,
      // seendate = quando o GDELT encontrou a matéria; é o melhor indicador de atualidade disponível.
      publishedAt: parseGdeltDate(a.seendate),
      summary: null,
      author: null,
    }));
}

export class GdeltAdapter implements NewsSourceAdapter {
  readonly type = 'GDELT' as const;

  async collect(source: SourceConfig, http: HttpOpts): Promise<CollectOutput> {
    const cfg = source.config as unknown as GdeltConfig;
    if (!cfg?.query) throw new FetchError('fonte GDELT sem "query" em config', false);
    const res = await fetchText(buildGdeltUrl(source.feedUrl, cfg), { ...http, accept: 'application/json', etag: null, lastModified: null });
    return { items: parseGdeltResponse(res.body), httpStatus: res.status, notModified: false, etag: null, lastModified: null };
  }
}

export function adapterFor(type: SourceConfig['type']): NewsSourceAdapter {
  switch (type) {
    case 'RSS':
      return new RssAdapter();
    case 'GDELT':
      return new GdeltAdapter();
    default:
      throw new Error(`Sem conector para fontes do tipo ${type}`);
  }
}
