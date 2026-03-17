import { jest } from '@jest/globals';

import { GitHubModelsProvider } from '@/ai/providers/github';
import type { AIStageConfig } from '@/shared/types';

jest.mock('@/config/env');

interface MockEnvConfig {
  get: jest.Mock;
  isDevelopment: jest.Mock;
}

describe('GitHubModelsProvider', () => {
  let mockEnvConfig: any;

  const validStageConfig: AIStageConfig = {
    provider: 'github',
    model: 'openai/gpt-4.1',
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
        if (key === 'githubApiKey') return 'gho_test-key';
        return undefined;
      }),
      isDevelopment: jest.fn(() => false),
    };
    envConfig.envConfig = mockEnvConfig;
  });

  it('should create instance with name "github" for a valid gho_ key', () => {
    const provider = new GitHubModelsProvider(validStageConfig);
    expect(provider.name).toBe('github');
  });

  it('should throw when GITHUB_API_KEY is missing', () => {
    mockEnvConfig.get.mockReturnValue('');
    expect(() => new GitHubModelsProvider(validStageConfig)).toThrow(
      'GITHUB_API_KEY environment variable is required for github provider',
    );
  });

  it('should throw when API key does not match a GitHub token format', () => {
    mockEnvConfig.get.mockReturnValue('invalid-key');
    expect(() => new GitHubModelsProvider(validStageConfig)).toThrow(
      'Invalid GitHub API key format',
    );
  });

  it.each(['ghp_classic', 'gho_oauth', 'ghs_actions', 'github_pat_fine_grained'])(
    'should accept valid GitHub token format: %s',
    (key) => {
      mockEnvConfig.get.mockReturnValue(key);
      expect(() => new GitHubModelsProvider(validStageConfig)).not.toThrow();
    },
  );
});
