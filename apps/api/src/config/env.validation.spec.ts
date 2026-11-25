import { parseDurationSeconds, validateEnv } from './env.validation';

describe('validateEnv', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    JWT_ACCESS_SECRET: 'x'.repeat(48),
  };

  it('aplica valores padrão seguros', () => {
    const env = validateEnv(base);
    expect(env.API_PORT).toBe(3000);
    expect(env.APP_ENV).toBe('development');
    expect(env.CORS_ORIGINS).toEqual(['http://localhost:5173']);
    expect(env.JWT_ACCESS_TTL_SECONDS).toBe(900);
    expect(env.JWT_REFRESH_TTL_DAYS).toBe(30);
    expect(env.AUTH_THROTTLE_LIMIT).toBe(10);
  });

  it('exige DATABASE_URL e JWT_ACCESS_SECRET', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL é obrigatória[\s\S]*JWT_ACCESS_SECRET é obrigatória/);
  });

  it('rejeita segredo JWT curto', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'curto' })).toThrow(/32 caracteres/);
  });

  it('rejeita o segredo de exemplo em produção', () => {
    expect(() =>
      validateEnv({ ...base, APP_ENV: 'production', JWT_ACCESS_SECRET: 'troque-por-um-segredo-longo-e-aleatorio' }),
    ).toThrow(/valor de exemplo/);
  });

  it('valida Redis e o intervalo do outbox, com padrões para desenvolvimento', () => {
    const env = validateEnv(base);
    expect(env).toMatchObject({ REDIS_URL: 'redis://localhost:6379', REDIS_PREFIX: 'alertacidade', OUTBOX_POLL_MS: 500 });
    expect(() => validateEnv({ ...base, REDIS_URL: 'http://localhost:6379' })).toThrow(/REDIS_URL/);
    expect(() => validateEnv({ ...base, OUTBOX_POLL_MS: '10' })).toThrow(/OUTBOX_POLL_MS/);
    expect(validateEnv({ ...base, REDIS_URL: 'rediss://cache.exemplo:6380' }).REDIS_URL).toBe('rediss://cache.exemplo:6380');
  });

  it('Swagger: ligado em desenvolvimento, desligado em produção salvo pedido explícito', () => {
    expect(validateEnv(base).SWAGGER_ENABLED).toBe(true);
    const prod = { ...base, APP_ENV: 'production', JWT_ACCESS_SECRET: 'x'.repeat(40), CORS_ORIGINS: 'https://painel.exemplo' };
    expect(validateEnv(prod).SWAGGER_ENABLED).toBe(false);
    expect(validateEnv({ ...prod, SWAGGER_ENABLED: 'true' }).SWAGGER_ENABLED).toBe(true);
  });

  it('rejeita porta inválida', () => {
    expect(() => validateEnv({ ...base, API_PORT: '99999' })).toThrow(/API_PORT/);
  });

  it('separa múltiplas origens de CORS', () => {
    const env = validateEnv({ ...base, CORS_ORIGINS: 'http://a.test, http://b.test' });
    expect(env.CORS_ORIGINS).toEqual(['http://a.test', 'http://b.test']);
  });

  it('proíbe CORS curinga em produção', () => {
    expect(() => validateEnv({ ...base, APP_ENV: 'production', CORS_ORIGINS: '*' })).toThrow(/CORS_ORIGINS/);
  });

  it('rejeita TTL de acesso fora da faixa', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: '2d' })).toThrow(/JWT_ACCESS_TTL/);
    expect(() => validateEnv({ ...base, JWT_ACCESS_TTL: '10s' })).toThrow(/JWT_ACCESS_TTL/);
  });
});

describe('parseDurationSeconds', () => {
  it.each([
    ['900', 900],
    ['30s', 30],
    ['15m', 900],
    ['1h', 3600],
  ])('%s => %d', (input, expected) => expect(parseDurationSeconds(input)).toBe(expected));

  it('retorna NaN para formato inválido', () => {
    expect(parseDurationSeconds('quinze')).toBeNaN();
  });
});
