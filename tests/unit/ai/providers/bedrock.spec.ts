import { jest } from '@jest/globals';

import type { AIStageConfig } from '@/shared/types';
import { BedrockProvider } from '@/ai/providers/bedrock';

jest.mock('@/config/env');
jest.mock('@/config/config');
jest.mock('@/shared/utils/logger');
jest.mock('@/ai/shared/token-utils');
jest.mock('@/ai/providers/factory', () => ({
  AIProviderType: {
    ANTHROPIC: 'anthropic',
    BEDROCK: 'bedrock',
    OPENAI: 'openai',
  },
}));

interface MockBedrockClient {
  send: jest.Mock;
}

const mockBedrockClient: any = {
  send: jest.fn(),
};

interface MockBedrockSDK {
  BedrockRuntimeClient: jest.Mock;
  InvokeModelCommand: jest.Mock;
}

const mockBedrockSDK: MockBedrockSDK = {
  BedrockRuntimeClient: jest.fn().mockImplementation(() => mockBedrockClient),
  InvokeModelCommand: jest.fn(),
};

jest.unstable_mockModule('@aws-sdk/client-bedrock-runtime', () => mockBedrockSDK);

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

describe('BedrockProvider', () => {
  let provider: BedrockProvider;
  let mockEnvConfig: MockEnvConfig;
  let mockLogger: MockLogger;
  let mockEstimateTokens: jest.Mock;

  const validStageConfig: AIStageConfig = {
    provider: 'bedrock',
    model: 'anthropic.claude-sonnet-4-5-20250929-v2:0',
    temperature: 0,
    inputPerMillion: 3.0,
    outputPerMillion: 15.0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const envConfig = (await import('@/config/env.ts')) as unknown as { envConfig: MockEnvConfig };
    mockEnvConfig = {
      get: jest.fn((key: string) => {
        if (key === 'awsRegion') return 'us-east-1';
        if (key === 'awsAccessKeyId') return 'test-access-key';
        if (key === 'awsSecretAccessKey') return 'test-secret-key';
        return undefined;
      }),
      isDevelopment: jest.fn(() => false),
    };
    envConfig.envConfig = mockEnvConfig;

    const logger = (await import('@/shared/utils/logger.ts')) as unknown as { logger: MockLogger };
    mockLogger = {
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    logger.logger = mockLogger;

    const tokenUtils = (await import('@/ai/shared/token-utils.ts')) as unknown as { estimateTokens: jest.Mock };
    mockEstimateTokens = jest.fn(() => 100);
    tokenUtils.estimateTokens = mockEstimateTokens;
  });

  describe('constructor', () => {
    it('should create instance with valid config', () => {
      provider = new BedrockProvider(validStageConfig);
      expect(provider).toBeInstanceOf(BedrockProvider);
      expect(provider.name).toBe('bedrock');
    });

    it('should throw error when AWS_REGION is missing', () => {
      mockEnvConfig.get.mockReturnValue(undefined);
      expect(() => new BedrockProvider(validStageConfig)).toThrow(
        'AWS_REGION environment variable is required for bedrock provider',
      );
    });

    it('should throw error when AWS_ACCESS_KEY_ID is missing', () => {
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'awsRegion') return 'us-east-1';
        if (key === 'awsAccessKeyId') return undefined;
        return undefined;
      });
      expect(() => new BedrockProvider(validStageConfig)).toThrow(
        'AWS_ACCESS_KEY_ID environment variable is required for bedrock provider',
      );
    });

    it('should throw error when AWS_SECRET_ACCESS_KEY is missing', () => {
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'awsRegion') return 'us-east-1';
        if (key === 'awsAccessKeyId') return 'test-key';
        if (key === 'awsSecretAccessKey') return undefined;
        return undefined;
      });
      expect(() => new BedrockProvider(validStageConfig)).toThrow(
        'AWS_SECRET_ACCESS_KEY environment variable is required for bedrock provider',
      );
    });

    it('should throw error when provider is missing from config', () => {
      const { provider: _provider, ...invalidConfig } = validStageConfig;
      expect(() => new BedrockProvider(invalidConfig as any)).toThrow('Missing required Bedrock config: provider');
    });

    it('should throw error when model is missing from config', () => {
      const { model: _model, ...invalidConfig } = validStageConfig;
      expect(() => new BedrockProvider(invalidConfig as any)).toThrow('Missing required Bedrock config: model');
    });

    it('should throw error when inputPerMillion is missing from config', () => {
      const { inputPerMillion: _inputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new BedrockProvider(invalidConfig as any)).toThrow(
        'Missing required Bedrock config: inputPerMillion',
      );
    });

    it('should throw error when outputPerMillion is missing from config', () => {
      const { outputPerMillion: _outputPerMillion, ...invalidConfig } = validStageConfig;
      expect(() => new BedrockProvider(invalidConfig as any)).toThrow(
        'Missing required Bedrock config: outputPerMillion',
      );
    });

    it('should use environment AWS_REGION when config not provided', () => {
      const oldRegion = process.env.AWS_REGION;
      process.env.AWS_REGION = 'eu-west-1';
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'awsRegion') return 'eu-west-1';
        if (key === 'awsAccessKeyId') return 'test-key';
        if (key === 'awsSecretAccessKey') return 'test-secret';
        return undefined;
      });
      provider = new BedrockProvider(validStageConfig);
      expect(provider).toBeInstanceOf(BedrockProvider);
      process.env.AWS_REGION = oldRegion;
    });

    it('should default to eu-west-1 region when not specified', () => {
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'awsAccessKeyId') return 'test-key';
        if (key === 'awsSecretAccessKey') return 'test-secret';
        if (key === 'awsRegion') return undefined;
        return undefined;
      });
      const oldRegion = process.env.AWS_REGION;
      delete process.env.AWS_REGION;
      expect(() => new BedrockProvider(validStageConfig)).toThrow();
      process.env.AWS_REGION = oldRegion;
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      provider = new BedrockProvider(validStageConfig);
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

    it('should throw error if SDK import fails', async () => {
      (provider as unknown as { initialize: () => Promise<void> }).initialize = async () => {
        throw new Error('Failed to initialize AWS Bedrock client');
      };

      await expect(provider.initialize()).rejects.toThrow('Failed to initialize AWS Bedrock client');
    });
  });

  describe('complete', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as unknown as { client: MockBedrockClient }).client = mockBedrockClient;
    });

    it('should complete with simple user message', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Hello, world!' }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Hello, world!');
      expect(result.usage).toEqual({
        promptTokens: 10,
        completionTokens: 5,
        totalTokens: 15,
      });
    });

    it('should handle system prompt parameter', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are a helpful assistant',
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle system messages in messages array', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'system', content: 'System message' },
          { role: 'user', content: 'Hello' },
        ],
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle custom temperature', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle custom maxTokens', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        maxTokens: 1000,
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle responseFormat json', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: '{"key": "value"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        responseFormat: 'json',
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle cache creation tokens', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_creation_input_tokens: 100,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE WRITE]'));
    });

    it('should handle cache read tokens', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE HIT]'));
    });

    it('should estimate tokens when usage is missing', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(mockEstimateTokens).toHaveBeenCalled();
    });

    it('should handle empty content response', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [],
            usage: { input_tokens: 10, output_tokens: 0 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle output_text type content', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'output_text', text: 'Output text' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Output text');
    });

    it('should handle multiple text blocks', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              { type: 'text', text: 'First' },
              { type: 'text', text: 'Second' },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('First\nSecond');
    });

    it('should filter non-text blocks', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              { type: 'text', text: 'Text' },
              { type: 'tool_use', name: 'tool' },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Text');
    });

    it('should handle string response body', async () => {
      const mockResponse = {
        body: JSON.stringify({
          content: [{ type: 'text', text: 'Response' }],
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Response');
    });

    it('should handle response body with text() method', async () => {
      const mockResponse = {
        body: {
          text: () =>
            JSON.stringify({
              content: [{ type: 'text', text: 'Response' }],
              usage: { input_tokens: 10, output_tokens: 5 },
            }),
        },
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Response');
    });

    it('should handle invalid JSON in response', async () => {
      mockBedrockClient.send.mockResolvedValue({
        body: new TextEncoder().encode('invalid json'),
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        }),
      ).rejects.toThrow('Failed to parse AWS Bedrock response');
    });

    it('should update token stats after completion', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

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
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 1_000_000,
              output_tokens: 1_000_000,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.estimatedCost).toBeCloseTo(18.0, 2);
    });

    it('should log token stats at intervals', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 1000,
              output_tokens: 500,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      for (let i = 0; i < 5; i++) {
        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
        });
      }

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('[TOKENS][Bedrock]'));
    });

    it('should handle empty messages array', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [],
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should convert assistant role correctly', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [
          { role: 'user', content: 'Hello' },
          { role: 'assistant', content: 'Hi' },
        ],
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });
  });

  describe('completeWithStructure', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as unknown as { client: MockBedrockClient }).client = mockBedrockClient;
    });

    it('should parse JSON response', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: '{"key": "value"}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({ key: 'value' });
    });

    it('should parse complex nested JSON', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: '{"nested": {"deep": {"value": 123}}, "array": [1, 2, 3]}',
              },
            ],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure<{ nested: { deep: { value: number } }; array: number[] }>({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result.nested.deep.value).toBe(123);
      expect(result.array).toEqual([1, 2, 3]);
    });

    it('should throw error on invalid JSON', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'invalid json' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await expect(
        provider.completeWithStructure({
          messages: [{ role: 'user', content: 'Hello' }],
          schema: {},
        }),
      ).rejects.toThrow('Failed to parse structured response from AWS Bedrock');
    });

    it('should handle empty JSON object', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: '{}' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual({});
    });

    it('should handle JSON array', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: '[1, 2, 3]' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.completeWithStructure({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: {},
      });

      expect(result).toEqual([1, 2, 3]);
    });
  });

  describe('invoke', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockBedrockClient;
    });

    it('should invoke with simple prompt', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.invoke('Hello');

      expect(result).toBe('Response');
    });

    it('should invoke with custom maxTokens', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.invoke('Hello', 2000);

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle options parameter', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.invoke('Hello', undefined, { stage: 'test', enableCaching: true });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });
  });

  describe('isAvailable', () => {
    it('should return false before initialization', () => {
      provider = new BedrockProvider(validStageConfig);
      expect(provider.isAvailable()).toBe(false);
    });

    it('should return true after initialization', async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('getModelName', () => {
    it('should return configured model name', () => {
      provider = new BedrockProvider(validStageConfig);
      expect(provider.getModelName()).toBe('anthropic.claude-sonnet-4-5-20250929-v2:0');
    });

    it('should return different model name for different config', () => {
      const config = { ...validStageConfig, model: 'anthropic.claude-3-opus-20240229-v1:0' };
      provider = new BedrockProvider(config);
      expect(provider.getModelName()).toBe('anthropic.claude-3-opus-20240229-v1:0');
    });
  });

  describe('getMaxTokens', () => {
    it('should return default max tokens', () => {
      provider = new BedrockProvider(validStageConfig);
      expect(provider.getMaxTokens()).toBe(4000);
    });
  });

  describe('getTokenStats', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockBedrockClient;
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
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

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
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockBedrockClient;
    });

    it('should reset all token stats to zero', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

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
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
              cache_creation_input_tokens: 100,
              cache_read_input_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

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

  describe('getDetailedTokenStats', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockBedrockClient;
    });

    it('should return stats with pricing information', () => {
      const stats = provider.getDetailedTokenStats();
      expect(stats.inputCostPerMillion).toBe(3.0);
      expect(stats.outputCostPerMillion).toBe(15.0);
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
    });

    it('should include all base stats', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 100,
              output_tokens: 50,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getDetailedTokenStats();
      expect(stats.totalInputTokens).toBe(100);
      expect(stats.totalOutputTokens).toBe(50);
      expect(stats.invocationCount).toBe(1);
    });
  });

  describe('edge cases', () => {
    beforeEach(async () => {
      provider = new BedrockProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockBedrockClient;
    });

    it('should handle zero tokens', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: '' }],
            usage: {
              input_tokens: 0,
              output_tokens: 0,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: '' }],
      });

      expect(result.content).toBe('');
      expect(result.usage?.totalTokens).toBe(0);
    });

    it('should handle very large token counts', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: {
              input_tokens: 10_000_000,
              output_tokens: 5_000_000,
            },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      const stats = provider.getTokenStats();
      expect(stats.totalTokens).toBe(15_000_000);
    });

    it('should handle temperature 0', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0,
      });

      expect(mockBedrockClient.send).toHaveBeenCalled();
    });

    it('should handle response with undefined usage', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text', text: 'Response' }],
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.usage).toBeUndefined();
    });

    it('should handle non-array content', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: 'not an array',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('');
    });

    it('should handle content blocks without text', async () => {
      const mockResponse = {
        body: new TextEncoder().encode(
          JSON.stringify({
            content: [{ type: 'text' }, { type: 'text', text: 'Valid' }],
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
        ),
      };
      mockBedrockClient.send.mockResolvedValue(mockResponse);

      const result = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      });

      expect(result.content).toBe('Valid');
    });
  });
});
