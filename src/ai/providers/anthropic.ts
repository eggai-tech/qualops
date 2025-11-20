import type Anthropic from '@anthropic-ai/sdk';

import { estimateTokens } from '@/ai/shared/token-utils';
import { ConfigService } from '@/config/config';
import { envConfig } from '@/config/env';
import type { AIStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import { AIProviderType } from './factory';
import type { AICompletionOptions, AIProvider, AIResponse, TokenStats } from './provider';

export class AnthropicProvider implements AIProvider {
  readonly name = AIProviderType.ANTHROPIC;
  private client: Anthropic | null = null;
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
  private cacheCreationTokens = 0;
  private cacheReadTokens = 0;
  private cacheHits = 0;
  private cache1HourCreationTokens = 0;

  constructor(stageConfig: AIStageConfig) {
    this.stageConfig = stageConfig;
    this.apiKey = envConfig.get('anthropicApiKey') || '';

    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for anthropic provider');
    }

    // Validate API key format
    if (!this.apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid Anthropic API key format');
    }

    // Validate API key length (Anthropic keys should be at least 100 characters)
    if (this.apiKey.length < 100) {
      throw new Error('Anthropic API key appears to be truncated');
    }

    // Validate API key contains only valid characters (alphanumeric, hyphens, underscores)
    if (!/^[a-zA-Z0-9_-]+$/.test(this.apiKey)) {
      throw new Error('API key contains invalid characters');
    }

    const required = ['provider', 'model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in this.stageConfig));

    if (missing.length > 0) {
      throw new Error(`Missing required Anthropic config: ${missing.join(', ')}`);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;

    const { default: Anthropic } = await import('@anthropic-ai/sdk');

    this.client = new Anthropic({
      apiKey: this.apiKey,
      maxRetries: 3,
      timeout: 200000,
    });
    this.initialized = true;
  }

  private updateTokenStats(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number,
    use1HourCache?: boolean,
  ): void {
    this.tokenStats.totalInputTokens += inputTokens;
    this.tokenStats.totalOutputTokens += outputTokens;
    this.tokenStats.totalTokens += inputTokens + outputTokens;
    this.tokenStats.invocationCount++;

    if (cacheCreationTokens && cacheCreationTokens > 0) {
      this.cacheCreationTokens += cacheCreationTokens;
      if (use1HourCache) {
        this.cache1HourCreationTokens += cacheCreationTokens;
      }
    }
    if (cacheReadTokens && cacheReadTokens > 0) {
      this.cacheReadTokens += cacheReadTokens;
      this.cacheHits++;
    }

    const pricing = {
      inputPerMillion: this.stageConfig.inputPerMillion,
      outputPerMillion: this.stageConfig.outputPerMillion,
    };

    const regularInputCost = (inputTokens / 1_000_000) * pricing.inputPerMillion;

    // Apply correct pricing multiplier based on cache TTL:
    // - 5-minute cache: 1.25x base price
    // - 1-hour cache: 2x base price
    const cacheWriteMultiplier = use1HourCache ? 2.0 : 1.25;
    const cacheWriteCost = ((cacheCreationTokens || 0) / 1_000_000) * (pricing.inputPerMillion * cacheWriteMultiplier);

    // Cache reads are always 0.1x (90% discount)
    const cacheReadCost = ((cacheReadTokens || 0) / 1_000_000) * (pricing.inputPerMillion * 0.1);
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    this.tokenStats.estimatedCost += regularInputCost + cacheWriteCost + cacheReadCost + outputCost;
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

      if (this.cacheReadTokens > 0 || this.cacheCreationTokens > 0) {
        const cacheHitRate = ((this.cacheHits / stats.invocationCount) * 100).toFixed(1);
        const cacheReadSavings = (this.cacheReadTokens / 1_000_000) * (this.stageConfig.inputPerMillion * 0.9);
        logger.info(`   Cache creation tokens: ${this.cacheCreationTokens.toLocaleString()}`);
        logger.info(`   Cache read tokens: ${this.cacheReadTokens.toLocaleString()} (${cacheHitRate}% cache hit rate)`);
        logger.info(`   Cache savings: $${cacheReadSavings.toFixed(4)} (90% discount on reads)`);
      }

      logger.info(`   Estimated cost: $${stats.estimatedCost.toFixed(4)}`);
      logger.info(`   Runtime: ${runtime.toFixed(1)} minutes`);
      logger.info(
        `   Avg tokens/call: ${Math.round(stats.invocationCount > 0 ? stats.totalTokens / stats.invocationCount : 0)}`,
      );
    }
  }

  async complete(options: AICompletionOptions): Promise<AIResponse> {
    await this.initialize();

    const {
      messages,
      temperature = this.stageConfig.temperature ?? 0,
      maxTokens = this.maxTokens,
      model = this.stageConfig.model,
      systemPrompt,
    } = options;

    try {
      const systemMessages = messages.filter((m) => m.role === 'system');
      const nonSystemMessages = messages.filter((m) => m.role !== 'system');

      const cacheTTL = ConfigService.getInstance().get('cacheTTL');
      const use1HourCache = cacheTTL && cacheTTL >= 3600000;

      const systemContent = systemPrompt
        ? [
            {
              type: 'text' as const,
              text: systemPrompt,
              cache_control: use1HourCache
                ? { type: 'ephemeral' as const, ttl: '1h' as const }
                : { type: 'ephemeral' as const },
            },
          ]
        : systemMessages.length > 0
          ? systemMessages.map((m) => ({
              type: 'text' as const,
              text: m.content,

              ...('cache_control' in m && m.cache_control && { cache_control: m.cache_control }),
            }))
          : undefined;

      const response = (await this.client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system: systemContent,
        messages: nonSystemMessages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
      } as Anthropic.Messages.MessageCreateParams)) as Anthropic.Messages.Message;

      const firstBlock = response.content[0];
      const content = firstBlock && 'text' in firstBlock ? firstBlock.text : '';
      const inputTokens = response.usage?.input_tokens || estimateTokens(JSON.stringify(messages));
      const outputTokens = response.usage?.output_tokens || estimateTokens(content);

      type AnthropicUsage = Anthropic.Messages.Message['usage'] & {
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };

      const cacheCreationTokens = (response.usage as AnthropicUsage)?.cache_creation_input_tokens || 0;

      const cacheReadTokens = (response.usage as AnthropicUsage)?.cache_read_input_tokens || 0;

      if (cacheReadTokens > 0) {
        logger.debug(`[CACHE HIT] ${cacheReadTokens.toLocaleString()} tokens from cache (90% discount)`);
      }
      if (cacheCreationTokens > 0) {
        const cacheTTL = use1HourCache ? '1-hour' : '5-minute';
        const multiplier = use1HourCache ? '2x' : '1.25x';
        logger.debug(
          `[CACHE WRITE] ${cacheCreationTokens.toLocaleString()} tokens written to ${cacheTTL} cache (${multiplier} cost)`,
        );
      }

      this.updateTokenStats(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens, use1HourCache);

      return {
        content,
        usage: response.usage
          ? {
              promptTokens: response.usage.input_tokens,
              completionTokens: response.usage.output_tokens,
              totalTokens: response.usage.input_tokens + response.usage.output_tokens,
            }
          : undefined,
        model: response.model,
      };
    } catch (error) {
      throw new Error(`Anthropic completion failed: ${error instanceof Error ? error.message : String(error)}`);
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
      throw new Error(`Failed to parse structured response: ${error instanceof Error ? error.message : String(error)}`);
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
    this.cacheCreationTokens = 0;
    this.cacheReadTokens = 0;
    this.cacheHits = 0;
    this.cache1HourCreationTokens = 0;
  }
}
