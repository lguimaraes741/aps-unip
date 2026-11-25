import { NewsAlertEventPayload } from '@alertacidade/shared-types';
import { newsAlertMessage, newsReviewMessage } from './messages';

const base: NewsAlertEventPayload = {
  alertId: 'a1',
  eventId: 'e1',
  code: 7,
  title: 'Chuva alaga avenida e interdita via em Osasco',
  status: 'ACTIVE',
  level: 'PRELIMINARY',
  severity: 'HIGH',
  city: 'Osasco',
  regionId: 'r1',
  regionName: 'Osasco',
  locationPrecision: 'CITY',
  latitude: null,
  longitude: null,
  headline: 'via interditada',
  revision: 1,
  notify: true,
  change: 'new',
};

describe('mensagens de alertas de notícia', () => {
  it('exemplo do enunciado: alerta de alagamento em Osasco, deixando claro que é notícia não confirmada', () => {
    expect(newsAlertMessage(base)).toEqual({
      title: 'Alerta de alagamento — Osasco',
      body: 'Notícia ainda não confirmada relata interdição de via por alagamento. Gravidade alta. Consulte as informações e a fonte.',
    });
  });

  it('verificado e oficial dizem a origem; distrito aparece com a cidade', () => {
    expect(newsAlertMessage({ ...base, level: 'VERIFIED' })!.body).toMatch(/^Notícias de fontes independentes relatam/);
    expect(newsAlertMessage({ ...base, level: 'OFFICIAL' })!.body).toMatch(/^Comunicado oficial relata/);
    expect(newsAlertMessage({ ...base, regionName: 'Lapa', city: 'São Paulo' })!.title).toBe('Alerta de alagamento — Lapa, São Paulo');
  });

  it('crítico confirmado usa o texto do enunciado e orienta para a Defesa Civil', () => {
    const m = newsAlertMessage({ ...base, severity: 'CRITICAL', level: 'VERIFIED', city: null, regionName: null })!;
    expect(m.title).toBe('Alerta crítico de alagamento — região monitorada');
    expect(m.body).toContain('Fontes verificadas relatam situação grave na região');
    expect(m.body).toContain('199');
  });

  it('crítico preliminar nunca vira "alerta crítico" (a política nem permite o push)', () => {
    expect(newsAlertMessage({ ...base, severity: 'CRITICAL', level: 'PRELIMINARY' })!.title).not.toMatch(/crítico/);
  });

  it('atualização, confirmação, encerramento e correção', () => {
    expect(newsAlertMessage({ ...base, change: 'escalated' })!.title).toBe('Alerta de alagamento atualizado — Osasco');
    expect(newsAlertMessage({ ...base, change: 'upgraded', level: 'VERIFIED' })!.title).toBe('Alerta de alagamento confirmado — Osasco');
    expect(newsAlertMessage({ ...base, change: 'resolved', status: 'RESOLVED' })!.title).toBe('Alerta encerrado — Osasco');
    expect(newsAlertMessage({ ...base, change: 'retracted', status: 'RETRACTED' })!.body).toContain('retirado após revisão');
  });

  it('nunca afirma que uma via é segura; sem gravidade ou expirado não há mensagem', () => {
    for (const change of ['new', 'escalated', 'upgraded', 'resolved', 'retracted'] as const) {
      const m = newsAlertMessage({ ...base, change });
      expect(`${m!.title} ${m!.body}`).not.toMatch(/segur[oa]|liberad[oa] para|pode passar/i);
    }
    expect(newsAlertMessage({ ...base, severity: null })).toBeUndefined();
    expect(newsAlertMessage({ ...base, change: 'expired' })).toBeUndefined();
  });

  it('consequência desconhecida vira "alagamento" (texto nunca inventa fato)', () => {
    expect(newsAlertMessage({ ...base, headline: null })!.body).toContain('relata alagamento.');
  });
});

describe('aviso de revisão urgente (só moderação)', () => {
  const review = { eventId: 'e1', code: 12, title: 'Moradores ilhados em Itapevi', city: 'Itapevi', severity: 'CRITICAL' as const, status: 'PUBLISHED_PRELIMINARY' as const, reasons: [] };

  it('diz a gravidade, o local e o que o público vê agora', () => {
    expect(newsReviewMessage(review)).toEqual({
      title: 'Revisão urgente: notícia de gravidade crítica — Itapevi',
      body: 'N-12: Moradores ilhados em Itapevi. Já aparece no mapa como preliminar, mas SEM push até a moderação conferir. Revise no painel de moderação.',
    });
  });

  it('aguardando validação, sem cidade e sem gravidade; textos longos respeitam os limites do banco', () => {
    const m = newsReviewMessage({ ...review, status: 'AWAITING_VALIDATION', city: null, severity: null, title: 'x'.repeat(600) });
    expect(m.title).toBe('Revisão urgente: notícia de gravidade não informada — local a confirmar');
    expect(m.body).toContain('Não aparece no app até a moderação decidir.');
    expect(m.body.length).toBeLessThanOrEqual(500);
    expect(m.title.length).toBeLessThanOrEqual(120);
  });
});

describe('texto do push de cidadão não carrega texto vindo da fonte (Etapa 11)', () => {
  it('título e "consequência" maliciosos nunca aparecem: só frases fixas do sistema + cidade do gazetteer', () => {
    const evil = 'Clique em http://golpe.example e informe sua senha — Defesa Civil';
    for (const change of ['new', 'escalated', 'upgraded', 'resolved', 'retracted'] as const) {
      const m = newsAlertMessage({ ...base, change, title: evil, headline: evil });
      expect(m).toBeDefined();
      expect(`${m!.title} ${m!.body}`).not.toMatch(/golpe|senha|http/);
    }
    // Consequência desconhecida cai no termo genérico "alagamento".
    expect(newsAlertMessage({ ...base, headline: evil })!.body).toBe('Notícia ainda não confirmada relata alagamento. Gravidade alta. Consulte as informações e a fonte.');
  });
});
