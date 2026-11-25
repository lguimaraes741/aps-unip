import { extractLocation, MONITORED_CITIES } from '../geo/gazetteer';
import { CORPUS } from '../evaluation/corpus';
import { evaluate, evaluateCase } from '../evaluation/evaluate';
import { analyzeByRules } from './rules';

const NOW = new Date('2026-11-24T12:00:00Z');
const recent = new Date('2026-11-24T10:00:00Z');

describe('corpus simulado (conjunto de desenvolvimento das regras)', () => {
  it.each(CORPUS.map((c) => [c.id, c.checks, c] as const))('%s — %s', (_, __, c) => {
    expect(evaluateCase(c, NOW).mismatches).toEqual([]);
  });

  it('nenhum alerta falso e nenhum push indevido', () => {
    const { metrics } = evaluate(CORPUS, NOW);
    expect(metrics.falseAlerts).toBe(0);
    expect(metrics.wrongPush).toBe(0);
  });
});

describe('regras: rastreabilidade', () => {
  it('evidência guarda o trecho literal original, com acentos', () => {
    const r = analyzeByRules({ title: 'Famílias ficam ILHADAS em Carapicuíba após chuva', summary: null, publishedAt: recent }, NOW);
    expect(r.severityEvidence[0]).toEqual({ label: 'pessoas ilhadas', excerpt: 'ILHADAS', severity: 'CRITICAL' });
  });

  it('evidência anulada fica registrada com o motivo', () => {
    const r = analyzeByRules({ title: 'Chuva alaga ruas e não houve desabrigados em Osasco', summary: null, publishedAt: recent }, NOW);
    expect(r.severity).toBeNull();
    expect(r.discardedEvidence).toEqual([{ label: 'desabrigados', excerpt: 'desabrigados', why: 'negação' }]);
  });

  it('negação numa frase não contamina a frase seguinte', () => {
    const r = analyzeByRules({ title: 'Não há feridos. Bombeiros resgatam família ilhada após temporal em Cotia', summary: null, publishedAt: recent }, NOW);
    expect(r.severity).toBe('CRITICAL');
  });

  it('sem data de publicação: não afirma que é atual', () => {
    const r = analyzeByRules({ title: 'Chuva alaga avenida em Osasco', summary: null, publishedAt: null }, NOW);
    expect(r.temporality).toBe('UNCERTAIN');
    expect(r.missing).toContain('data de publicação');
  });

  it('data no futuro é suspeita', () => {
    const r = analyzeByRules({ title: 'Chuva alaga avenida em Osasco', summary: null, publishedAt: new Date('2026-11-25T12:00:00Z') }, NOW);
    expect(r.temporality).toBe('UNCERTAIN');
  });

  it('marca casos ambíguos para revisão', () => {
    expect(analyzeByRules({ title: 'Chuva alaga avenida em Osasco', summary: null, publishedAt: recent }, NOW).needsReview).toBe(true);
    expect(analyzeByRules({ title: 'Chuva alaga e interdita avenida em Osasco', summary: null, publishedAt: recent }, NOW).needsReview).toBe(false);
  });
});

describe('gazetteer (nomes do IBGE)', () => {
  it('cidades monitoradas vieram do IBGE com códigos de 7 dígitos', () => {
    expect(MONITORED_CITIES.find((c) => c.name === 'Osasco')).toEqual({ ibge: '3534401', name: 'Osasco', state: 'SP' });
    for (const c of MONITORED_CITIES) expect(c.ibge).toMatch(/^35\d{5}$/);
  });

  it('"Santana de Parnaíba" não vira o distrito Santana', () => {
    const l = extractLocation('Chuva alaga ruas em Santana de Parnaíba', null);
    expect(l.cities.map((c) => c.name)).toEqual(['Santana de Parnaíba']);
    expect(l.districts).toEqual([]);
  });

  it('"estado de São Paulo" não é a capital', () => {
    expect(extractLocation('Enchentes atingem o estado de São Paulo', null).cities).toEqual([]);
  });

  it('distrito com contexto da fonte (feed da capital) é aceito', () => {
    const l = extractLocation('Alagamento no Ipiranga interdita avenida', null, { sourceCityIbge: '3550308' });
    expect(l.districts.map((d) => d.name)).toEqual(['Ipiranga']);
    expect(l.precision).toBe('NEIGHBORHOOD');
  });

  it('distrito homônimo sem contexto de SP não é aceito (Ipiranga/PR)', () => {
    expect(extractLocation('Alagamento no Ipiranga interdita avenida', null).districts).toEqual([]);
  });

  it('Santo André (também município na Paraíba) + Paraíba citada → ambiguidade registrada', () => {
    const l = extractLocation('Chuva alaga ruas de Santo André, no interior da Paraíba', null);
    expect(l.ambiguities).toEqual([expect.stringContaining('PB')]);
  });

  it('Santo André (PB) com UF explícita → fora da área', () => {
    const l = extractLocation('Chuva alaga ruas de Santo André (PB)', null);
    expect(l.cities).toEqual([]);
    expect(l.outOfScope).toBe(true);
  });

  it('logradouros são extraídos sem coordenadas', () => {
    const l = extractLocation('Alagamento interdita a Avenida dos Autonomistas em Osasco', null);
    expect(l.places).toEqual(['Avenida dos Autonomistas']);
    expect(l.precision).toBe('CITY');
  });

  it('Grande São Paulo sem cidade → abrangência regional', () => {
    const l = extractLocation('Temporal provoca alagamentos na Grande São Paulo', null);
    expect(l.metroRegion).toBe(true);
    expect(l.precision).toBe('REGION');
  });

  it('caso real (Folha, 24/11): "região metropolitana DE Curitiba" não é a Grande SP → fora da área', () => {
    const l = extractLocation(
      'Casal morre afogado em casa após chuva alagar rua em Campo Largo (PR)',
      'Um casal de idosos morreu afogado em casa no final da tarde desta segunda-feira (23) após as chuvas provocarem o alagamento da rua onde moravam no bairro Ouro Fino Grande, em Campo Largo, na região metropolitana de Curitiba .',
    );
    expect(l.metroRegion).toBe(false);
    expect(l.outOfScope).toBe(true);
  });

  it.each([
    ['Chuva alaga ruas na região metropolitana de São Paulo', true],
    ['Chuva alaga ruas em cidades da região metropolitana nesta segunda', true],
    ['Chuva alaga ruas na região metropolitana do Recife', false],
    ['Chuva alaga ruas na região metropolitana da Baixada Santista', false],
  ])('"%s" → Grande SP = %s', (title, metro) => {
    expect(extractLocation(title, null).metroRegion).toBe(metro);
  });
});
