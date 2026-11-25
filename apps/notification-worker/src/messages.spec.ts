import { OccurrenceEventPayload } from '@alertacidade/shared-types';
import { loadConfig } from './config';
import { formatDistance, nearbyMessage, statusMessage } from './messages';

const payload: OccurrenceEventPayload = {
  occurrenceId: '00000000-0000-0000-0000-000000000001',
  code: 42,
  severity: 'HIGH',
  status: 'PENDING',
  latitude: -23.55,
  longitude: -46.63,
  neighborhood: 'Sé',
  version: 1,
};

describe('mensagens de notificação', () => {
  it('formata distância como o app', () => {
    expect(formatDistance(850)).toBe('850 m');
    expect(formatDistance(1234)).toBe('1,2 km');
    expect(formatDistance(12400)).toBe('12 km');
  });

  it('alerta de proximidade traz gravidade, distância, bairro e o aviso de relato não oficial', () => {
    const m = nearbyMessage(payload, 650);
    expect(m.title).toBe('Alagamento de gravidade alta a 650 m (Sé)');
    expect(m.body).toContain('#42');
    expect(m.body).toContain('ainda não verificada');
    expect(m.body).toContain('199');
    expect(nearbyMessage({ ...payload, neighborhood: null }, 2000).title).toBe('Alagamento de gravidade alta a 2,0 km');
  });

  it('título nunca passa de 120 caracteres (limite da coluna)', () => {
    expect(nearbyMessage({ ...payload, neighborhood: 'X'.repeat(300) }, 10).title.length).toBeLessThanOrEqual(120);
  });

  it('só validação, rejeição e resolução geram aviso ao autor', () => {
    expect(statusMessage('occurrence.validated', payload)?.title).toBe('Sua ocorrência #42 foi validada');
    expect(statusMessage('occurrence.rejected', payload)?.title).toContain('não foi aprovada');
    expect(statusMessage('occurrence.resolved', payload)?.title).toContain('resolvida');
    expect(statusMessage('occurrence.created', payload)).toBeUndefined();
    expect(statusMessage('occurrence.updated', payload)).toBeUndefined();
  });
});

describe('configuração do worker', () => {
  const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

  it('sem credenciais do Firebase usa o provedor de log', () => {
    expect(loadConfig(base)).toMatchObject({ pushProvider: 'log', redisPrefix: 'alertacidade', concurrency: 5 });
  });

  it('com credenciais usa FCM automaticamente', () => {
    expect(loadConfig({ ...base, FIREBASE_CREDENTIALS_FILE: './sa.json' }).pushProvider).toBe('fcm');
  });

  it('recusa configurações inválidas', () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
    expect(() => loadConfig({ ...base, PUSH_PROVIDER: 'fcm' })).toThrow(/FIREBASE_CREDENTIALS_FILE/);
    expect(() => loadConfig({ ...base, APP_ENV: 'production' })).toThrow(/produção/);
    expect(() => loadConfig({ ...base, WORKER_CONCURRENCY: '0' })).toThrow(/WORKER_CONCURRENCY/);
  });
});
