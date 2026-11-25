import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import { gzipSync } from 'node:zlib';
import { buildGdeltUrl, parseGdeltDate, parseGdeltResponse, RssAdapter, unwrapRedirectLink } from './adapters';
import { FetchError, fetchText, guardedLookup, isPrivateAddress, parseRetryAfter } from './http';
import { HostRateLimiter } from './rate-limit';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;
const routes = new Map<string, Handler>();
let server: Server;
let base: string;

beforeAll(async () => {
  server = createServer((req, res) => (routes.get(req.url!.split('?')[0]) ?? ((_, r) => r.writeHead(404).end('nada')))(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const local = { allowPrivateNetwork: true, timeoutMs: 2_000 };
const RSS = (title: string) => `<rss version="2.0"><channel><item><title>${title}</title><link>https://p.example/1</link></item></channel></rss>`;

describe('fetchText', () => {
  it('decodifica ISO-8859-1 declarado no cabeçalho (caso real da Folha)', async () => {
    routes.set('/latin1', (_, res) => res.writeHead(200, { 'Content-Type': 'text/xml; charset=ISO-8859-1' }).end(Buffer.from(RSS('Inundação em Osasco'), 'latin1')));
    expect((await fetchText(`${base}/latin1`, local)).body).toContain('Inundação em Osasco');
  });

  it('decodifica pela declaração do XML quando o cabeçalho não diz', async () => {
    const xml = `<?xml version="1.0" encoding="ISO-8859-1"?>${RSS('Carapicuíba')}`;
    routes.set('/xmldecl', (_, res) => res.writeHead(200, { 'Content-Type': 'text/xml' }).end(Buffer.from(xml, 'latin1')));
    expect((await fetchText(`${base}/xmldecl`, local)).body).toContain('Carapicuíba');
  });

  it('aceita resposta compactada (gzip, como o g1)', async () => {
    routes.set('/gzip', (_, res) => res.writeHead(200, { 'Content-Type': 'application/rss+xml; charset=utf-8', 'Content-Encoding': 'gzip' }).end(gzipSync(RSS('Chuva'))));
    expect((await fetchText(`${base}/gzip`, local)).body).toContain('<title>Chuva</title>');
  });

  it('429 com Retry-After → falha temporária com a espera pedida', async () => {
    routes.set('/429', (_, res) => res.writeHead(429, { 'Retry-After': '120' }).end('Please limit requests to one every 5 seconds'));
    await expect(fetchText(`${base}/429`, local)).rejects.toMatchObject({ transient: true, status: 429, retryAfterMs: 120_000 });
  });

  it.each([
    [500, true],
    [503, true],
    [404, false],
    [403, false],
  ])('HTTP %i → temporária = %s', async (status, transient) => {
    routes.set(`/s${status}`, (_, res) => res.writeHead(status).end());
    await expect(fetchText(`${base}/s${status}`, local)).rejects.toMatchObject({ transient, status });
  });

  it('fonte lenta: tempo esgotado é falha temporária', async () => {
    routes.set('/slow', (_, res) => setTimeout(() => res.writeHead(200).end('tarde demais'), 1_500));
    await expect(fetchText(`${base}/slow`, { ...local, timeoutMs: 300 })).rejects.toMatchObject({ transient: true, message: expect.stringContaining('tempo esgotado') });
  });

  it('resposta maior que o limite é recusada (com e sem Content-Length)', async () => {
    routes.set('/big', (_, res) => res.writeHead(200, { 'Content-Length': '5000' }).end('x'.repeat(5000)));
    await expect(fetchText(`${base}/big`, { ...local, maxBytes: 1000 })).rejects.toMatchObject({ transient: false });
    routes.set('/chunked', (_, res) => {
      res.writeHead(200);
      for (let i = 0; i < 10; i++) res.write('y'.repeat(500));
      res.end();
    });
    await expect(fetchText(`${base}/chunked`, { ...local, maxBytes: 1000 })).rejects.toThrow(/excede o limite/);
  });

  it('segue redirecionamentos (até o limite)', async () => {
    routes.set('/r1', (_, res) => res.writeHead(301, { Location: '/r2' }).end());
    routes.set('/r2', (_, res) => res.writeHead(200).end('fim'));
    const r = await fetchText(`${base}/r1`, local);
    expect(r.body).toBe('fim');
    expect(r.finalUrl).toBe(`${base}/r2`);
    routes.set('/loop', (_, res) => res.writeHead(302, { Location: '/loop' }).end());
    await expect(fetchText(`${base}/loop`, local)).rejects.toThrow(/redirecionamentos/);
  });

  it('requisição condicional: 304 → não modificado, sem corpo', async () => {
    routes.set('/etag', (req, res) => (req.headers['if-none-match'] === '"v1"' ? res.writeHead(304).end() : res.writeHead(200, { ETag: '"v1"' }).end(RSS('a'))));
    const first = await fetchText(`${base}/etag`, local);
    expect(first.etag).toBe('"v1"');
    expect(await fetchText(`${base}/etag`, { ...local, etag: first.etag })).toMatchObject({ status: 304, notModified: true, body: '' });
  });

  it('SSRF: recusa destino na rede interna (inclusive via redirecionamento)', async () => {
    await expect(fetchText(`${base}/r2`, { timeoutMs: 2_000 })).rejects.toThrow(/rede interna/);
    await expect(fetchText('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/rede interna/);
    await expect(fetchText('file:///etc/passwd')).rejects.toThrow(/esquema/);
  });

  it.each([
    ['127.0.0.1', true], ['10.1.2.3', true], ['172.20.0.1', true], ['192.168.0.10', true], ['169.254.169.254', true],
    ['::1', true], ['fd00::1', true], ['::ffff:10.0.0.1', true], ['8.8.8.8', false], ['200.147.67.142', false], ['2804:14c::1', false],
    // Etapa 11 — formas que a versão anterior deixava passar:
    ['::ffff:7f00:1', true], // [::ffff:127.0.0.1] depois da normalização do Node (hexadecimal)
    ['0:0:0:0:0:ffff:a00:1', true], // 10.0.0.1 mapeado, por extenso
    ['::127.0.0.1', true], // IPv4 "compatível"
    ['64:ff9b::a9fe:a9fe', true], // NAT64 → 169.254.169.254 (metadados de nuvem)
    ['2002:c0a8:1::1', true], // 6to4 → 192.168.0.1
    ['2001:0:4136:e378::1', true], // Teredo
    ['fe90::1', true], ['febf::1', true], // link-local além de fe80::
    ['fec0::1', true], ['ff02::1', true], ['2001:db8::1', true], ['198.18.0.1', true], ['192.0.0.8', true], ['203.0.113.5', true],
    ['fe80::1%eth0', true], ['não é ip', true], // na dúvida, recusa
    ['2a03:2880:f12f:83:face:b00c::25de', false], ['2804:14c:5b80::1', false], ['64:ff9b::808:808', false], // NAT64 → 8.8.8.8
  ])('endereço %s privado = %s', (ip, expected) => {
    expect(isPrivateAddress(ip)).toBe(expected);
  });

  it('SSRF: IPv4 mapeado em IPv6 e formas numéricas do loopback são recusadas antes de qualquer conexão', async () => {
    let hits = 0;
    routes.set('/segredo', (_, res) => {
      hits++;
      res.writeHead(200).end('<rss version="2.0"><channel></channel></rss>');
    });
    const port = new URL(base).port;
    for (const url of [`http://[::ffff:127.0.0.1]:${port}/segredo`, `http://2130706433:${port}/segredo`, `http://0x7f.1:${port}/segredo`, `http://127.1:${port}/segredo`]) {
      await expect(fetchText(url, { timeoutMs: 2_000 })).rejects.toThrow(/rede interna/);
    }
    expect(hits).toBe(0);
  });

  it('DNS rebinding: o IP é conferido de novo na conexão — resposta interna (ou mista) é recusada', async () => {
    const resolver = (answers: string[]) => (_h: string, _o: unknown, cb: (e: null, a: { address: string; family: number }[]) => void) =>
      cb(null, answers.map((address) => ({ address, family: address.includes(':') ? 6 : 4 })));
    const run = (answers: string[], options: unknown = {}) =>
      new Promise<{ err: NodeJS.ErrnoException | null; address?: unknown }>((resolve) =>
        guardedLookup(resolver(answers))('feed.example', options, (err, address) => resolve({ err, address })),
      );

    expect(await run(['200.147.67.142'])).toEqual({ err: null, address: '200.147.67.142' });
    expect(await run(['200.147.67.142'], { all: true })).toMatchObject({ err: null, address: [{ address: '200.147.67.142' }] });
    // Na verificação prévia o DNS respondeu público; na conexão, interno:
    const rebind = await run(['127.0.0.1']);
    expect(rebind.err).toMatchObject({ code: 'EPRIVATE', message: expect.stringMatching(/rede interna.*127\.0\.0\.1/) });
    // Um único endereço interno na lista basta para recusar (o socket poderia tentar qualquer um).
    expect((await run(['200.147.67.142', '::ffff:a9fe:a9fe'])).err).toMatchObject({ code: 'EPRIVATE' });
    expect((await run([])).err).toMatchObject({ code: 'EPRIVATE' });
  });

  it('Retry-After em segundos ou data HTTP', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
    expect(parseRetryAfter('Tue, 24 Nov 2026 12:01:00 GMT', Date.parse('Tue, 24 Nov 2026 12:00:00 GMT'))).toBe(60_000);
    expect(parseRetryAfter('lixo')).toBeNull();
  });
});

describe('adaptadores', () => {
  it('desembrulha o redirecionador da Folha', () => {
    expect(unwrapRedirectLink('https://redir.folha.com.br/redir/online/cotidiano/rss091/*https://www1.folha.uol.com.br/cotidiano/2026/11/x.shtml')).toBe(
      'https://www1.folha.uol.com.br/cotidiano/2026/11/x.shtml',
    );
    expect(unwrapRedirectLink('https://g1.globo.com/sp/noticia/x.ghtml')).toBe('https://g1.globo.com/sp/noticia/x.ghtml');
  });

  it('RSS: página HTML no lugar do feed (ex.: proteção anti-robô) → falha permanente, não insiste', async () => {
    routes.set('/html', (_, res) => res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!DOCTYPE html><html><body>verificação</body></html>'));
    const src = { id: 'x', key: 'x', type: 'RSS' as const, feedUrl: `${base}/html`, minRequestIntervalMs: 0, config: {} };
    await expect(new RssAdapter().collect(src, local)).rejects.toMatchObject({ transient: false, message: expect.stringContaining('feed inválido') });
  });

  it('GDELT: monta a consulta e lê artigos', () => {
    const url = new URL(buildGdeltUrl('https://api.gdeltproject.org/api/v2/doc/doc', { query: 'alagamento sourcecountry:brazil', maxRecords: 999 }));
    expect(url.searchParams.get('maxrecords')).toBe('250');
    expect(url.searchParams.get('format')).toBe('json');
    const items = parseGdeltResponse(
      JSON.stringify({ articles: [{ url: 'https://p.example/a', title: 'Chuva alaga ruas em Osasco', seendate: '20261124T101500Z', domain: 'p.example' }, { title: 'sem url' }] }),
    );
    expect(items).toEqual([{ externalId: null, title: 'Chuva alaga ruas em Osasco', url: 'https://p.example/a', publishedAt: new Date('2026-11-24T10:15:00Z'), summary: null, author: null }]);
  });

  it('GDELT: "{}" = nenhum resultado; aviso de limite em texto puro = falha temporária', () => {
    expect(parseGdeltResponse('{}')).toEqual([]);
    expect(() => parseGdeltResponse('Please limit requests to one every 5 seconds or contact…')).toThrow(FetchError);
    try {
      parseGdeltResponse('Please limit requests to one every 5 seconds');
    } catch (e) {
      expect(e).toMatchObject({ transient: true, status: 429 });
    }
    expect(parseGdeltDate('2026-11-24')).toBeNull();
  });
});

describe('HostRateLimiter', () => {
  it('espaça requisições ao mesmo host, não entre hosts diferentes', async () => {
    const waits: number[] = [];
    const limiter = new HostRateLimiter(async (ms) => void waits.push(ms));
    const clock = () => 1_000;
    expect(await limiter.wait('https://a.example/1', 5_000, clock)).toBe(0);
    expect(await limiter.wait('https://a.example/2', 5_000, clock)).toBe(5_000);
    expect(await limiter.wait('https://b.example/1', 5_000, clock)).toBe(0);
    limiter.defer('https://b.example/x', 61_000);
    expect(await limiter.wait('https://b.example/2', 5_000, clock)).toBe(60_000);
  });
});
