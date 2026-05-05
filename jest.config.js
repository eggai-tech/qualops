export default {
  displayName: 'qualops',
  preset: './jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/unit.setup.ts'],
  roots: ['<rootDir>/tests/unit'],
  globals: {},
  coverageDirectory: './coverage',
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/types/**',
    '!<rootDir>/src/cli.ts',
    '!<rootDir>/src/gitlab/**',
    '!<rootDir>/src/ai/providers.ts',
    '!<rootDir>/src/ai/shared/utils/**',
    '!<rootDir>/src/cli/commands/*-command.ts',
    '!<rootDir>/src/stages/report/formatters/**',
    '!<rootDir>/src/stages/report/templates/**',
    '!<rootDir>/src/stages/fix/generators/**',
    // Bash tool sandbox drivers and spawn-level session wrappers require integration tests
    '!<rootDir>/src/stages/review/agentic/tools/bash/modes/**',
    '!<rootDir>/src/stages/review/agentic/tools/bash/exec.ts',
    '!<rootDir>/src/stages/review/agentic/tools/bash/session-impl.ts',
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
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@tests/(.*)$': '<rootDir>/tests/$1',
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testMatch: ['<rootDir>/tests/unit/**/*.spec.ts'],
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
};
