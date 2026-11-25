import { FoldedText } from './folded';
import { fold, stripHtml, tokens, truncate } from './normalize';
import { canonicalizeUrl, sourceDomain, urlHash } from './url';

describe('normalização de texto', () => {
  it('remove acentos e caixa', () => {
    expect(fold('Carapicuíba INUNDAÇÃO')).toBe('carapicuiba inundacao');
  });

  it('limpa HTML e entidades de resumos de feed', () => {
    expect(stripHtml('<p>Chuva&nbsp;alaga <b>avenida</b> &amp; via</p><img src="x.jpg">')).toBe('Chuva alaga avenida & via.');
    expect(stripHtml('<script>alert(1)</script>Texto')).toBe('Texto');
  });

  it('tokens ignoram stopwords e palavras curtas', () => {
    expect(tokens('Chuva alaga a avenida em Osasco')).toEqual(['chuva', 'alaga', 'avenida', 'osasco']);
  });

  it('trunca em fronteira de palavra', () => {
    const t = truncate('palavra '.repeat(100), 50);
    expect(t.length).toBeLessThanOrEqual(50);
    expect(t.endsWith('…')).toBe(true);
  });

  it('FoldedText devolve o trecho ORIGINAL (com acentos) de um casamento no texto dobrado', () => {
    const t = new FoldedText('Famílias ilhadas em Carapicuíba');
    const i = t.folded.indexOf('carapicuiba');
    expect(t.excerpt(i, i + 'carapicuiba'.length)).toBe('Carapicuíba');
  });
});

describe('URL canônica', () => {
  it.each([
    'https://www.portal.com.br/noticia/x/?utm_source=rss&utm_medium=feed#topo',
    'http://portal.com.br/noticia/x',
    'https://m.portal.com.br/noticia/x/amp',
    'https://portal.com.br/noticia/x?fbclid=abc',
  ])('%s → mesma URL', (u) => {
    expect(canonicalizeUrl(u)).toBe('https://portal.com.br/noticia/x');
  });

  it('mantém parâmetros que identificam o conteúdo (ordenados)', () => {
    expect(canonicalizeUrl('https://portal.com.br/n?id=2&cat=sp')).toBe('https://portal.com.br/n?cat=sp&id=2');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.com/a', 'https://user:senha@x.com/a', 'não é url'])('recusa %s', (u) => {
    expect(canonicalizeUrl(u)).toBeNull();
  });

  it('hash estável de 64 hex', () => {
    expect(urlHash('https://a.com/x')).toMatch(/^[0-9a-f]{64}$/);
    expect(urlHash('https://a.com/x')).toBe(urlHash('https://a.com/x'));
  });

  it.each([
    ['https://g1.globo.com/sp/noticia/a', 'globo.com'],
    ['https://agenciabrasil.ebc.com.br/x', 'ebc.com.br'],
    ['https://www.osasco.sp.gov.br/x', 'osasco.sp.gov.br'],
    ['https://www.defesacivil.sp.gov.br/x', 'defesacivil.sp.gov.br'],
  ])('domínio de %s = %s', (u, d) => {
    expect(sourceDomain(u)).toBe(d);
  });
});
