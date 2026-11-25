/**
 * Testes de INTEGRAÇÃO e E2E: usam PostgreSQL/PostGIS real e isolado (TEST_DATABASE_URL).
 * Pré-requisito: `npm run infra:up` na raiz.
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.(int-spec|e2e-spec)\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
  globalSetup: '<rootDir>/test/global-setup.ts',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
