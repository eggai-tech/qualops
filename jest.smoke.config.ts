export default {
  displayName: 'qualops-smoke',
  preset: './jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/smoke.setup.ts'],
  roots: ['<rootDir>/tests/smoke'],
  globals: {},
  testMatch: ['<rootDir>/tests/smoke/**/*.spec.ts'],
  transform: {
    '^.+\\.(ts|mjs|js)$': [
      'ts-jest',
      {
        tsconfig: '<rootDir>/tsconfig.spec.json',
        useESM: true,
      },
    ],
  },
  moduleFileExtensions: ['ts', 'js', 'mjs'],
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  maxWorkers: 1,
};
