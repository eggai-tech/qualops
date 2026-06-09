import { jest } from '@jest/globals';

import { OpenAICompatibleProvider } from '@/ai/providers/openai-compatible-provider';
import type { AIStageConfig } from '@/shared/types';

jest.mock('@/config/env');
jest.mock('@/config/config');
jest.mock('@/shared/utils/logger');
jest.mock('@/ai/shared/token-utils');

const mockOpenAIClient: any = {
  chat: {
    completions: {
      create: jest.fn(),
    },
  },
};

const mockOpenAIConstructor = jest.fn().mockImplementation(() => mockOpenAIClient);
jest.unstable_mockModule('openai', () => ({ default: mockOpenAIConstructor }));

class TestProvider extends OpenAICompatibleProvider {
  constructor(stageConfig: AIStageConfig, apiKey = 'test-valid-key') {
    super(stageConfig, {
      name: 'test',
      friendlyName: 'Test',
      apiKey,
      baseURL: 'https://test.example.com',
    });
  }

  protected validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error('Test API key is required');
    }
  }
}

describe('OpenAICompatibleProvider', () => {
  let provider: TestProvider;
  let mockEnvConfig: any;
  let mockLogger: any;
  let mockEstimateTokens: jest.Mock;

  const validStageConfig: AIStageConfig = {
    provider: 'openai',
    model: 'test-model',
    temperature: 0,
    inputPerMillion: 2.5,
    outputPerMillion: 10.0,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockOpenAIClient.chat.completions.create.mockReset();

    const envConfig = await import('@/config/env');
    mockEnvConfig = {
      get: jest.fn((key: string) => {
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
      provider = new TestProvider(validStageConfig);
      expect(provider).toBeInstanceOf(TestProvider);
      expect(provider.name).toBe('test');
    });

    it('should throw when provider is missing from config', () => {
      const { provider: _p, ...invalid } = validStageConfig;
      expect(() => new TestProvider(invalid as any)).toThrow(
        'Missing required Test config: provider',
      );
    });

    it('should throw when model is missing from config', () => {
      const { model: _m, ...invalid } = validStageConfig;
      expect(() => new TestProvider(invalid as any)).toThrow('Missing required Test config: model');
    });

    it('should throw when inputPerMillion is missing from config', () => {
      const { inputPerMillion: _i, ...invalid } = validStageConfig;
      expect(() => new TestProvider(invalid as any)).toThrow(
        'Missing required Test config: inputPerMillion',
      );
    });

    it('should throw when outputPerMillion is missing from config', () => {
      const { outputPerMillion: _o, ...invalid } = validStageConfig;
      expect(() => new TestProvider(invalid as any)).toThrow(
        'Missing required Test config: outputPerMillion',
      );
    });

    it('should throw when multiple config fields are missing', () => {
      expect(() => new TestProvider({} as any)).toThrow('Missing required Test config');
    });

    it('should throw when apiKey is empty', () => {
      expect(() => new TestProvider(validStageConfig, '')).toThrow('Test API key is required');
    });
  });

  describe('initialize', () => {
    beforeEach(() => {
      provider = new TestProvider(validStageConfig);
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
  });

  describe('complete', () => {
    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should return content and usage from API response', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Hello, world!' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

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
      expect(result.model).toBe('test-model');
    });

    it('should prepend system prompt when provided', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        systemPrompt: 'You are helpful',
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: 'system', content: 'You are helpful' },
            { role: 'user', content: 'Hello' },
          ],
        }),
      );
    });

    it('should pass temperature and max_tokens for standard models', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        temperature: 0.7,
        maxTokens: 1000,
      });

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.7, max_tokens: 1000 }),
      );
    });

    // gpt-5 is a reasoning model. The OpenAI API rejects calls that include
    // `temperature` ("Unsupported parameter") and treats `max_tokens` as
    // deprecated in favour of `max_completion_tokens`, which covers both
    // internal reasoning tokens and visible output tokens.
    describe('gpt-5 reasoning model parameter restrictions', () => {
      let gpt5Provider: TestProvider;

      beforeEach(async () => {
        gpt5Provider = new TestProvider({ ...validStageConfig, model: 'gpt-5' });
        await gpt5Provider.initialize();
        (gpt5Provider as any).client = mockOpenAIClient;

        mockOpenAIClient.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'gpt-5',
        });
      });

      it('should omit temperature — the API rejects it for reasoning models', async () => {
        await gpt5Provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
        const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
        expect(call.temperature).toBeUndefined();
      });

      it('should omit max_tokens — it is deprecated for gpt-5', async () => {
        await gpt5Provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1000,
        });
        const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
        expect(call.max_tokens).toBeUndefined();
      });

      it('should use max_completion_tokens instead — covers reasoning + output token budget', async () => {
        await gpt5Provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1000,
        });
        const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
        expect(call.max_completion_tokens).toBe(1000);
      });

      it('should also apply to model variants that include "gpt-5" (e.g. gpt-5-mini)', async () => {
        const miniProvider = new TestProvider({ ...validStageConfig, model: 'gpt-5-mini' });
        await miniProvider.initialize();
        (miniProvider as any).client = mockOpenAIClient;

        await miniProvider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

        const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
        expect(call.temperature).toBeUndefined();
        expect(call.max_tokens).toBeUndefined();
        expect(call.max_completion_tokens).toBeDefined();
      });
    });

    describe('non-gpt-5 models use standard parameters', () => {
      it('should send temperature — supported and required for non-reasoning models', async () => {
        mockOpenAIClient.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'test-model',
        });

        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          temperature: 0.7,
        });

        expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
          expect.objectContaining({ temperature: 0.7 }),
        );
      });

      it('should send max_tokens — the non-deprecated form for non-reasoning models', async () => {
        mockOpenAIClient.chat.completions.create.mockResolvedValue({
          choices: [{ message: { content: 'Response' } }],
          usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          model: 'test-model',
        });

        await provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          maxTokens: 1000,
        });

        const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
        expect(call.max_tokens).toBe(1000);
        expect(call.max_completion_tokens).toBeUndefined();
      });
    });

    it('should log cache hit when cached tokens present', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 110,
          completion_tokens: 5,
          total_tokens: 115,
          prompt_tokens_details: { cached_tokens: 100 },
        },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(mockLogger.debug).toHaveBeenCalledWith(expect.stringContaining('[CACHE HIT]'));
    });

    it('should estimate tokens when usage is missing', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(mockEstimateTokens).toHaveBeenCalled();
    });

    it('should return undefined usage when response has no usage', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        model: 'test-model',
      });

      const result = await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(result.usage).toBeUndefined();
    });

    it('should return empty string when choices is empty', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [],
        usage: { prompt_tokens: 10, completion_tokens: 0, total_tokens: 10 },
        model: 'test-model',
      });

      const result = await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(result.content).toBe('');
    });

    it('should throw with friendly name prefix on API error', async () => {
      mockOpenAIClient.chat.completions.create.mockRejectedValue(new Error('Rate limit exceeded'));

      await expect(
        provider.complete({ messages: [{ role: 'user', content: 'Hello' }] }),
      ).rejects.toThrow('Test completion failed: Rate limit exceeded');
    });

    it('should initialize automatically if not yet initialized', async () => {
      const uninitializedProvider = new TestProvider(validStageConfig);
      uninitializedProvider.initialize = jest.fn(async () => {
        (uninitializedProvider as any).client = mockOpenAIClient;
        (uninitializedProvider as any).initialized = true;
      });

      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await uninitializedProvider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(uninitializedProvider.initialize).toHaveBeenCalled();
    });
  });

  describe('complete with schema (json_object fallback dialect)', () => {
    const { z } = require('zod');
    const PingSchema = z.object({ key: z.string() });

    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('parses and validates raw JSON content against the schema', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"key":"value"}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: PingSchema,
        schemaName: 'ping',
      });

      expect(response.content).toEqual({ key: 'value' });
      const call = mockOpenAIClient.chat.completions.create.mock.calls[0][0];
      expect(call.response_format).toEqual({ type: 'json_object' });
    });

    it('parses JSON wrapped in a code fence', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '```json\n{"key":"value"}\n```' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      const response = await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
        schema: PingSchema,
      });

      expect(response.content).toEqual({ key: 'value' });
    });

    it('throws StructuredOutputError when content cannot be parsed', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'not json' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          schema: PingSchema,
        }),
      ).rejects.toThrow();
    });

    it('throws StructuredOutputError when content fails schema validation', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: '{"key":123}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await expect(
        provider.complete({
          messages: [{ role: 'user', content: 'Hello' }],
          schema: PingSchema,
        }),
      ).rejects.toThrow('Schema validation failed');
    });
  });

  describe('invoke', () => {
    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should return content string', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      const result = await provider.invoke('Hello');

      expect(result).toBe('Response');
      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ messages: [{ role: 'user', content: 'Hello' }] }),
      );
    });

    it('should use provided maxTokens', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await provider.invoke('Hello', 2000);

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 2000 }),
      );
    });

    it('should default to 8000 maxTokens', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
        model: 'test-model',
      });

      await provider.invoke('Hello');

      expect(mockOpenAIClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 8000 }),
      );
    });
  });

  describe('isAvailable', () => {
    it('should return true when API key is present', () => {
      provider = new TestProvider(validStageConfig);
      expect(provider.isAvailable()).toBe(true);
    });
  });

  describe('getModelName / getMaxTokens / getTemperature', () => {
    it('should return configured model name', () => {
      provider = new TestProvider(validStageConfig);
      expect(provider.getModelName()).toBe('test-model');
    });

    it('should return 8000 as max tokens', () => {
      provider = new TestProvider(validStageConfig);
      expect(provider.getMaxTokens()).toBe(8000);
    });

    it('should use stageConfig.maxTokens when set', () => {
      provider = new TestProvider({ ...validStageConfig, maxTokens: 4096 });
      expect(provider.getMaxTokens()).toBe(4096);
    });

    it('should return configured temperature', () => {
      provider = new TestProvider({ ...validStageConfig, temperature: 0.5 });
      expect(provider.getTemperature()).toBe(0.5);
    });

    it('should default temperature to 0 when not configured', () => {
      const { temperature: _t, ...config } = validStageConfig;
      provider = new TestProvider(config as any);
      expect(provider.getTemperature()).toBe(0);
    });
  });

  describe('getTokenStats', () => {
    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should return zeroed initial stats', () => {
      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
      expect(stats.startTime).toBeInstanceOf(Date);
    });

    it('should return a copy, not the internal reference', () => {
      expect(provider.getTokenStats()).not.toBe(provider.getTokenStats());
    });

    it('should accumulate stats over multiple completions', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      await provider.complete({ messages: [{ role: 'user', content: 'Hi' }] });

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(200);
      expect(stats.totalOutputTokens).toBe(100);
      expect(stats.totalTokens).toBe(300);
      expect(stats.invocationCount).toBe(2);
    });

    it('should calculate cost correctly', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, total_tokens: 2_000_000 },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      // 1M input @ $2.5/M = $2.5, 1M output @ $10/M = $10 → $12.5
      expect(provider.getTokenStats().estimatedCost).toBeCloseTo(12.5, 2);
    });

    it('should apply 50% discount on cached tokens', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 2_000_000,
          completion_tokens: 1_000_000,
          total_tokens: 3_000_000,
          prompt_tokens_details: { cached_tokens: 1_000_000 },
        },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      // 1M full @ $2.5 + 1M cached @ $1.25 + 1M output @ $10 = $13.75
      expect(provider.getTokenStats().estimatedCost).toBeCloseTo(13.75, 2);
    });
  });

  describe('resetTokenStats', () => {
    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
    });

    it('should reset all stats to zero', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      provider.resetTokenStats();

      const stats = provider.getTokenStats();
      expect(stats.totalInputTokens).toBe(0);
      expect(stats.totalOutputTokens).toBe(0);
      expect(stats.totalTokens).toBe(0);
      expect(stats.invocationCount).toBe(0);
      expect(stats.estimatedCost).toBe(0);
    });
  });

  describe('token logging', () => {
    beforeEach(async () => {
      provider = new TestProvider(validStageConfig);
      await provider.initialize();
      (provider as any).client = mockOpenAIClient;
      mockEnvConfig.isDevelopment.mockReturnValue(true);
    });

    it('should log at every 10th invocation', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'test-model',
      });

      for (let i = 0; i < 10; i++) {
        await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      }

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should log when estimated cost exceeds $1', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100_000_000,
          completion_tokens: 50_000_000,
          total_tokens: 150_000_000,
        },
        model: 'test-model',
      });

      await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });

      expect(mockLogger.info).toHaveBeenCalled();
    });

    it('should not log in production', async () => {
      mockEnvConfig.isDevelopment.mockReturnValue(false);
      mockEnvConfig.get.mockImplementation((key: string) => {
        if (key === 'nodeEnv') return 'production';
        return undefined;
      });

      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
        model: 'test-model',
      });

      for (let i = 0; i < 10; i++) {
        await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      }

      expect(mockLogger.info).not.toHaveBeenCalled();
    });

    it('should include cache stats in log when cached tokens present', async () => {
      mockOpenAIClient.chat.completions.create.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 200,
          completion_tokens: 50,
          total_tokens: 250,
          prompt_tokens_details: { cached_tokens: 100 },
        },
        model: 'test-model',
      });

      for (let i = 0; i < 10; i++) {
        await provider.complete({ messages: [{ role: 'user', content: 'Hello' }] });
      }

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Cache reads/writes'));
    });
  });
});
