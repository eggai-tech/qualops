import { envConfig } from '@/config/env';
import type { ResolvedStageConfig } from '@/shared/types';

import { OpenAICompatibleProvider } from './openai-compatible-provider';

export class GitHubModelsProvider extends OpenAICompatibleProvider {
  constructor(stageConfig: ResolvedStageConfig) {
    super(stageConfig, {
      name: 'github',
      friendlyName: 'GitHub Models',
      apiKey: envConfig.get('githubApiKey') || '',
      baseURL: 'https://models.github.ai/inference',
    });
  }

  protected validateApiKey(): void {
    if (!this.apiKey) {
      throw new Error('GITHUB_API_KEY environment variable is required for github provider');
    }

    // GitHub tokens: classic PATs (ghp_), fine-grained PATs (github_pat_), Actions (ghs_), etc.
    if (!/^(gh[a-z]_|github_pat_)/.test(this.apiKey)) {
      throw new Error('Invalid GitHub API key format');
    }
  }
}
