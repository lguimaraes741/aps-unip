import { FeedParseError, parseFeed, SUMMARY_MAX } from './rss';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Portal de teste</title>
    <item>
      <title>Chuva alaga avenida em Osasco</title>
      <link>https://portal.example/noticia/1?utm_source=rss</link>
      <guid isPermaLink="false">abc-1</guid>
      <pubDate>Mon, 23 Nov 2026 17:20:00 -0300</pubDate>
      <description><![CDATA[<p>Trecho <b>interditado</b> &amp; trânsito lento.</p>]]></description>
      <dc:creator>Redação</dc:creator>
    </item>
    <item>
      <title>Sem link — deve ser ignorado</title>
    </item>
    <item>
      <title>Data inválida</title>
      <link>https://portal.example/noticia/3</link>
      <pubDate>ontem à tarde</pubDate>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Comunicados</title>
  <entry>
    <id>tag:orgao.example,2026:42</id>
    <title>Defesa Civil alerta para alagamentos</title>
    <link rel="alternate" href="https://orgao.example/comunicado/42"/>
    <link rel="enclosure" href="https://orgao.example/img.jpg"/>
    <published>2026-11-23T20:00:00Z</published>
    <summary type="html">&lt;p&gt;Evite a região.&lt;/p&gt;</summary>
    <author><name>Defesa Civil</name></author>
  </entry>
</feed>`;

describe('parseFeed', () => {
  it('lê RSS 2.0: título, link, guid, data, autor e resumo sem HTML', () => {
    const items = parseFeed(RSS);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      externalId: 'abc-1',
      title: 'Chuva alaga avenida em Osasco',
      url: 'https://portal.example/noticia/1?utm_source=rss',
      publishedAt: new Date('2026-11-23T20:20:00Z'),
      summary: 'Trecho interditado & trânsito lento.',
      author: 'Redação',
    });
  });

  it('data inválida vira null (nunca uma data inventada)', () => {
    expect(parseFeed(RSS)[1].publishedAt).toBeNull();
  });

  it('lê Atom usando o link alternate', () => {
    const [e] = parseFeed(ATOM);
    expect(e.url).toBe('https://orgao.example/comunicado/42');
    expect(e.externalId).toBe('tag:orgao.example,2026:42');
    expect(e.summary).toBe('Evite a região.');
    expect(e.author).toBe('Defesa Civil');
  });

  it('limita o resumo a 500 caracteres (não armazena o artigo inteiro)', () => {
    const long = RSS.replace('Trecho <b>interditado</b>', 'texto '.repeat(400));
    expect(parseFeed(long)[0].summary!.length).toBeLessThanOrEqual(SUMMARY_MAX);
  });

  it('feed válido sem itens → lista vazia', () => {
    expect(parseFeed('<rss version="2.0"><channel><title>x</title></channel></rss>')).toEqual([]);
  });

  it('HTML de erro (fonte fora do ar devolvendo página) é rejeitado', () => {
    expect(() => parseFeed('<html><body>503 Service Unavailable</body></html>')).toThrow(FeedParseError);
  });

  it('recusa feeds com entidades declaradas (ataque "billion laughs")', () => {
    const bomb = '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY a "aaaa"><!ENTITY b "&a;&a;&a;">]><rss><channel><item><title>&b;</title></item></channel></rss>';
    expect(() => parseFeed(bomb)).toThrow(/entidades/);
  });
});
