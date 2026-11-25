import { loadConfig } from './config';

const base = { DATABASE_URL: 'postgresql://u:p@localhost:5432/db' };

describe('loadConfig', () => {
  it('aplica padrões seguros', () => {
    expect(loadConfig(base)).toMatchObject({
      redisUrl: 'redis://localhost:6379',
      redisPrefix: 'alertacidade',
      collectConcurrency: 2,
      analyzeConcurrency: 4,
      analyzeAttempts: 5,
      httpTimeoutMs: 30_000,
    });
  });

  it('falha rápido com todos os problemas de uma vez', () => {
    expect(() => loadConfig({ DATABASE_URL: 'mysql://x', REDIS_URL: 'http://x', NEWS_ANALYZE_ATTEMPTS: '0' })).toThrow(
      /DATABASE_URL deve ser[\s\S]*REDIS_URL deve ser[\s\S]*NEWS_ANALYZE_ATTEMPTS/,
    );
    expect(() => loadConfig({})).toThrow(/DATABASE_URL é obrigatória/);
  });
});
