import { createHash } from 'node:crypto';

/** Parâmetros de rastreamento que não mudam o conteúdo da página. */
const TRACKING_PARAMS = /^(utm_[a-z_]+|fbclid|gclid|dclid|mc_cid|mc_eid|igshid|ref|ref_src|cmpid|origin|xtor|_ga|amp)$/i;

/**
 * URL canônica para deduplicação. A mesma notícia chega por caminhos diferentes:
 * `https://m.portal.com.br/noticia/x/?utm_source=rss#top`, `http://www.portal.com.br/noticia/x`,
 * `https://portal.com.br/noticia/x/amp`… todas viram `https://portal.com.br/noticia/x`.
 *
 * Retorna null para URLs que não são http(s) — essas nunca são armazenadas nem abertas.
 */
export function canonicalizeUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;

  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
  url.port = '';
  url.hash = '';

  const kept = [...url.searchParams.entries()]
    .filter(([k]) => !TRACKING_PARAMS.test(k))
    .sort(([a], [b]) => a.localeCompare(b));
  url.search = '';
  for (const [k, v] of kept) url.searchParams.append(k, v);

  let path = url.pathname.replace(/\/{2,}/g, '/');
  path = path.replace(/\/amp(\.html)?\/?$/i, '/').replace(/\.amp(\.html)?$/i, '');
  if (path.length > 1) path = path.replace(/\/+$/, '');
  url.pathname = path;

  return url.toString();
}

export function urlHash(canonicalUrl: string): string {
  return createHash('sha256').update(canonicalUrl).digest('hex');
}

/** Domínio registrável aproximado (sem subdomínios comuns), usado para medir independência de fontes. */
export function sourceDomain(url: string): string {
  const host = new URL(url).hostname.toLowerCase().replace(/^(www|m|amp|mobile)\./, '');
  const parts = host.split('.');
  // .com.br, .gov.br, .org.br… guardam 3 partes; demais, 2. Órgãos estaduais/municipais
  // (osasco.sp.gov.br, defesacivil.sp.gov.br) guardam 4: são emissores diferentes.
  const n = parts.length;
  const countryLevel = n >= 3 && parts[n - 1].length === 2 && parts[n - 2].length <= 3;
  const stateGov = countryLevel && n >= 4 && parts[n - 2] === 'gov' && parts[n - 3].length === 2;
  const keep = stateGov ? 4 : countryLevel ? 3 : 2;
  return parts.slice(-keep).join('.');
}
