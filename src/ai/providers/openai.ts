import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { envConfig } from '../../config/env';
import type { ResolvedStageConfig } from '../../shared/types';

export class OpenAIProvider extends OpenAICompatibleProvider {
  private readonly isCustomEndpoint: boolean;

  constructor(stageConfig: ResolvedStageConfig) {
    const apiKey = envConfig.get('openaiApiKey') || '';
    const baseURL = envConfig.get('openaiApiBase');

    super(stageConfig, {
      name: 'openai',
      friendlyName: 'OpenAI',
      apiKey,
      baseURL,
    });

    this.isCustomEndpoint = !!baseURL;
  }

  protected validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for openai provider');
    }

    if (!this.isCustomEndpoint && !this.apiKey.startsWith('sk-')) {
      throw new Error('Invalid OpenAI API key format');
    }
  }
}
