/** Integration + e2e tests: require a migrated and seeded PostgreSQL/PostGIS database. */
module.exports = {
  rootDir: '.',
  testEnvironment: 'node',
  testRegex: '.*\\.(int|e2e)-spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFiles: ['<rootDir>/setup-env.js'],
  testTimeout: 30000,
};
