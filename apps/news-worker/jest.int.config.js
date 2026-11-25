/**
 * Testes de INTEGRAÇÃO do news-worker: PostgreSQL/PostGIS (banco de testes) e Redis reais.
 * Pré-requisito: `npm run infra:up` e o banco de testes migrado.
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/test'],
  testRegex: '.*\.int-spec\.ts$',
  transform: { '^.+\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/setup-env.ts'],
  testTimeout: 30000,
};
