/** @type {import('jest').Config} */
module.exports = {
  displayName: 'evals',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.spec.js'],
  modulePathIgnorePatterns: ['<rootDir>/datasets/crb/repos/'],
  verbose: true,
};
