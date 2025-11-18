export default {
  displayName: 'qualops-integration',
  preset: './jest.preset.js',
  testEnvironment: 'node',
  setupFilesAfterEnv: ['<rootDir>/src/test-integration-setup.ts'],
  globals: {},
  coverageDirectory: './coverage/integration',
  testMatch: ['**/*.integration.spec.ts'],
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.{spec,test,mock,config,routes}.ts',
    '!<rootDir>/src/**/index.ts',
    '!<rootDir>/src/**/types/**',
    '!<rootDir>/src/**/constants/**',
    '!<rootDir>/src/__tests__/**',
    '!<rootDir>/src/test-*.ts',
  ],
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
  transformIgnorePatterns: ['node_modules/(?!.*\\.mjs$)'],
  maxWorkers: 1,
};
