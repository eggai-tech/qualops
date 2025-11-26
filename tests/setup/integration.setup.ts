import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

jest.setTimeout(300000);

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(100);
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.OPENAI_API_KEY = 'sk-test-key-mock';

const TEST_FIXTURES_DIR = join(__dirname, '../test-fixtures');
const TEST_OUTPUT_BASE_DIR = join(__dirname, '../test-output');

// Create a unique output directory for each test file to avoid race conditions
const TEST_OUTPUT_DIR = join(
  TEST_OUTPUT_BASE_DIR,
  `run-${Date.now()}-${Math.random().toString(36).substring(7)}`,
);

export const getFixturesDir = () => TEST_FIXTURES_DIR;
export const getOutputDir = () => TEST_OUTPUT_DIR;

beforeAll(() => {
  if (!existsSync(TEST_FIXTURES_DIR)) {
    mkdirSync(TEST_FIXTURES_DIR, { recursive: true });
  }
  // Ensure base directory exists
  if (!existsSync(TEST_OUTPUT_BASE_DIR)) {
    mkdirSync(TEST_OUTPUT_BASE_DIR, { recursive: true });
  }
  // Create unique directory for this test run
  mkdirSync(TEST_OUTPUT_DIR, { recursive: true });
});

afterAll(() => {
  // Clean up this test's unique directory
  if (existsSync(TEST_OUTPUT_DIR)) {
    rmSync(TEST_OUTPUT_DIR, { recursive: true, force: true });
  }
});

global.console = {
  ...console,
  log: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};
