import { jest } from '@jest/globals';
import type OpenAI from 'openai';
import type { ChatCompletion } from 'openai/resources/chat/completions/completions';

import { GithubModelsProvider } from '@/ai/providers/github';
import type { AIStageConfig } from '@/shared/types';

jest.mock('@/config/env');
jest.mock('@/config/config');
jest.mock('@/shared/utils/logger');
jest.mock('@/ai/shared/token-utils');
jest.mock('@/ai/providers/factory', () => ({
  AIProviderType: {
    ANTHROPIC: 'anthropic',
    BEDROCK: 'bedrock',
    OPENAI: 'openai',
    GITHUB: 'github',
  },
}));

const mockOpenAIClient = {
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
} as unknown as OpenAI;

const mockOpenAIConstructor = jest.fn().mockImplementation(() => mockOpenAIClient);
const mockOpenAISDK: any = {
  default: mockOpenAIConstructor,
};

jest.unstable_mockModule('openai', () => mockOpenAISDK);

describe('GithubModelsProvider', () => {
  let provider: GithubModelsProvider;
  let mockEnvConfig: any;
  let mockLogger: any;
  let mockEstimateTokens: jest.Mock;

  const validStageConfig: AIStageConfig = {
    provider: 'github',
    model: 'openai/gpt-4.1',
    temperature: 0,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  };

  const validApiKey = 'gho_test-key-1234567890';

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.mocked(mockOpenAIClient.chat.completions.create).mockReset();

    const envConfig = await import('@/config/env');
    mockEnvConfig = {
      get: jest.fn((key: string) => {
        if (key === 'githubApiKey') return validApiKey;
        if (key === 'nodeEnv') return 'test';
        return undefined;
      }),
      isDevelopment: jest.fn(() => false),
    };
    (envConfig as any).envConfig = mockEnvConfig;

    const logger = await import('@/shared/utils/logger');
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    (logger as any).logger = mockLogger;

    const tokenUtils = await import('@/ai/shared/token-utils');
    mockEstimateTokens = jest.fn(() => 100);
    (tokenUtils as any).estimateTokens = mockEstimateTokens;
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      provider = new GithubModelsProvider(validStageConfig);
      expect(provider).toBeInstanceOf(GithubModelsProvider);
      expect(provider.name).toBe('github');
    });

    it('should throw error when API key is missing', () => {
      mockEnvConfig.get.mockReturnValue('');
      expect(() => new GithubModelsProvider(validStageConfig)).toThrow(
        'GITHUB_API_KEY environment variable is required for github provider',
      );
    });

    it('should throw error when API key format is invalid', () => {
      mockEnvConfig.get.mockReturnValue('invalid-key');
      expect(() => new GithubModelsProvider(validStageConfig)).toThrow(
        'Invalid GitHub API key format',
      );
    });

    it('should accept API key starting with gho_', () => {
      mockEnvConfig.get.mockReturnValue('gho_validkey');
      provider = new GithubModelsProvider(validStageConfig);
      expect(provider).toBeInstanceOf(GithubModelsProvider);
    });

    it('should throw error when provider is missing from config', () => {
      const { provider: _provider, ...invalidConfig } = validStageConfig;
      expect(() => new GithubModelsProvider(invalidConfig as any)).toThrow(
        'Missing required GitHub Models config: provider',
      );
    });

    it('should throw error when model is missing from config', () => {
      const { model: _model, ...invalidConfig } = validStageConfig;
      expect(() => new GithubModelsProvider(invalidConfig as any)).toThrow(
        'Missing required GitHub Models config: model',
      );
    });

    it('should throw error when inputPerMillion is missing from config', () => {
      const { inputPerMillion: _inputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new GithubModelsProvider(invalidConfig as any)).toThrow(
        'Missing required GitHub Models config: inputPerMillion',
      );
    });

    it('should throw error when outputPerMillion is missing from config', () => {
      const { outputPerMillion: _outputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new GithubModelsProvider(invalidConfig as any)).toThrow(
        'Missing required GitHub Models config: outputPerMillion',
      );
    });

    it('should throw error when multiple config fields are missing', () => {
      const invalidConfig = {};
      expect(() => new GithubModelsProvider(invalidConfig as any)).toThrow(
        'Missing required GitHub Models config',
      );
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      provider = new GithubModelsProvider(validStageConfig);
    });

    it('should initialize client successfully', async () => {
      await provider.initialize();
      expect((provider as any).initialized).toBe(true);
      expect((provider as any).client).toBeDefined();
    });

    it('should not reinitialize if already initialized', async () => {
      await provider.initialize();
      const firstClient = (provider as any).client;
      await provider.initialize();
      expect((provider as any).client).toBe(firstClient);
    });

    it('should handle initialization error', async () => {
      provider.initialize = async () => {
        throw new Error('Failed to initialize OpenAI provider: Import failed');
      };

      await expect(provider.initialize()).rejects.toThrow(
        'Failed to initialize OpenAI provider: Import failed',
      );
    });
  });

  describe('complete', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should complete with simple user message', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: 'Hello, world!',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Hello, world!');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
        cachedTokens: 0,
      });
      expect(result.model).toBe('openai/gpt-4o');
    });

    it('should handle system prompt parameter', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant',
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are a helpful assistant' },
            { role: 'user', content: 'Hello' },
          ],
        }),
      );
    });

    it('should handle system messages in messages array', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'Hello' },
        ],
      });

      const call = jest.mocked(mockOpenAIClient.chat.completions.create).mock.calls[0][0];
      expect(call.messages[0].role).toBe('system');
      expect(call.messages[1].role).toBe('user');
    });

    it('should prioritize systemPrompt over system messages', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'Hello' },
        ],
        systemPrompt: 'Priority system',
      });

      const call = jest.mocked(mockOpenAIClient.chat.completions.create).mock.calls[0][0];
      expect(call.messages[0].content).toBe('Priority system');
    });

    it('should handle custom temperature', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it('should handle custom maxTokens', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
        }),
      );
    });

    it('should handle custom model', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'gpt-4-turbo',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'gpt-4-turbo',
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'gpt-4-turbo',
        }),
      );
    });

    it('should handle cached tokens', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 110,
          completion_tokens: 5,
          total_tokens: 115,
          prompt_tokens_details: {
            cached_tokens: 100,
          },
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE HIT]'));
    });

    it('should estimate tokens when usage is missing', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockEstimateTokens).toHaveBeenCalled();
    });

    it('should handle empty content response', async () => {
      const mockResponse = {
        choices: [{ message: { content: '' } }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle missing choices array', async () => {
      const mockResponse = {
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle null content in choice', async () => {
      const mockResponse = {
        choices: [{ message: { content: null } }],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle API error with 401 status', async () => {
      const error = new Error('Invalid API key');
      jest.mocked(mockOpenAIClient.chat.completions.create).mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('GitHub Models completion failed: Invalid API key');
    });

    it('should handle API error with 429 rate limit', async () => {
      const error = new Error('Rate limit exceeded');
      jest.mocked(mockOpenAIClient.chat.completions.create).mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('GitHub Models completion failed: Rate limit exceeded');
    });

    it('should handle API error with 500 server error', async () => {
      const error = new Error('Internal server error');
      jest.mocked(mockOpenAIClient.chat.completions.create).mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('GitHub Models completion failed: Internal server error');
    });

    it('should handle network error', async () => {
      const error = new Error('Network timeout');
      jest.mocked(mockOpenAIClient.chat.completions.create).mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('GitHub Models completion failed: Network timeout');
    });

    it('should update token stats after completion', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(100);
      expect(stats.totalOutputTokens).toBe(50);
      expect(stats.totalTokens).toBe(150);
      expect(stats.invocationCount).toBe(1);
    });

    it('should calculate cost correctly', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 1_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 2_000_000,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.estimatedCost).toBeCloseTo(12.5, 2);
    });

    it('should calculate cost with cached tokens (50% discount)', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 2_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 3_000_000,
          prompt_tokens_details: {
            cached_tokens: 1_000_000,
          },
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.estimatedCost).toBeCloseTo(13.75, 2);
    });

    it('should handle multiple messages in conversation', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });

      const call = jest.mocked(mockOpenAIClient.chat.completions.create).mock.calls[0][0];
      expect(call.messages).toHaveLength(3);
    });

    it('should initialize before completing if not initialized', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const uninitializedProvider = new GithubModelsProvider(validStageConfig);
      const _originalInitialize = uninitializedProvider.initialize.bind(uninitializedProvider);
      uninitializedProvider.initialize = jest.fn(async () => {
        (uninitializedProvider as any).client = mockOpenAIClient;
        (uninitializedProvider as any).initialized = true;
      });

      await uninitializedProvider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(uninitializedProvider.initialize).toHaveBeenCalled();
    });
  });

  describe('completeWithStructure', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should parse JSON from code block', async () => {
      const mockResponse = {
        choices: [{ message: { content: '```json\n{"key": "value"}\n```' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON without code block', async () => {
      const mockResponse = {
        choices: [{ message: { content: '{"key": "value"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({ key: 'value' });
    });

    it('should parse complex nested JSON', async () => {
      const mockResponse = {
        choices: [
          {
            message: {
              content: '```json\n{"nested": {"deep": {"value": 123}}, "array": [1, 2, 3]}\n```',
            },
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure<any>({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result.nested.deep.value).toBe(123);
      expect(result.array).toEqual([1, 2, 3]);
    });

    it('should throw error on invalid JSON', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'invalid json' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await expect(
        provider.completeWithStructure({
          messages: [{ role: 'user', content: 'Hello' }],
          schema: {},
        }),
      ).rejects.toThrow('Failed to parse structured response');
    });

    it('should handle empty JSON object', async () => {
      const mockResponse = {
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({});
    });

    it('should handle JSON array', async () => {
      const mockResponse = {
        choices: [{ message: { content: '[1, 2, 3]' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual([1, 2, 3]);
    });

    it('should pass responseFormat as json', async () => {
      const mockResponse = {
        choices: [{ message: { content: '{"key": "value"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: expect.objectContaining({
            type: 'json_object',
          }),
        }),
      );
    });
  });

  describe('invoke', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should invoke with simple prompt', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.invoke('Hello');

      expect(result).toBe('Response');
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should invoke with custom maxTokens', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.invoke('Hello', 2000);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        }),
      );
    });

    it('should use default maxTokens when not specified', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.invoke('Hello');

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8000,
        }),
      );
    });

    it('should handle options parameter', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.invoke('Hello', undefined, { stage: 'test' });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is present', () => {
      provider = new GithubModelsProvider(validStageConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it('should throw when API key is empty', () => {
      mockEnvConfig.get.mockReturnValue('');
      expect(() => new GithubModelsProvider(validStageConfig)).toThrow();
    });
  });

  describe('getModelName', () => {
    it('should return configured model name', () => {
      provider = new GithubModelsProvider(validStageConfig);
      expect(provider.getModelName()).toBe('openai/gpt-4.1');
    });

    it('should return different model name for different config', () => {
      const config = { ...validStageConfig, model: 'gpt-4-turbo' };
      provider = new GithubModelsProvider(config);
      expect(provider.getModelName()).toBe('gpt-4-turbo');
    });
  });

  describe('getMaxTokens', () => {
    it('should return default max tokens', () => {
      provider = new GithubModelsProvider(validStageConfig);
      expect(provider.getMaxTokens()).toBe(8000);
    });
  });

  describe('getTokenStats', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should return initial stats', () => {
      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });

    it('should return copy of stats, not reference', () => {
      const stats1 = provider.getTokenStats();
      const stats2 = provider.getTokenStats();
      expect(stats1).not.toBe(stats2);
    });

    it('should accumulate stats over multiple completions', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello again' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(200);
      expect(stats.totalOutputTokens).toBe(100);
      expect(stats.totalTokens).toBe(300);
      expect(stats.invocationCount).toBe(2);
    });
  });

  describe('resetTokenStats', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should reset all token stats to zero', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      provider.resetTokenStats();

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });

    it('should reset cache stats', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: {
            cached_tokens: 50,
          },
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      provider.resetTokenStats();

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(0);
    });

    it('should update startTime on reset', () => {
      const stats1 = provider.getTokenStats();
      const time1 = stats1.startTime.getTime();

      setTimeout(() => {
        provider.resetTokenStats();
        const stats2 = provider.getTokenStats();
        const time2 = stats2.startTime.getTime();
        expect(time2).toBeGreaterThanOrEqual(time1);
      }, 10);
    });
  });

  describe('token logging', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
      mockEnvConfig.isDevelopment.mockReturnValue(true);
    });

    it('should log at 10 invocation intervals', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      for (let i = 0; i < 10; i++) {
        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        });
      }

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should log when cost exceeds threshold', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100_000_000,
          completion_tokens: 50_000_000,
          total_tokens: 150_000_000,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should not log in production environment', async () => {
      mockEnvConfig.isDevelopment.mockReturnValue(false);
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'githubApiKey') return validApiKey;
        if (key === 'nodeEnv') return 'production';
        return undefined;
      });

      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      for (let i = 0; i < 10; i++) {
        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        });
      }

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should include cache stats in log', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 50,
          total_tokens: 250,
          prompt_tokens_details: {
            cached_tokens: 100,
          },
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      for (let i = 0; i < 10; i++) {
        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        });
      }

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Cached tokens'));
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      provider = new GithubModelsProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should handle zero tokens', async () => {
      const mockResponse = {
        choices: [{ message: { content: '' } }],
        usage: {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: '' }],
      });

      expect(result.content).toBe('');
      expect(result.usage?.totalTokens).toBe(0);
    });

    it('should handle very large token counts', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 10_000_000,
          completion_tokens: 5_000_000,
          total_tokens: 15_000_000,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.totalTokens).toBe(15_000_000);
    });

    it('should handle temperature 0', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });

    it('should handle temperature 1', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 1,
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 1,
        }),
      );
    });

    it('should handle empty messages array', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [],
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalled();
    });

    it('should handle response with undefined usage', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toBeUndefined();
    });

    it('should handle response with partial usage', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 10,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage?.promptTokens).toBe(10);
    });

    it('should handle cached_tokens as 0', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          prompt_tokens_details: {
            cached_tokens: 0,
          },
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).not.toHaveBeenCalled();
    });

    it('should handle missing prompt_tokens_details', async () => {
      const mockResponse = {
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
        model: 'openai/gpt-4o',
      } as Partial<ChatCompletion> as ChatCompletion;
      jest.mocked(mockOpenAIClient.chat.completions.create).mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage?.cachedTokens).toBe(0);
    });
  });
});
