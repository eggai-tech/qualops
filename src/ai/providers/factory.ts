import { ConfigService } from '../../config/config.ts';
import { AnthropicProvider } from './anthropic.ts';
import { BedrockProvider } from './bedrock.ts';
import { OpenAIProvider } from './openai.ts';
import type { AIProvider } from './provider.ts';

export const AIProviderType = {
  ANTHROPIC: 'anthropic',
  BEDROCK: 'bedrock',
  OPENAI: 'openai',
} as const;

export class AIFactory {
  private static providers: Map<string, AIProvider> = new Map();

  static async createForStage(stage: string): Promise<AIProvider> {
    const config = ConfigService.getInstance();
    const stageConfig = config.getAIStageConfig(stage);
    const providerKey = `${stageConfig.provider}-${stage}`;

    // Return existing provider if available
    if (this.providers.has(providerKey)) {
      const provider = this.providers.get(providerKey);
      if (provider && provider.isAvailable()) {
        return provider;
      }
    }

    // Create new provider
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
      default:
        throw new Error(`Unknown AI provider: ${stageConfig.provider}`);
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

// Global provider management
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
