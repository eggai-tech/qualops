import { jest } from '@jest/globals';

import { AnthropicProvider } from '@/ai/providers/anthropic';
import type { AIStageConfig } from '@/shared/types';

jest.mock('@/config/env');
jest.mock('@/config/config', () => ({
  ConfigService: {
    getInstance: jest.fn(),
  },
}));
jest.mock('@/shared/utils/logger');
jest.mock('@/ai/shared/token-utils');
jest.mock('@/ai/providers/factory', () => ({
  AIProviderType: {
    ANTHROPIC: 'anthropic',
    BEDROCK: 'bedrock',
    OPENAI: 'openai',
  },
}));

const mockAnthropicClient: any = {
  messages: {
    create: jest.fn(),
  },
};

interface MockAnthropicSDK {
  default: jest.Mock;
}

const mockAnthropicSDK: MockAnthropicSDK = {
  default: jest.fn().mockImplementation(() => mockAnthropicClient),
};

jest.unstable_mockModule('@anthropic-ai/sdk', () => mockAnthropicSDK);

interface MockEnvConfig {
  get: jest.Mock;
  isDevelopment: jest.Mock;
}

interface MockLogger {
  info: jest.Mock;
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
}

describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let mockEnvConfig: MockEnvConfig;
  let mockLogger: MockLogger;
  let mockEstimateTokens: jest.Mock;
  let mockConfigService: { get: jest.Mock };

  const validStageConfig: AIStageConfig = {
    provider: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    temperature: 0,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  };

  const validApiKey = 'sk-ant-' + 'a'.repeat(100);

  beforeEach(async () => {
    jest.clearAllMocks();

    const envConfig = (await import('@/config/env.ts')) as unknown as {
      envConfig: MockEnvConfig;
    };
    mockEnvConfig = {
      get: jest.fn((key: string) => {
        if (key === 'anthropicApiKey') return validApiKey;
        if (key === 'nodeEnv') return 'test';
        return undefined;
      }),
      isDevelopment: jest.fn(() => false),
    };
    envConfig.envConfig = mockEnvConfig;

    const logger = (await import('@/shared/utils/logger.ts')) as unknown as {
      logger: MockLogger;
    };
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.logger = mockLogger;

    const tokenUtils = (await import('@/ai/shared/token-utils.ts')) as unknown as {
      estimateTokens: jest.Mock;
    };
    mockEstimateTokens = jest.fn(() => 100);
    tokenUtils.estimateTokens = mockEstimateTokens;

    const config = (await import('@/config/config.ts')) as unknown as {
      ConfigService: { getInstance: jest.Mock };
    };
    mockConfigService = {
      get: jest.fn(() => undefined), // Default: no cacheTTL set (use 5-minute cache)
    };
    config.ConfigService.getInstance = jest.fn(() => mockConfigService);
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      provider = new AnthropicProvider(validStageConfig);
      expect(provider).toBeInstanceOf(AnthropicProvider);
      expect(provider.name).toBe('anthropic');
    });

    it('should throw error when API key is missing', () => {
      mockEnvConfig.get.mockReturnValue('');
      expect(() => new AnthropicProvider(validStageConfig)).toThrow(
        'ANTHROPIC_API_KEY environment variable is required for anthropic provider',
      );
    });

    it('should throw error when API key format is invalid', () => {
      mockEnvConfig.get.mockReturnValue('invalid-key');
      expect(() => new AnthropicProvider(validStageConfig)).toThrow('Invalid Anthropic API key format');
    });

    it('should throw error when API key is truncated', () => {
      mockEnvConfig.get.mockReturnValue('sk-ant-short');
      expect(() => new AnthropicProvider(validStageConfig)).toThrow('Anthropic API key appears to be truncated');
    });

    it('should throw error when API key contains invalid characters', () => {
      mockEnvConfig.get.mockReturnValue('sk-ant-' + 'a'.repeat(50) + '$invalid' + 'a'.repeat(50));
      expect(() => new AnthropicProvider(validStageConfig)).toThrow('API key contains invalid characters');
    });

    it('should throw error when provider is missing from config', () => {
      const { provider: _provider, ...invalidConfig } = validStageConfig;
      expect(() => new AnthropicProvider(invalidConfig as AIStageConfig)).toThrow(
        'Missing required Anthropic config: provider',
      );
    });

    it('should throw error when model is missing from config', () => {
      const { model: _model, ...invalidConfig } = validStageConfig;
      expect(() => new AnthropicProvider(invalidConfig as AIStageConfig)).toThrow(
        'Missing required Anthropic config: model',
      );
    });

    it('should throw error when inputPerMillion is missing from config', () => {
      const { inputPerMillion: _inputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new AnthropicProvider(invalidConfig as AIStageConfig)).toThrow(
        'Missing required Anthropic config: inputPerMillion',
      );
    });

    it('should throw error when outputPerMillion is missing from config', () => {
      const { outputPerMillion: _outputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new AnthropicProvider(invalidConfig as AIStageConfig)).toThrow(
        'Missing required Anthropic config: outputPerMillion',
      );
    });

    it('should throw error when multiple config fields are missing', () => {
      const invalidConfig = {};
      expect(() => new AnthropicProvider(invalidConfig as AIStageConfig)).toThrow('Missing required Anthropic config');
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      provider = new AnthropicProvider(validStageConfig);
    });

    it('should initialize client successfully', async () => {
      await provider.initialize();
      expect((provider as unknown as { initialized: boolean }).initialized).toBe(true);
      expect((provider as unknown as { client: unknown }).client).toBeDefined();
    });

    it('should not reinitialize if already initialized', async () => {
      await provider.initialize();
      const firstClient = (provider as unknown as { client: unknown }).client;
      await provider.initialize();
      expect((provider as unknown as { client: unknown }).client).toBe(firstClient);
    });

    it('should set initialized flag to true', async () => {
      await provider.initialize();
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('complete', () => {
    beforeEach(async () => {
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
    });

    it('should complete with simple user message', async () => {
      const mockResponse = {
        content: [{ text: 'Hello, world!' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Hello, world!');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });

    it('should handle system prompt parameter', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant',
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [
            {
              type: 'text',
              text: 'You are a helpful assistant',
              cache_control: { type: 'ephemeral' },
            },
          ],
        }),
      );
    });

    it('should handle system messages in messages array', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'Hello' },
        ],
      });

      const call = mockAnthropicClient.messages.create.mock.calls[0][0] as any;
      expect(call.system).toEqual([{ type: 'text', text: 'System message' }]);
      expect(call.messages).toHaveLength(1);
      expect(call.messages[0]).toHaveProperty('role', 'user');
    });

    it('should handle custom temperature', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0.7,
        }),
      );
    });

    it('should handle custom maxTokens', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 1000,
        }),
      );
    });

    it('should handle custom model', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-3-opus-20240229',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        model: 'claude-3-opus-20240229',
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-3-opus-20240229',
        }),
      );
    });

    it('should handle cache creation tokens', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 100,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE WRITE]'));
    });

    it('should handle cache read tokens', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_read_input_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE HIT]'));
    });

    it('should estimate tokens when usage is missing', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockEstimateTokens).toHaveBeenCalled();
    });

    it('should handle empty content response', async () => {
      const mockResponse = {
        content: [],
        usage: { input_tokens: 10, output_tokens: 0 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle API error with 401 status', async () => {
      const error = new Error('Invalid API key');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Anthropic completion failed: Invalid API key');
    });

    it('should handle API error with 429 rate limit', async () => {
      const error = new Error('Rate limit exceeded');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Anthropic completion failed: Rate limit exceeded');
    });

    it('should handle API error with 500 server error', async () => {
      const error = new Error('Internal server error');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Anthropic completion failed: Internal server error');
    });

    it('should handle network error', async () => {
      const error = new Error('Network timeout');
      mockAnthropicClient.messages.create.mockRejectedValue(error);

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Anthropic completion failed: Network timeout');
    });

    it('should update token stats after completion', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.estimatedCost).toBeCloseTo(18.0, 2);
    });

    it('should calculate cost with cache creation tokens', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_creation_input_tokens: 1_000_000,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      // Cost: $3 (input) + $15 (output) + $3.75 (cache write at 1.25x) = $21.75
      expect(stats.estimatedCost).toBeCloseTo(21.75, 2);
    });

    it('should calculate cost with cache read tokens (90% discount)', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 1_000_000,
          output_tokens: 1_000_000,
          cache_read_input_tokens: 1_000_000,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.estimatedCost).toBeCloseTo(18.3, 2);
    });

    it('should handle multiple messages in conversation', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'user', content: 'First message' },
          { role: 'assistant', content: 'First response' },
          { role: 'user', content: 'Second message' },
        ],
      });

      const call = mockAnthropicClient.messages.create.mock.calls[0][0] as any;
      expect(call.messages).toHaveLength(3);
    });

    it('should filter system messages from messages array', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'system', content: 'System 1' },
          { role: 'user', content: 'Hello' },
          { role: 'system', content: 'System 2' },
        ],
      });

      const call = mockAnthropicClient.messages.create.mock.calls[0][0] as any;
      expect(call.messages).toHaveLength(1);
      expect(call.messages[0].role).toBe('user');
    });

    it('should handle message with cache_control', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          {
            role: 'system',
            content: 'Cached system message',
            cache_control: { type: 'ephemeral' },
          } as { role: 'system'; content: string; cache_control: { type: 'ephemeral' } },
          { role: 'user', content: 'Hello' },
        ],
      });

      const call = mockAnthropicClient.messages.create.mock.calls[0][0] as any;
      expect(call.system[0].cache_control).toEqual({ type: 'ephemeral' });
    });
  });

  describe('completeWithStructure', () => {
    beforeEach(async () => {
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
    });

    it('should parse JSON from code block', async () => {
      const mockResponse = {
        content: [{ text: '```json\n{"key": "value"}\n```' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({ key: 'value' });
    });

    it('should parse JSON without code block', async () => {
      const mockResponse = {
        content: [{ text: '{"key": "value"}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({ key: 'value' });
    });

    it('should parse complex nested JSON', async () => {
      const mockResponse = {
        content: [
          {
            text: '```json\n{"nested": {"deep": {"value": 123}}, "array": [1, 2, 3]}\n```',
          },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure<{ nested: { deep: { value: number } }; array: number[] }>({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result.nested.deep.value).toBe(123);
      expect(result.array).toEqual([1, 2, 3]);
    });

    it('should throw error on invalid JSON', async () => {
      const mockResponse = {
        content: [{ text: 'invalid json' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await expect(
        provider.completeWithStructure({
          messages: [{ role: 'user', content: 'Hello' }],
          schema: {},
        }),
      ).rejects.toThrow('Failed to parse structured response');
    });

    it('should handle empty JSON object', async () => {
      const mockResponse = {
        content: [{ text: '{}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({});
    });

    it('should handle JSON array', async () => {
      const mockResponse = {
        content: [{ text: '[1, 2, 3]' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual([1, 2, 3]);
    });

    it('should pass responseFormat as json', async () => {
      const mockResponse = {
        content: [{ text: '{"key": "value"}' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });
  });

  describe('invoke', () => {
    beforeEach(async () => {
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
    });

    it('should invoke with simple prompt', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.invoke('Hello');

      expect(result).toBe('Response');
      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      );
    });

    it('should invoke with custom maxTokens', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.invoke('Hello', 2000);

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 2000,
        }),
      );
    });

    it('should use default maxTokens when not specified', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.invoke('Hello');

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          max_tokens: 8000,
        }),
      );
    });

    it('should handle options parameter', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.invoke('Hello', undefined, { stage: 'test' });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is present', () => {
      provider = new AnthropicProvider(validStageConfig);
      expect(provider.isAvailable()).toBe(true);
    });

    it('should return false when API key is empty', () => {
      mockEnvConfig.get.mockReturnValue('');
      expect(() => new AnthropicProvider(validStageConfig)).toThrow();
    });
  });

  describe('getModelName', () => {
    it('should return configured model name', () => {
      provider = new AnthropicProvider(validStageConfig);
      expect(provider.getModelName()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should return different model name for different config', () => {
      const config = { ...validStageConfig, model: 'claude-3-opus-20240229' };
      provider = new AnthropicProvider(config);
      expect(provider.getModelName()).toBe('claude-3-opus-20240229');
    });
  });

  describe('getMaxTokens', () => {
    it('should return default max tokens', () => {
      provider = new AnthropicProvider(validStageConfig);
      expect(provider.getMaxTokens()).toBe(8000);
    });
  });

  describe('getTokenStats', () => {
    beforeEach(async () => {
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
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
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
    });

    it('should reset all token stats to zero', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_creation_input_tokens: 100,
          cache_read_input_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

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
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
      mockEnvConfig.isDevelopment.mockReturnValue(true);
    });

    it('should not log in production environment', async () => {
      mockEnvConfig.isDevelopment.mockReturnValue(false);
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'anthropicApiKey') return validApiKey;
        if (key === 'nodeEnv') return 'production';
        return undefined;
      });

      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.info).not.toHaveBeenCalled();
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      provider = new AnthropicProvider(validStageConfig);
      await provider.initialize();

      (provider as any).client = mockAnthropicClient;
    });

    it('should handle zero tokens', async () => {
      const mockResponse = {
        content: [{ text: '' }],
        usage: {
          input_tokens: 0,
          output_tokens: 0,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: '' }],
      });

      expect(result.content).toBe('');
      expect(result.usage?.totalTokens).toBe(0);
    });

    it('should handle very large token counts', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 10_000_000,
          output_tokens: 5_000_000,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.totalTokens).toBe(15_000_000);
    });

    it('should handle temperature 0', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 0,
        }),
      );
    });

    it('should handle temperature 1', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 1,
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalledWith(
        expect.objectContaining({
          temperature: 1,
        }),
      );
    });

    it('should handle empty messages array', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [],
      });

      expect(mockAnthropicClient.messages.create).toHaveBeenCalled();
    });

    it('should handle response with undefined usage', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toBeUndefined();
    });

    it('should handle response with partial usage', async () => {
      const mockResponse = {
        content: [{ text: 'Response' }],
        usage: {
          input_tokens: 10,
        },
        model: 'claude-sonnet-4-5-20250929',
      };
      mockAnthropicClient.messages.create.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage?.promptTokens).toBe(10);
    });
  });
});
