import { jest } from '@jest/globals';

import { OpenAIProvider } from '@/ai/providers/openai';
import type { AIStageConfig } from '@/shared/types';

jest.mock('@/config/env');

interface MockEnvConfig {
  get: jest.Mock;
  isDevelopment: jest.Mock;
}

describe('OpenAIProvider', () => {
  let mockEnvConfig: MockEnvConfig;

  const validStageConfig: AIStageConfig = {
    provider: 'openai',
    model: 'gpt-4o',
    temperature: 0,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const envConfig = (await import('@/config/env')) as unknown as {
      envConfig: MockEnvConfig;
    };
    mockEnvConfig = {
      get: jest.fn((key: string) => {
        if (key === 'openaiApiKey') return 'sk-test-key';
        return undefined;
      }),
      isDevelopment: jest.fn(() => false),
    };
    envConfig.envConfig = mockEnvConfig;
  });

  it('should create instance with name "openai" for a valid sk- key', () => {
    const provider = new OpenAIProvider(validStageConfig);
    expect(provider.name).toBe('openai');
  });

  it('should throw when OPENAI_API_KEY is missing', () => {
    mockEnvConfig.get.mockReturnValue('');
    expect(() => new OpenAIProvider(validStageConfig)).toThrow(
      'OPENAI_API_KEY environment variable is required for openai provider',
    );
  });

  it.each(['invalid-key', 'github_pat_abc'])('should throw for invalid key format "%s"', (key) => {
    mockEnvConfig.get.mockReturnValue(key);
    expect(() => new OpenAIProvider(validStageConfig)).toThrow('Invalid OpenAI API key format');
  });

  it.each(['sk-abc', 'sk-proj-abc123', 'sk-org-xyz'])('should accept key "%s"', (key) => {
    mockEnvConfig.get.mockReturnValue(key);
    expect(() => new OpenAIProvider(validStageConfig)).not.toThrow();
  });
});
