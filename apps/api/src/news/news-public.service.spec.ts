import { pickHeadline, safeUrl } from './news-public.service';

describe('news-public: funções puras', () => {
  it('safeUrl só deixa passar http(s)', () => {
    expect(safeUrl('https://g1.globo.com/sp/a')).toBe('https://g1.globo.com/sp/a');
    expect(safeUrl('http://exemplo.com/x')).toBe('http://exemplo.com/x');
    expect(safeUrl('javascript:alert(1)')).toBeNull();
    expect(safeUrl('intent://scan#Intent;end')).toBeNull();
    expect(safeUrl('não é url')).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });

  it('pickHeadline usa a evidência da gravidade publicada e ignora dados malformados', () => {
    const data = [
      null,
      { severityEvidence: [{ label: 'trânsito lento', severity: 'MODERATE' }] },
      { severityEvidence: [{ label: 'via interditada', severity: 'HIGH' }] },
    ];
    expect(pickHeadline('HIGH', data)).toBe('via interditada');
    expect(pickHeadline('CRITICAL', data)).toBeNull();
    expect(pickHeadline(null, data)).toBeNull();
    expect(pickHeadline('HIGH', [{}])).toBeNull();
  });
});
