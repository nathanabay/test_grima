module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  collectCoverageFrom: ['src/**/*.ts'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  moduleNameMapper: {
    '^@pharmacore/shared$': '<rootDir>/../../packages/shared/src/index.ts',
    '^@pharmacore/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^src/(.*)$': '<rootDir>/src/$1',
  },
  testTimeout: 30000,
};
