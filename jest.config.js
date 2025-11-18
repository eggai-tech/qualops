export default {
  displayName: 'qualops',
  preset: './jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
  globals: {},
  coverageDirectory: './coverage',
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.{spec,mock}.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/types/**',
    '!<rootDir>/src/cli.ts',
    '!<rootDir>/src/test-integration-setup.ts',
    '!<rootDir>/src/gitlab/**',
    '!<rootDir>/src/ai/providers.ts',
    '!<rootDir>/src/ai/shared/utils/**',
    '!<rootDir>/src/cli/commands/*-command.ts',
    '!<rootDir>/src/stages/report/formatters/**',
    '!<rootDir>/src/stages/report/templates/**',
    '!<rootDir>/src/stages/fix/generators/**',
  ],
  coverageThreshold: {
    global: {
      statements: 80,
      branches: 76,
      functions: 80,
      lines: 80,
    },
  },
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
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['**/*.spec.ts'],
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
};
