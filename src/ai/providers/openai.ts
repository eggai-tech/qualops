import { OpenAICompatibleProvider } from './openai-compatible-provider';
import { envConfig } from '../../config/env';
import type { ResolvedStageConfig } from '../../shared/types';
import { assertHttpUrl } from '../../shared/utils/security';

export class OpenAIProvider extends OpenAICompatibleProvider {
  private readonly isCustomEndpoint: boolean;

  constructor(stageConfig: ResolvedStageConfig) {
    const apiKey = envConfig.get('openaiApiKey') || '';
    const rawBaseURL = stageConfig.baseUrl ?? envConfig.get('openaiBaseUrl');

    if (rawBaseURL) assertHttpUrl(rawBaseURL, 'OPENAI_BASE_URL');

    const isCustomEndpoint = !!rawBaseURL;

    super(stageConfig, {
      name: 'openai',
      friendlyName: 'OpenAI',
      apiKey,
      baseURL: rawBaseURL,
      skipKeyFormatValidation: isCustomEndpoint,
    });

    this.isCustomEndpoint = isCustomEndpoint;
  }

  protected validateApiKey(): void {
    // openai-compatible providers (e.g., Ollama) may not require an API key
    if (this.stageConfig.provider === 'openai-compatible') return;

    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY environment variable is required for openai provider');
    }

    if (!this.skipKeyFormatValidation && !this.apiKey.startsWith('sk-')) {
      throw new Error('Invalid OpenAI API key format');
    }
  }
}
