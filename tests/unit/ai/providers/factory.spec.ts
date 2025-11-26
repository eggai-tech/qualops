import { AnthropicProvider } from '@/ai/providers/anthropic';
import { BedrockProvider } from '@/ai/providers/bedrock';
import {
  AIFactory,
  AIProviderType,
  clearGlobalAIProvider,
  getGlobalAIProvider,
  initializeGlobalAIProviderForStage,
} from '@/ai/providers/factory';
import { OpenAIProvider } from '@/ai/providers/openai';
import type { AIProvider } from '@/ai/providers/provider';
import { ConfigService } from '@/config/config';

jest.mock('@/config/config');
jest.mock('@/ai/providers/anthropic');
jest.mock('@/ai/providers/bedrock');
jest.mock('@/ai/providers/openai');
jest.mock('@/shared/utils/logger');

const mockAnthropicProvider = AnthropicProvider as jest.MockedClass<typeof AnthropicProvider>;
const mockBedrockProvider = BedrockProvider as jest.MockedClass<typeof BedrockProvider>;
const mockOpenAIProvider = OpenAIProvider as jest.MockedClass<typeof OpenAIProvider>;

describe('AIFactory', () => {
  let mockConfigInstance: jest.Mocked<ConfigService>;

  beforeEach(() => {
    jest.clearAllMocks();
    AIFactory.clear();
    clearGlobalAIProvider();

    mockConfigInstance = {
      getAIStageConfig: jest.fn(),
    } as any;

    jest.spyOn(ConfigService, 'getInstance').mockReturnValue(mockConfigInstance);

    const createMockProvider = (name: string): jest.Mocked<AIProvider> => ({
      name,
      initialize: jest.fn().mockResolvedValue(undefined),
      complete: jest.fn(),
      completeWithStructure: jest.fn(),
      invoke: jest.fn(),
      isAvailable: jest.fn().mockReturnValue(true),
      getModelName: jest.fn().mockReturnValue('test-model'),
      getMaxTokens: jest.fn().mockReturnValue(8000),
      getTemperature: jest.fn().mockReturnValue(0),
      getTokenStats: jest.fn(),
      resetTokenStats: jest.fn(),
    });

    mockAnthropicProvider.mockImplementation(
      () => createMockProvider(AIProviderType.ANTHROPIC) as any,
    );
    mockBedrockProvider.mockImplementation(() => createMockProvider(AIProviderType.BEDROCK) as any);
    mockOpenAIProvider.mockImplementation(() => createMockProvider(AIProviderType.OPENAI) as any);
  });

  describe('createForStage', () => {
    it('should create Anthropic provider for anthropic stage config', async () => {
      const stageConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider = await AIFactory.createForStage('review');

      expect(mockConfigInstance.getAIStageConfig).toHaveBeenCalledWith('review');
      expect(mockAnthropicProvider).toHaveBeenCalledWith(stageConfig);
      expect(provider.initialize).toHaveBeenCalled();
      expect(provider.name).toBe(AIProviderType.ANTHROPIC);
    });

    it('should create Bedrock provider for bedrock stage config', async () => {
      const stageConfig = {
        provider: AIProviderType.BEDROCK,
        model: 'anthropic.claude-v2',
        inputPerMillion: 2.5,
        outputPerMillion: 10,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider = await AIFactory.createForStage('analyze');

      expect(mockConfigInstance.getAIStageConfig).toHaveBeenCalledWith('analyze');
      expect(mockBedrockProvider).toHaveBeenCalledWith(stageConfig);
      expect(provider.initialize).toHaveBeenCalled();
      expect(provider.name).toBe(AIProviderType.BEDROCK);
    });

    it('should create OpenAI provider for openai stage config', async () => {
      const stageConfig = {
        provider: AIProviderType.OPENAI,
        model: 'gpt-4',
        inputPerMillion: 5,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider = await AIFactory.createForStage('fix');

      expect(mockConfigInstance.getAIStageConfig).toHaveBeenCalledWith('fix');
      expect(mockOpenAIProvider).toHaveBeenCalledWith(stageConfig);
      expect(provider.initialize).toHaveBeenCalled();
      expect(provider.name).toBe(AIProviderType.OPENAI);
    });

    it('should throw error for unknown provider', async () => {
      const stageConfig = {
        provider: 'unknown-provider',
        model: 'test-model',
        inputPerMillion: 1,
        outputPerMillion: 1,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig as any);

      await expect(AIFactory.createForStage('review')).rejects.toThrow(
        'Unknown AI provider: unknown-provider',
      );
    });

    it('should reuse existing provider if available', async () => {
      const stageConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider1 = await AIFactory.createForStage('review');
      const provider2 = await AIFactory.createForStage('review');

      expect(provider1).toBe(provider2);
      expect(mockAnthropicProvider).toHaveBeenCalledTimes(1);
      expect(provider1.initialize).toHaveBeenCalledTimes(1);
    });

    it('should create new provider if existing one is not available', async () => {
      const stageConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider1 = await AIFactory.createForStage('review');
      (provider1.isAvailable as jest.Mock).mockReturnValue(false);

      const provider2 = await AIFactory.createForStage('review');

      expect(provider1).not.toBe(provider2);
      expect(mockAnthropicProvider).toHaveBeenCalledTimes(2);
    });

    it('should create different providers for different stages', async () => {
      const reviewConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      const analyzeConfig = {
        provider: AIProviderType.OPENAI,
        model: 'gpt-4',
        inputPerMillion: 5,
        outputPerMillion: 15,
      };

      mockConfigInstance.getAIStageConfig
        .mockReturnValueOnce(reviewConfig)
        .mockReturnValueOnce(analyzeConfig);

      const reviewProvider = await AIFactory.createForStage('review');
      const analyzeProvider = await AIFactory.createForStage('analyze');

      expect(reviewProvider).not.toBe(analyzeProvider);
      expect(reviewProvider.name).toBe(AIProviderType.ANTHROPIC);
      expect(analyzeProvider.name).toBe(AIProviderType.OPENAI);
    });

    it('should throw error when stage config is not found', async () => {
      mockConfigInstance.getAIStageConfig.mockImplementation(() => {
        throw new Error('AI configuration for stage "invalid" not found in .qualopsrc.json');
      });

      await expect(AIFactory.createForStage('invalid')).rejects.toThrow(
        'AI configuration for stage "invalid" not found in .qualopsrc.json',
      );
    });

    it('should cache providers with unique keys per stage and provider', async () => {
      const anthropicConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      const openaiConfig = {
        provider: AIProviderType.OPENAI,
        model: 'gpt-4',
        inputPerMillion: 5,
        outputPerMillion: 15,
      };

      mockConfigInstance.getAIStageConfig
        .mockReturnValueOnce(anthropicConfig)
        .mockReturnValueOnce(openaiConfig)
        .mockReturnValueOnce(anthropicConfig);

      const provider1 = await AIFactory.createForStage('review');
      const provider2 = await AIFactory.createForStage('analyze');
      const provider3 = await AIFactory.createForStage('review');

      expect(provider1).toBe(provider3);
      expect(provider1).not.toBe(provider2);
    });
  });

  describe('clear', () => {
    it('should clear all cached providers', async () => {
      const stageConfig = {
        provider: AIProviderType.ANTHROPIC,
        model: 'claude-3-sonnet',
        inputPerMillion: 3,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      await AIFactory.createForStage('review');
      AIFactory.clear();
      await AIFactory.createForStage('review');

      expect(mockAnthropicProvider).toHaveBeenCalledTimes(2);
    });

    it('should allow creating new providers after clear', async () => {
      const stageConfig = {
        provider: AIProviderType.OPENAI,
        model: 'gpt-4',
        inputPerMillion: 5,
        outputPerMillion: 15,
      };
      mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

      const provider1 = await AIFactory.createForStage('fix');
      AIFactory.clear();
      const provider2 = await AIFactory.createForStage('fix');

      expect(provider1).not.toBe(provider2);
    });
  });

  describe('getAvailableProviders', () => {
    it('should return all available provider types', () => {
      const providers = AIFactory.getAvailableProviders();

      expect(providers).toEqual([
        AIProviderType.ANTHROPIC,
        AIProviderType.BEDROCK,
        AIProviderType.OPENAI,
      ]);
    });

    it('should return array with correct length', () => {
      const providers = AIFactory.getAvailableProviders();

      expect(providers).toHaveLength(3);
    });

    it('should return array containing anthropic provider', () => {
      const providers = AIFactory.getAvailableProviders();

      expect(providers).toContain(AIProviderType.ANTHROPIC);
    });

    it('should return array containing bedrock provider', () => {
      const providers = AIFactory.getAvailableProviders();

      expect(providers).toContain(AIProviderType.BEDROCK);
    });

    it('should return array containing openai provider', () => {
      const providers = AIFactory.getAvailableProviders();

      expect(providers).toContain(AIProviderType.OPENAI);
    });
  });

  describe('global provider management', () => {
    describe('initializeGlobalAIProviderForStage', () => {
      it('should initialize and return global provider', async () => {
        const stageConfig = {
          provider: AIProviderType.ANTHROPIC,
          model: 'claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        const provider = await initializeGlobalAIProviderForStage('review');

        expect(provider).toBeDefined();
        expect(provider.name).toBe(AIProviderType.ANTHROPIC);
      });

      it('should allow getting global provider after initialization', async () => {
        const stageConfig = {
          provider: AIProviderType.OPENAI,
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        await initializeGlobalAIProviderForStage('analyze');
        const provider = getGlobalAIProvider();

        expect(provider).toBeDefined();
        expect(provider.name).toBe(AIProviderType.OPENAI);
      });

      it('should replace existing global provider', async () => {
        const anthropicConfig = {
          provider: AIProviderType.ANTHROPIC,
          model: 'claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        };
        const openaiConfig = {
          provider: AIProviderType.OPENAI,
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        };

        mockConfigInstance.getAIStageConfig
          .mockReturnValueOnce(anthropicConfig)
          .mockReturnValueOnce(openaiConfig);

        const provider1 = await initializeGlobalAIProviderForStage('review');
        const provider2 = await initializeGlobalAIProviderForStage('analyze');

        expect(provider1.name).toBe(AIProviderType.ANTHROPIC);
        expect(provider2.name).toBe(AIProviderType.OPENAI);
        expect(getGlobalAIProvider()).toBe(provider2);
      });
    });

    describe('getGlobalAIProvider', () => {
      it('should throw error when global provider not initialized', () => {
        expect(() => getGlobalAIProvider()).toThrow(
          'Global AI provider not initialized. Call initializeGlobalAIProvider() first.',
        );
      });

      it('should return initialized global provider', async () => {
        const stageConfig = {
          provider: AIProviderType.BEDROCK,
          model: 'anthropic.claude-v2',
          inputPerMillion: 2.5,
          outputPerMillion: 10,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        await initializeGlobalAIProviderForStage('judge');
        const provider = getGlobalAIProvider();

        expect(provider.name).toBe(AIProviderType.BEDROCK);
      });

      it('should throw error after clearing global provider', async () => {
        const stageConfig = {
          provider: AIProviderType.ANTHROPIC,
          model: 'claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        await initializeGlobalAIProviderForStage('review');
        clearGlobalAIProvider();

        expect(() => getGlobalAIProvider()).toThrow(
          'Global AI provider not initialized. Call initializeGlobalAIProvider() first.',
        );
      });
    });

    describe('clearGlobalAIProvider', () => {
      it('should clear global provider and factory cache', async () => {
        const stageConfig = {
          provider: AIProviderType.OPENAI,
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        await initializeGlobalAIProviderForStage('fix');
        clearGlobalAIProvider();

        expect(() => getGlobalAIProvider()).toThrow();
      });

      it('should allow re-initialization after clear', async () => {
        const stageConfig = {
          provider: AIProviderType.ANTHROPIC,
          model: 'claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        };
        mockConfigInstance.getAIStageConfig.mockReturnValue(stageConfig);

        await initializeGlobalAIProviderForStage('review');
        clearGlobalAIProvider();
        await initializeGlobalAIProviderForStage('review');

        expect(getGlobalAIProvider()).toBeDefined();
      });

      it('should not throw when clearing uninitialized provider', () => {
        expect(() => clearGlobalAIProvider()).not.toThrow();
      });
    });
  });

  describe('AIProviderType constant', () => {
    it('should have correct anthropic value', () => {
      expect(AIProviderType.ANTHROPIC).toBe('anthropic');
    });

    it('should have correct bedrock value', () => {
      expect(AIProviderType.BEDROCK).toBe('bedrock');
    });

    it('should have correct openai value', () => {
      expect(AIProviderType.OPENAI).toBe('openai');
    });
  });
});
