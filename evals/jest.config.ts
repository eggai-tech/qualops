import type { Config } from 'jest';

const config: Config = {
  displayName: 'evals',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.spec.ts'],
  modulePathIgnorePatterns: ['<rootDir>/datasets/crb/repos/'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }],
  },
  moduleNameMapper: {
    // Strip `.js` from relative ESM-style imports so TS sources resolve under
    // ts-jest (mirrors the root jest config). Needed when eval specs import
    // production modules that use explicit `.js` extensions internally.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    '^@/(.*)$': '<rootDir>/../src/$1',
  },
  verbose: true,
};

export default config;
