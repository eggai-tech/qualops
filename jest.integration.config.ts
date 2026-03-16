export default {
  displayName: 'qualops-integration',
  preset: './jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/tests/setup/integration.setup.ts'],
  roots: ['<rootDir>/tests/integration'],
  globals: {},
  coverageDirectory: './coverage/integration',
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.{spec,test,mock,config,routes}.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/types/**',
    '!<rootDir>/src/**/constants/**',
  ],
  testMatch: ['<rootDir>/tests/integration/**/*.integration.spec.ts'],
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
