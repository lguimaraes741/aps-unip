import { assessConfidence, ConfidenceInput } from '../analysis/confidence';
import { decidePublication, isRelevantChange, PublicationInput } from './publication';

const current: ConfidenceInput = {
  temporality: 'CURRENT',
  precision: 'CITY',
  locationAmbiguous: false,
  independentSources: [{ reliability: 'ESTABLISHED_PRESS' }],
  contradiction: false,
};

describe('confiança', () => {
  it('uma fonte de imprensa → MÉDIA', () => {
    expect(assessConfidence(current).level).toBe('MEDIUM');
  });
  it('duas fontes de imprensa independentes → ALTA', () => {
    expect(assessConfidence({ ...current, independentSources: [{ reliability: 'ESTABLISHED_PRESS' }, { reliability: 'ESTABLISHED_PRESS' }] }).level).toBe('HIGH');
  });
  it('fonte oficial atual → ALTA', () => {
    expect(assessConfidence({ ...current, independentSources: [{ reliability: 'OFFICIAL' }] }).level).toBe('HIGH');
  });
  it.each<[string, Partial<ConfidenceInput>]>([
    ['agregador sozinho', { independentSources: [{ reliability: 'AGGREGATOR' }] }],
    ['sem localização', { precision: 'UNKNOWN' }],
    ['localização ambígua', { locationAmbiguous: true }],
    ['fontes contraditórias', { contradiction: true, independentSources: [{ reliability: 'OFFICIAL' }] }],
    ['não é atual', { temporality: 'UNCERTAIN' }],
  ])('%s → BAIXA', (_, patch) => {
    expect(assessConfidence({ ...current, ...patch }).level).toBe('LOW');
  });
});

const base: PublicationInput = {
  temporality: 'CURRENT',
  confidence: 'MEDIUM',
  severity: 'HIGH',
  officialSource: false,
  independentEstablished: 1,
  moderatorApproved: false,
};

describe('política de publicação', () => {
  it('confiança baixa nunca é publicada automaticamente', () => {
    expect(decidePublication({ ...base, confidence: 'LOW' })).toMatchObject({ status: 'AWAITING_VALIDATION', pushAllowed: false });
  });

  it('confiança média → preliminar; push só com gravidade alta', () => {
    expect(decidePublication(base)).toMatchObject({ status: 'PUBLISHED_PRELIMINARY', level: 'PRELIMINARY', pushAllowed: true });
    expect(decidePublication({ ...base, severity: 'MODERATE' }).pushAllowed).toBe(false);
  });

  it('gravidade não informada não dispara push', () => {
    expect(decidePublication({ ...base, confidence: 'HIGH', severity: null }).pushAllowed).toBe(false);
  });

  describe('crítico', () => {
    const critical = { ...base, severity: 'CRITICAL' as const };
    it('uma única notícia: publica preliminar SEM push e pede revisão urgente', () => {
      expect(decidePublication(critical)).toMatchObject({ status: 'PUBLISHED_PRELIMINARY', pushAllowed: false, urgentReview: true });
    });
    it('confiança baixa + crítico: aguarda moderação com urgência', () => {
      expect(decidePublication({ ...critical, confidence: 'LOW' })).toMatchObject({ status: 'AWAITING_VALIDATION', urgentReview: true });
    });
    it('duas fontes independentes → verificado com push', () => {
      expect(decidePublication({ ...critical, confidence: 'HIGH', independentEstablished: 2 })).toMatchObject({ status: 'PUBLISHED_VERIFIED', level: 'VERIFIED', pushAllowed: true });
    });
    it('fonte oficial → nível OFICIAL com push', () => {
      expect(decidePublication({ ...critical, confidence: 'HIGH', officialSource: true })).toMatchObject({ level: 'OFFICIAL', pushAllowed: true });
    });
    it('aprovação de moderador libera o push', () => {
      expect(decidePublication({ ...critical, moderatorApproved: true })).toMatchObject({ status: 'PUBLISHED_VERIFIED', pushAllowed: true, urgentReview: false });
    });
  });

  it.each(['PREVENTION', 'FORECAST', 'HISTORICAL'] as const)('%s é descartado', (temporality) => {
    expect(decidePublication({ ...base, temporality }).status).toBe('DISCARDED');
  });

  it('notícia de normalização encerra (RESOLVED) sem push', () => {
    expect(decidePublication({ ...base, temporality: 'RESOLVED' })).toMatchObject({ status: 'RESOLVED', pushAllowed: false });
  });

  it('preliminar nunca recebe nível OFICIAL (notícia não é comunicado da Defesa Civil)', () => {
    expect(decidePublication({ ...base, confidence: 'HIGH', independentEstablished: 3 }).level).toBe('VERIFIED');
  });
});

describe('repetição de notificações', () => {
  it('nova fonte com a mesma gravidade não notifica de novo', () => {
    expect(isRelevantChange({ severity: 'HIGH', level: 'PRELIMINARY' }, { severity: 'HIGH', level: 'PRELIMINARY' })).toBe(false);
  });
  it('gravidade subiu → notifica', () => {
    expect(isRelevantChange({ severity: 'HIGH', level: 'VERIFIED' }, { severity: 'CRITICAL', level: 'VERIFIED' })).toBe(true);
  });
  it('gravidade caiu → não notifica', () => {
    expect(isRelevantChange({ severity: 'HIGH', level: 'VERIFIED' }, { severity: 'MODERATE', level: 'VERIFIED' })).toBe(false);
  });
  it('preliminar virou verificado → notifica', () => {
    expect(isRelevantChange({ severity: 'HIGH', level: 'PRELIMINARY' }, { severity: 'HIGH', level: 'VERIFIED' })).toBe(true);
  });
  it('primeira notificação depende de haver gravidade', () => {
    expect(isRelevantChange(null, { severity: null, level: 'PRELIMINARY' })).toBe(false);
    expect(isRelevantChange(null, { severity: 'HIGH', level: 'PRELIMINARY' })).toBe(true);
  });
});
