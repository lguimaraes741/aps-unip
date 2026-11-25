/**
 * Testes UNITÁRIOS: não dependem de banco, Redis ou rede (`npm run test:unit`).
 * Testes de integração/e2e usam jest.int.config.js.
 * @type {import('jest').Config}
 */
module.exports = {
  rootDir: '.',
  roots: ['<rootDir>/src', '<rootDir>/test'],
  moduleFileExtensions: ['js', 'json', 'ts'],
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  testEnvironment: 'node',
};
