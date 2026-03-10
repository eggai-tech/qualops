jest.setTimeout(10000);

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'sk-ant-' + 'a'.repeat(100);
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.OPENAI_API_KEY = 'sk-test-key-mock';
process.env.GITHUB_API_KEY = 'gho_test-key-mock';

const originalConsole = {
  log: console.log,
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};

global.console = {
  ...console,
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
};

export const restoreConsole = () => {
  global.console = originalConsole as Console;
};

export const enableConsole = () => {
  global.console = originalConsole as Console;
};
