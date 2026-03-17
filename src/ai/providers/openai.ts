import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { envConfig } from '../../config/env';
import type { AIStageConfig } from '../../shared/types';

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(stageConfig: AIStageConfig) {
    super(stageConfig, {
      name: 'openai',
      friendlyName: 'OpenAI',
      apiKey: envConfig.get('openaiApiKey') || '',
    });
  }

  protected validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for openai provider');
    }

    // Validate API key format (OpenAI keys should start with 'sk-')
    if (!this.apiKey.startsWith('sk-')) {
      throw new Error('Invalid OpenAI API key format');
    }
  }
}
