import type OpenAI from 'openai';
import type { ChatCompletionCreateParamsNonStreaming } from 'openai/resources/chat/completions/completions';

import { estimateTokens } from '@/ai/shared/token-utils';
import { envConfig } from '@/config/env';
import type { AIStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import type { AICompletionOptions, AIProvider, AIResponse, TokenStats } from './provider';

export class GitHubModelsProvider implements AIProvider {
  readonly name = 'github';

  private client: OpenAI | null = null;
  private initialized = false;
  private apiKey: string;
  private maxTokens = 8000;
  private stageConfig: AIStageConfig;
  private readonly tokenStats: TokenStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    invocationCount: 0,
    startTime: new Date(),
    estimatedCost: 0,
  };
  private cachedTokens = 0;
  private cacheHits = 0;

  constructor(stageConfig: AIStageConfig) {
    this.stageConfig = stageConfig;
    this.apiKey = envConfig.get('githubApiKey') || '';

    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    if (!this.apiKey) {
      throw new Error('GITHUB_API_KEY environment variable is required for github provider');
    }

    // GitHub tokens: classic PATs (ghp_), fine-grained PATs (github_pat_), Actions (ghs_), etc.
    if (!/^(gh[a-z]_|github_pat_)/.test(this.apiKey)) {
      throw new Error('Invalid GitHub API key format');
    }

    const required = ['provider', 'model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in this.stageConfig));

    if (missing.length > 0) {
      throw new Error(`Missing required GitHub Models config: ${missing.join(', ')}`);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: 'https://models.github.ai/inference',
        maxRetries: 0,
        timeout: 60000,
      });
      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize GitHub Models provider: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private updateTokenStats(inputTokens: number, outputTokens: number, cachedTokens?: number): void {
    this.tokenStats.totalInputTokens += inputTokens;
    this.tokenStats.totalOutputTokens += outputTokens;
    this.tokenStats.totalTokens += inputTokens + outputTokens;
    this.tokenStats.invocationCount++;

    // Track prompt caching
    if (cachedTokens && cachedTokens > 0) {
      this.cachedTokens += cachedTokens;
      this.cacheHits++;
    }

    const pricing = {
      inputPerMillion: this.stageConfig.inputPerMillion,
      outputPerMillion: this.stageConfig.outputPerMillion,
    };

    // OpenAI gives 50% discount on cached tokens
    const fullPriceTokens = inputTokens - (cachedTokens || 0);
    const cachedPriceTokens = cachedTokens || 0;

    const inputCost = (fullPriceTokens / 1_000_000) * pricing.inputPerMillion;
    const cachedCost = (cachedPriceTokens / 1_000_000) * (pricing.inputPerMillion * 0.5);
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    this.tokenStats.estimatedCost += inputCost + cachedCost + outputCost;

    if (this.tokenStats.invocationCount % 10 === 0 || this.tokenStats.estimatedCost >= 1.0) {
      this.logTokenUsage();
    }
  }

  private logTokenUsage(): void {
    const stats = this.tokenStats;
    const runtime = (Date.now() - stats.startTime.getTime()) / 1000 / 60;

    if (envConfig.isDevelopment() || envConfig.get('nodeEnv') === 'test') {
      logger.info(`\n[TOKEN USAGE] AI Provider Statistics:`);
      logger.info(`   Model: ${this.stageConfig.model}`);
      logger.info(`   Invocations: ${stats.invocationCount}`);
      logger.info(`   Input tokens: ${stats.totalInputTokens.toLocaleString()}`);
      logger.info(`   Output tokens: ${stats.totalOutputTokens.toLocaleString()}`);
      logger.info(`   Total tokens: ${stats.totalTokens.toLocaleString()}`);

      // Prompt caching stats
      if (this.cachedTokens > 0) {
        const cacheHitRate = ((this.cacheHits / stats.invocationCount) * 100).toFixed(1);
        const cachedSavings =
          (this.cachedTokens / 1_000_000) * (this.stageConfig.inputPerMillion * 0.5);
        logger.info(
          `   Cached tokens: ${this.cachedTokens.toLocaleString()} (${cacheHitRate}% cache hit rate)`,
        );
        logger.info(`   Cache savings: $${cachedSavings.toFixed(4)}`);
      }

      logger.info(`   Estimated cost: $${stats.estimatedCost.toFixed(4)}`);
      logger.info(`   Runtime: ${runtime.toFixed(1)} minutes`);
      logger.info(
        `   Avg tokens/call: ${Math.round(stats.invocationCount > 0 ? stats.totalTokens / stats.invocationCount : 0)}`,
      );
    }
  }

  async complete(options: AICompletionOptions): Promise<AIResponse> {
    if (!this.initialized) {
      await this.initialize();
    }

    const {
      messages,
      temperature = this.stageConfig.temperature ?? 0,
      maxTokens = this.maxTokens,
      model = this.stageConfig.model,
      systemPrompt,
    } = options;

    if (!this.client) {
      throw new Error('GitHub Models client not initialized');
    }

    try {
      const openaiMessages = messages.map((m) => ({
        role: m.role,
        content: m.content,
      }));

      if (systemPrompt) {
        openaiMessages.unshift({
          role: 'system',
          content: systemPrompt,
        });
      }

      const options: ChatCompletionCreateParamsNonStreaming = {
        model,
        messages: openaiMessages,
        max_completion_tokens: maxTokens,
      };

      if (!model.includes('gpt-5')) {
        options.temperature = temperature;
      }

      const response = await this.client.chat.completions.create(options);

      const content = response.choices[0]?.message?.content || '';
      const inputTokens = response.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(messages));
      const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
      const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;

      // Log cache hits for visibility
      if (cachedTokens > 0) {
        logger.debug(
          `[CACHE HIT] ${cachedTokens.toLocaleString()} tokens cached (${((cachedTokens / inputTokens) * 100).toFixed(1)}% of input)`,
        );
      }

      this.updateTokenStats(inputTokens, outputTokens, cachedTokens);

      return {
        content,
        usage: response.usage
          ? {
              promptTokens: response.usage.prompt_tokens,
              completionTokens: response.usage.completion_tokens,
              totalTokens: response.usage.total_tokens,
              cachedTokens,
            }
          : undefined,
        model: response.model,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`GitHub Models completion failed: ${message}`);
    }
  }

  async completeWithStructure<T>(options: AICompletionOptions & { schema: unknown }): Promise<T> {
    const response = await this.complete({
      ...options,
      responseFormat: 'json',
    });

    try {
      const jsonMatch = response.content.match(/```json\n?([\s\S]*?)\n?```/);
      const jsonStr = jsonMatch ? jsonMatch[1] : response.content;
      return JSON.parse(jsonStr) as T;
    } catch (error) {
      throw new Error(
        `Failed to parse structured response: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async invoke(prompt: string, maxTokens?: number, _options?: { stage?: string }): Promise<string> {
    const model = this.stageConfig.model;
    const response = await this.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: maxTokens || this.maxTokens,
      model,
    });
    return response.content;
  }

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  getModelName(): string {
    return this.stageConfig.model;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  getTemperature(): number {
    return this.stageConfig.temperature ?? 0;
  }

  getTokenStats(): TokenStats {
    return { ...this.tokenStats };
  }

  resetTokenStats(): void {
    this.tokenStats.totalInputTokens = 0;
    this.tokenStats.totalOutputTokens = 0;
    this.tokenStats.totalTokens = 0;
    this.tokenStats.invocationCount = 0;
    this.tokenStats.startTime = new Date();
    this.tokenStats.estimatedCost = 0;
    this.cachedTokens = 0;
    this.cacheHits = 0;
  }
}
