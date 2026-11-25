import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

/**
 * Cliente HTTP dos conectores. Regras (docs/architecture/07-news-intelligence.md, 7.2 e 7.3):
 *  - timeout e tamanho máximo: uma fonte lenta ou enorme não trava o worker;
 *  - 429/503 respeitam `Retry-After`; 5xx e falhas de rede são temporários; demais 4xx, permanentes;
 *  - só http(s), no máximo 3 redirecionamentos, e nunca endereços internos (SSRF) — a URL de uma
 *    fonte ou um redirecionamento não pode fazer o worker acessar a rede interna;
 *  - decodifica o charset declarado (a Folha publica em ISO-8859-1);
 *  - requisição condicional (ETag/Last-Modified) para não baixar o mesmo feed à toa.
 */

/**
 * O `fetch` nativo desiste de CONECTAR em 10 s fixos; o GDELT leva ~11 s (medido em 24/11/2026).
 * Com o undici explícito, o tempo de conexão obedece ao timeout da fonte.
 */
const agents = new Map<string, Agent>();
function agentFor(timeoutMs: number, allowPrivate: boolean): Agent {
  const key = `${timeoutMs}:${allowPrivate}`;
  let a = agents.get(key);
  if (!a) {
    // O IP é conferido de novo NA CONEXÃO (lookup próprio): a checagem prévia sozinha deixaria um
    // DNS malicioso responder um IP público na verificação e um interno na conexão (DNS rebinding).
    const connect = { timeout: timeoutMs, ...(allowPrivate ? {} : { lookup: guardedLookup() }) };
    agents.set(key, (a = new Agent({ connect, headersTimeout: timeoutMs, bodyTimeout: timeoutMs })));
  }
  return a;
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address?: string | LookupAddress[], family?: number) => void;
type Resolver = (hostname: string, options: { all: true; family?: number }, cb: (err: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void) => void;

/**
 * `lookup` para o socket: resolve TODOS os endereços e recusa a conexão se algum for interno.
 * Exportado para teste (o resolvedor é injetável).
 */
export function guardedLookup(resolve: Resolver = dnsLookup as unknown as Resolver) {
  return (hostname: string, options: unknown, callback?: LookupCallback): void => {
    const cb = (typeof options === 'function' ? options : callback) as LookupCallback;
    const opts = (typeof options === 'object' && options !== null ? options : typeof options === 'number' ? { family: options } : {}) as { family?: number; all?: boolean };
    resolve(hostname, { family: opts.family, all: true }, (err, addresses) => {
      if (err) return cb(err);
      const blocked = addresses.find((a) => isPrivateAddress(a.address));
      if (blocked || addresses.length === 0) {
        const e = new Error(`destino na rede interna recusado (${hostname} → ${blocked?.address ?? 'nenhum endereço'})`) as NodeJS.ErrnoException;
        e.code = 'EPRIVATE';
        return cb(e);
      }
      if (opts.all) return cb(null, addresses);
      cb(null, addresses[0].address, addresses[0].family);
    });
  };
}

export const USER_AGENT = 'AlertaCidade/2.0 (projeto academico; monitoramento de alagamentos)';

export interface FetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
  accept?: string;
  etag?: string | null;
  lastModified?: string | null;
  /** Somente testes (servidor local). */
  allowPrivateNetwork?: boolean;
}

export interface FetchResult {
  status: number;
  notModified: boolean;
  body: string;
  contentType: string | null;
  etag: string | null;
  lastModified: string | null;
  finalUrl: string;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly transient: boolean,
    readonly status: number | null = null,
    /** Espera pedida pela fonte (Retry-After), em ms. */
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
  }
}

export async function fetchText(rawUrl: string, opts: FetchOptions = {}): Promise<FetchResult> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const maxBytes = opts.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = opts.maxRedirects ?? 3;
  const signal = AbortSignal.timeout(timeoutMs);

  let url = rawUrl;
  for (let hop = 0; ; hop++) {
    await assertPublicHttpUrl(url, opts.allowPrivateNetwork ?? false);
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Accept: opts.accept ?? 'application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5',
      'Accept-Encoding': 'gzip, deflate, br',
    };
    if (hop === 0 && opts.etag) headers['If-None-Match'] = opts.etag;
    if (hop === 0 && opts.lastModified) headers['If-Modified-Since'] = opts.lastModified;

    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(url, { headers, redirect: 'manual', signal, dispatcher: agentFor(timeoutMs, opts.allowPrivateNetwork ?? false) });
    } catch (error) {
      const e = error as Error;
      const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
      const code = cause?.code;
      // Recusado na conexão (DNS mudou para um IP interno): permanente, como na checagem prévia.
      if (code === 'EPRIVATE') throw new FetchError(cause?.message ?? 'destino na rede interna recusado', false);
      const timedOut = e.name === 'TimeoutError' || e.name === 'AbortError' || code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'UND_ERR_HEADERS_TIMEOUT';
      throw new FetchError(timedOut ? `tempo esgotado (${timeoutMs} ms)` : `falha de rede: ${causeOf(e)}`, true);
    }

    if (res.status >= 300 && res.status < 400 && res.status !== 304) {
      const location = res.headers.get('location');
      await res.body?.cancel();
      if (!location) throw new FetchError(`redirecionamento ${res.status} sem destino`, false, res.status);
      if (hop >= maxRedirects) throw new FetchError(`mais de ${maxRedirects} redirecionamentos`, false, res.status);
      url = new URL(location, url).toString();
      continue;
    }

    const base = { status: res.status, contentType: res.headers.get('content-type'), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified'), finalUrl: url };
    if (res.status === 304) return { ...base, notModified: true, body: '' };

    if (!res.ok) {
      const retryAfterMs = parseRetryAfter(res.headers.get('retry-after'));
      const snippet = (await readLimited(res, 2048).catch(() => '')).replace(/\s+/g, ' ').trim().slice(0, 200);
      const transient = res.status === 429 || res.status === 408 || res.status >= 500;
      throw new FetchError(`HTTP ${res.status}${snippet ? `: ${snippet}` : ''}`, transient, res.status, retryAfterMs);
    }

    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > maxBytes) {
      await res.body?.cancel();
      throw new FetchError(`resposta de ${declared} bytes excede o limite de ${maxBytes}`, false, res.status);
    }
    const bytes = await readBytes(res, maxBytes);
    return { ...base, notModified: false, body: decode(bytes, base.contentType) };
  }
}

type HttpResponse = Awaited<ReturnType<typeof undiciFetch>>;

async function readBytes(res: HttpResponse, maxBytes: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new FetchError(`resposta excede o limite de ${maxBytes} bytes`, false, res.status);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

async function readLimited(res: HttpResponse, maxBytes: number): Promise<string> {
  try {
    return new TextDecoder().decode(await readBytes(res, maxBytes));
  } catch {
    return '';
  }
}

/** Charset do Content-Type; senão, o declarado no XML; senão, UTF-8. */
export function decode(bytes: Uint8Array, contentType: string | null): string {
  const fromHeader = /charset=["']?([\w-]+)/i.exec(contentType ?? '')?.[1];
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200));
  const fromXml = /<\?xml[^>]*encoding=["']([\w-]+)["']/i.exec(head)?.[1];
  const label = (fromHeader ?? fromXml ?? 'utf-8').toLowerCase();
  try {
    return new TextDecoder(label).decode(bytes).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
}

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - now);
}

/** Recusa esquemas não http(s), credenciais na URL e destinos na rede interna. */
export async function assertPublicHttpUrl(rawUrl: string, allowPrivate: boolean): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new FetchError(`URL inválida: ${rawUrl}`, false);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new FetchError(`esquema não permitido: ${u.protocol}`, false);
  if (u.username || u.password) throw new FetchError('URL com credenciais não é permitida', false);
  if (allowPrivate) return;

  const host = u.hostname.replace(/^\[|\]$/g, '');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch (error) {
    throw new FetchError(`DNS falhou para ${host}: ${causeOf(error as Error)}`, true);
  }
  const blocked = addresses.find(isPrivateAddress);
  if (blocked) throw new FetchError(`destino na rede interna recusado (${host} → ${blocked})`, false);
}

/**
 * Endereço que o worker NUNCA deve acessar: rede interna, loopback, link-local, multicast, reservado
 * ou de documentação — em IPv4 e IPv6, inclusive IPv4 embutido em IPv6 (mapeado `::ffff:`, compatível
 * `::a.b.c.d`, NAT64 `64:ff9b::/96`, 6to4 `2002::/16`, Teredo). Na dúvida (texto que não é IP), recusa.
 *
 * Achado da Etapa 11: o Node normaliza `[::ffff:127.0.0.1]` para `::ffff:7f00:1` (hexadecimal), que a
 * versão anterior — baseada em prefixo de texto — considerava público.
 */
export function isPrivateAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return ipv4Private(ip.split('.').map(Number));
  if (v !== 6) return true;
  const h = parseIpv6(ip);
  if (!h) return true;
  const v4 = (hi: number, lo: number) => [hi >> 8, hi & 0xff, lo >> 8, lo & 0xff];
  const zeros = (from: number, to: number) => h.slice(from, to).every((x) => x === 0);
  if (zeros(0, 5) && h[5] === 0xffff) return ipv4Private(v4(h[6], h[7])); // ::ffff:a.b.c.d
  if (zeros(0, 6)) return ipv4Private(v4(h[6], h[7])); // ::a.b.c.d, ::1 e :: (0.0.0.x)
  if (h[0] === 0x64 && h[1] === 0xff9b && zeros(2, 6)) return ipv4Private(v4(h[6], h[7])); // NAT64
  if (h[0] === 0x2002) return ipv4Private(v4(h[1], h[2])); // 6to4
  if (h[0] === 0x2001 && h[1] === 0) return true; // Teredo (IPv4 ofuscado)
  if (h[0] === 0x2001 && h[1] === 0x0db8) return true; // documentação
  if (h[0] === 0x0100 && zeros(1, 4)) return true; // descarte
  return (h[0] & 0xfe00) === 0xfc00 || (h[0] & 0xffc0) === 0xfe80 || (h[0] & 0xffc0) === 0xfec0 || (h[0] & 0xff00) === 0xff00;
}

function ipv4Private([a, b, c]: number[]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) || (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) || (a === 203 && b === 0 && c === 113) || a >= 224
  );
}

/** IPv6 → 8 grupos de 16 bits (aceita `::`, IPv4 no final e zona `%eth0`). */
function parseIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().split('%')[0];
  const tail: number[] = [];
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(s);
  if (dotted) {
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    tail.push((a << 8) | b, (c << 8) | d);
    s = s.slice(0, -dotted[1].length); // "::ffff:" / "::" / "1:2:3:4:5:6:"
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [head, rest] = s.split('::');
  const part = (x: string | undefined) => (x ? x.split(':').filter((g) => g !== '').map((g) => parseInt(g, 16)) : []);
  const left = part(head);
  const right = [...part(rest), ...tail];
  const missing = 8 - left.length - right.length;
  if (s.includes('::') ? missing < 0 : missing !== 0) return null;
  const out = [...left, ...Array(Math.max(0, missing)).fill(0), ...right];
  return out.length === 8 && out.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? out : null;
}

function causeOf(e: Error): string {
  const cause = (e as Error & { cause?: { code?: string; message?: string } }).cause;
  return cause?.code ?? cause?.message ?? e.message;
}
