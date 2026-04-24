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

  function envGet(apiKey: string, baseURL?: string) {
    return (key: string) => {
      if (key === 'openaiApiKey') return apiKey;
      if (key === 'openaiApiBase') return baseURL;
      return undefined;
    };
  }

  beforeEach(async () => {
    jest.clearAllMocks();

    const envConfig = (await import('@/config/env')) as unknown as {
      envConfig: MockEnvConfig;
    };
    mockEnvConfig = {
      get: jest.fn(envGet('sk-test-key')),
      isDevelopment: jest.fn(() => false),
    };
    envConfig.envConfig = mockEnvConfig;
  });

  it('should create instance with name "openai" for a valid sk- key', () => {
    const provider = new OpenAIProvider(validStageConfig);
    expect(provider.name).toBe('openai');
  });

  it('should throw when OPENAI_API_KEY is missing', () => {
    mockEnvConfig.get.mockImplementation(envGet(''));
    expect(() => new OpenAIProvider(validStageConfig)).toThrow(
      'OPENAI_API_KEY environment variable is required for openai provider',
    );
  });

  it.each(['invalid-key', 'github_pat_abc'])('should throw for invalid key format "%s"', (key) => {
    mockEnvConfig.get.mockImplementation(envGet(key));
    expect(() => new OpenAIProvider(validStageConfig)).toThrow('Invalid OpenAI API key format');
  });

  it.each(['sk-abc', 'sk-proj-abc123', 'sk-org-xyz'])('should accept key "%s"', (key) => {
    mockEnvConfig.get.mockImplementation(envGet(key));
    expect(() => new OpenAIProvider(validStageConfig)).not.toThrow();
  });

  it('should throw for invalid OPENAI_BASE_URL', () => {
    mockEnvConfig.get.mockImplementation(envGet('sk-test', 'not-a-url'));
    expect(() => new OpenAIProvider(validStageConfig)).toThrow(
      'OPENAI_BASE_URL must be a valid http/https URL',
    );
  });

  it('should accept a valid OPENAI_BASE_URL', () => {
    mockEnvConfig.get.mockImplementation(
      envGet('sk-test', 'https://my-resource.openai.azure.com/openai/deployments/gpt-4o'),
    );
    expect(() => new OpenAIProvider(validStageConfig)).not.toThrow();
  });
});
