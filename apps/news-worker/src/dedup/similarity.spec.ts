import { areIndependent, citedAgency, countIndependent, isSameEvent, titleFingerprint } from './similarity';

const OSASCO = '3534401';
const SP = '3550308';
const t0 = new Date('2026-11-23T17:00:00Z');
const plus = (h: number) => new Date(t0.getTime() + h * 3_600_000);

describe('agrupamento em eventos', () => {
  it('exemplo do enunciado: "Chuva alaga avenida em Osasco" + "Temporal causa interdição de via em Osasco" → mesmo evento', () => {
    const a = { cityIbges: [OSASCO], districtIbges: [], places: [], at: t0 };
    const b = { cityIbges: [OSASCO], districtIbges: [], places: [], at: plus(1.5) };
    expect(isSameEvent(a, b).same).toBe(true);
  });

  it('cidades diferentes → eventos diferentes', () => {
    expect(isSameEvent({ cityIbges: [OSASCO], districtIbges: [], places: [], at: t0 }, { cityIbges: [SP], districtIbges: [], places: [], at: t0 }).same).toBe(false);
  });

  it('fora da janela de 6 h → eventos diferentes', () => {
    const r = isSameEvent({ cityIbges: [OSASCO], districtIbges: [], places: [], at: t0 }, { cityIbges: [OSASCO], districtIbges: [], places: [], at: plus(7) });
    expect(r).toEqual({ same: false, reason: expect.stringContaining('7.0 h') });
  });

  it('distritos diferentes na mesma cidade → eventos diferentes', () => {
    const a = { cityIbges: [SP], districtIbges: ['355030845'], places: [], at: t0 };
    const b = { cityIbges: [SP], districtIbges: ['355030862'], places: [], at: t0 };
    expect(isSameEvent(a, b).same).toBe(false);
  });

  it('logradouros: "Av. dos Autonomistas" ≈ "Avenida dos Autonomistas"; outra avenida não', () => {
    const base = { cityIbges: [OSASCO], districtIbges: [], at: t0 };
    expect(isSameEvent({ ...base, places: ['Av. dos Autonomistas'] }, { ...base, places: ['Avenida dos Autonomistas'] }).same).toBe(true);
    expect(isSameEvent({ ...base, places: ['Avenida dos Autonomistas'] }, { ...base, places: ['Rua Antônio Agú'] }).same).toBe(false);
  });

  it('uma fonte só com a cidade + outra com logradouro → mesmo episódio', () => {
    const base = { cityIbges: [OSASCO], districtIbges: [], at: t0 };
    expect(isSameEvent({ ...base, places: [] }, { ...base, places: ['Avenida dos Autonomistas'] }).same).toBe(true);
  });
});

describe('independência das fontes', () => {
  const a = { url: 'https://g1.globo.com/sp/a', title: 'Chuva alaga avenida em Osasco', summary: null };

  it('mesmo veículo não é confirmação independente', () => {
    expect(areIndependent(a, { url: 'https://globo.com/b', title: 'Outro título sobre Osasco', summary: null }).independent).toBe(false);
  });

  it('republicação (título quase idêntico) em outro portal não conta', () => {
    const r = areIndependent(a, { url: 'https://outro.com.br/x', title: 'Chuva alaga avenida em Osasco', summary: null });
    expect(r).toEqual({ independent: false, reason: expect.stringContaining('republicação') });
  });

  it('mesma agência citada (mesmo comunicado) não conta', () => {
    const x = { url: 'https://a.com.br/1', title: 'Temporal interdita via em Osasco', summary: 'Com informações da Agência Brasil.' };
    const y = { url: 'https://b.com.br/2', title: 'Alagamento fecha avenida na Grande SP', summary: 'Fonte: Agência Brasil' };
    expect(citedAgency(x.summary)).toBe('agencia brasil');
    expect(areIndependent(x, y).independent).toBe(false);
  });

  it('veículos e textos distintos são independentes', () => {
    expect(areIndependent(a, { url: 'https://folha.uol.com.br/x', title: 'Temporal causa interdição de via em Osasco', summary: null }).independent).toBe(true);
  });

  it('conta grupos: 3 matérias, 2 delas republicação → 2 independentes', () => {
    expect(
      countIndependent([
        a,
        { url: 'https://outro.com.br/x', title: 'Chuva alaga avenida em Osasco', summary: null },
        { url: 'https://folha.uol.com.br/x', title: 'Temporal causa interdição de via em Osasco', summary: null },
      ]),
    ).toBe(2);
  });

  it('impressão do título independe de ordem e acentos', () => {
    expect(titleFingerprint('Inundação em Osasco')).toBe(titleFingerprint('Osasco: inundacao'));
  });
});
