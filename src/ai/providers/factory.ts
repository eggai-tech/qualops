import { AnthropicProvider } from './anthropic';
import { BedrockProvider } from './bedrock';
import { GitHubModelsProvider } from './github';
import { OpenAIProvider } from './openai';
import type { AIProvider } from './provider';
import { ConfigService } from '../../config/config';
import type { ResolvedStageConfig } from '../../shared/types';

export const AIProviderType = {
  ANTHROPIC: 'anthropic',
  BEDROCK: 'bedrock',
  OPENAI: 'openai',
  GITHUB: 'github',
} as const;

export class AIFactory {
  private static providers: Map<string, AIProvider> = new Map();

  static async createForStage(stage: string): Promise<AIProvider> {
    const stageConfig: ResolvedStageConfig =
      ConfigService.getInstance().getResolvedStageConfig(stage);
    const providerKey = `${stageConfig.provider}-${stage}`;

    if (this.providers.has(providerKey)) {
      const existingProvider = this.providers.get(providerKey);
      if (existingProvider && existingProvider.isAvailable()) {
        return existingProvider;
      }
    }

    let provider: AIProvider;

    switch (stageConfig.provider) {
      case AIProviderType.ANTHROPIC:
        provider = new AnthropicProvider(stageConfig);
        break;
      case AIProviderType.BEDROCK:
        provider = new BedrockProvider(stageConfig);
        break;
      case AIProviderType.OPENAI:
        provider = new OpenAIProvider(stageConfig);
        break;
      case AIProviderType.GITHUB:
        provider = new GitHubModelsProvider(stageConfig);
        break;
      default: {
        const _exhaustiveCheck: never = stageConfig.provider;
        throw new Error(`Unknown AI provider: ${_exhaustiveCheck}`);
      }
    }

    await provider.initialize();
    this.providers.set(providerKey, provider);

    return provider;
  }

  static clear(): void {
    this.providers.clear();
  }

  static getAvailableProviders(): string[] {
    return Object.values(AIProviderType);
  }
}

let globalProvider: AIProvider | null = null;

export async function initializeGlobalAIProviderForStage(stage: string): Promise<AIProvider> {
  globalProvider = await AIFactory.createForStage(stage);
  return globalProvider;
}

export function getGlobalAIProvider(): AIProvider {
  if (!globalProvider) {
    throw new Error('Global AI provider not initialized. Call initializeGlobalAIProvider() first.');
  }
  return globalProvider;
}

export function clearGlobalAIProvider(): void {
  globalProvider = null;
  AIFactory.clear();
}
