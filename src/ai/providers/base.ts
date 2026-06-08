import type { z } from 'zod';

import { envConfig } from '@/config/env';
import type { ResolvedStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import type { ProviderCapabilities } from './capabilities';
import { detectCapabilities } from './capabilities';
import type {
  AICompletionOptions,
  AICompletionOptionsWithSchema,
  AIProvider,
  AIResponse,
  TokenStats,
} from './provider';

export interface CacheUsage {
  cachedReadTokens?: number;
  cacheCreationTokens?: number;
  use1HourCache?: boolean;
}

export interface PricingMultipliers {
  /** Multiplier on inputPerMillion for cache writes (Anthropic 5m: 1.25; Anthropic 1h: 2.0; OpenAI: 1.0). */
  cacheWriteMultiplier: number;
  /** Multiplier on inputPerMillion for cache reads (Anthropic: 0.1; OpenAI: 0.5). */
  cacheReadMultiplier: number;
}

export abstract class BaseAIProvider implements AIProvider {
  abstract readonly name: string;

  protected readonly stageConfig: ResolvedStageConfig;
  protected readonly maxTokens: number;
  private _capabilities: ProviderCapabilities | undefined;

  private readonly tokenStats: TokenStats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    invocationCount: 0,
    startTime: new Date(),
    estimatedCost: 0,
  };
  private cacheReadTokens = 0;
  private cacheCreationTokens = 0;
  private cacheHits = 0;

  constructor(stageConfig: ResolvedStageConfig, defaultMaxTokens: number) {
    this.stageConfig = stageConfig;
    this.maxTokens = stageConfig.maxTokens ?? defaultMaxTokens;
  }

  protected get capabilities(): ProviderCapabilities {
    if (!this._capabilities) {
      this._capabilities = detectCapabilities(this.stageConfig.provider, this.stageConfig.model);
    }
    return this._capabilities;
  }

  abstract initialize(): Promise<void>;
  abstract isAvailable(): boolean;

  isUnstructured(): boolean {
    return this.capabilities.structuredDialect === 'unstructured';
  }

  complete<S extends z.ZodType>(
    options: AICompletionOptionsWithSchema<S>,
  ): Promise<AIResponse<z.infer<S>>>;
  complete(options: AICompletionOptions): Promise<AIResponse<string>>;
  async complete(
    options: AICompletionOptions | AICompletionOptionsWithSchema<z.ZodType>,
  ): Promise<AIResponse<unknown>> {
    if ('schema' in options && options.schema) {
      return this.completeStructured(options as AICompletionOptionsWithSchema<z.ZodType>);
    }
    return this.completeText(options);
  }

  async invoke(
    prompt: string,
    maxTokens?: number,
    _options?: { stage?: string; enableCaching?: boolean },
  ): Promise<string> {
    const response = await this.completeText({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: maxTokens ?? this.maxTokens,
      model: this.stageConfig.model,
    });
    return response.content;
  }

  protected abstract completeText(options: AICompletionOptions): Promise<AIResponse<string>>;
  protected abstract completeStructured<S extends z.ZodType>(
    options: AICompletionOptionsWithSchema<S>,
  ): Promise<AIResponse<z.infer<S>>>;

  protected abstract pricingMultipliers(use1HourCache?: boolean): PricingMultipliers;

  /**
   * Record usage for one provider call.
   *
   * Provider semantics for `reportedInput` differ:
   *   - OpenAI:           prompt_tokens (INCLUDES cached reads)
   *   - Anthropic/Bedrock: input_tokens (EXCLUDES cached reads — cache_read_input_tokens is a separate field)
   *
   * `fullPriceInput` is the count to bill at the regular input rate (i.e. excluding cached reads).
   * If omitted, defaults to `reportedInput - cachedReadTokens` (correct for OpenAI). Anthropic and
   * Bedrock should pass `fullPriceInput: reportedInput` explicitly because their reportedInput
   * already excludes cached reads.
   *
   * The `reportedInput` is what gets credited to `tokenStats.totalInputTokens` (preserving the
   * historical per-provider semantics so downstream reporting is unchanged).
   */
  protected recordUsage(
    reportedInput: number,
    output: number,
    cache: CacheUsage & { fullPriceInput?: number } = {},
  ): void {
    const {
      cachedReadTokens = 0,
      cacheCreationTokens = 0,
      use1HourCache = false,
      fullPriceInput = Math.max(0, reportedInput - cachedReadTokens),
    } = cache;

    this.tokenStats.totalInputTokens += reportedInput;
    this.tokenStats.totalOutputTokens += output;
    this.tokenStats.totalTokens += reportedInput + output;
    this.tokenStats.invocationCount += 1;

    if (cacheCreationTokens > 0) this.cacheCreationTokens += cacheCreationTokens;
    if (cachedReadTokens > 0) {
      this.cacheReadTokens += cachedReadTokens;
      this.cacheHits += 1;
    }

    const { inputPerMillion, outputPerMillion } = this.stageConfig;
    const { cacheWriteMultiplier, cacheReadMultiplier } = this.pricingMultipliers(use1HourCache);

    const inputCost = (fullPriceInput / 1_000_000) * inputPerMillion;
    const cacheReadCost = (cachedReadTokens / 1_000_000) * (inputPerMillion * cacheReadMultiplier);
    const cacheWriteCost =
      (cacheCreationTokens / 1_000_000) * (inputPerMillion * cacheWriteMultiplier);
    const outputCost = (output / 1_000_000) * outputPerMillion;
    this.tokenStats.estimatedCost += inputCost + cacheReadCost + cacheWriteCost + outputCost;

    this.logUsageIfDue();
  }

  /**
   * Hook for subclasses to override the log emission policy. Called after every recorded usage.
   * Default: gated by NODE_ENV (development/test only), every 10 invocations or once cost >= $1.
   */
  protected logUsageIfDue(): void {
    const stats = this.tokenStats;
    const isVerbose = envConfig.isDevelopment() || envConfig.get('nodeEnv') === 'test';
    const tick = stats.invocationCount % 10 === 0 || stats.estimatedCost >= 1.0;
    if (!isVerbose || !tick) return;
    this.emitDefaultUsageLog();
  }

  protected emitDefaultUsageLog(): void {
    const stats = this.tokenStats;
    const runtimeMin = (Date.now() - stats.startTime.getTime()) / 60_000;
    logger.info(`[TOKEN USAGE] ${this.name} (${this.stageConfig.model})`);
    logger.info(`   Invocations: ${stats.invocationCount}`);
    logger.info(
      `   Input/Output: ${stats.totalInputTokens.toLocaleString()} / ${stats.totalOutputTokens.toLocaleString()}`,
    );
    if (this.cacheReadTokens > 0 || this.cacheCreationTokens > 0) {
      const hitRate = ((this.cacheHits / stats.invocationCount) * 100).toFixed(1);
      logger.info(
        `   Cache reads/writes: ${this.cacheReadTokens.toLocaleString()} / ${this.cacheCreationTokens.toLocaleString()} (hit-rate ${hitRate}%)`,
      );
    }
    logger.info(`   Estimated cost: $${stats.estimatedCost.toFixed(4)}`);
    logger.info(`   Runtime: ${runtimeMin.toFixed(1)} min`);
  }

  protected get currentTokenStats(): TokenStats {
    return this.tokenStats;
  }

  protected get currentCacheCounters(): { reads: number; writes: number; hits: number } {
    return {
      reads: this.cacheReadTokens,
      writes: this.cacheCreationTokens,
      hits: this.cacheHits,
    };
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
    this.cacheReadTokens = 0;
    this.cacheCreationTokens = 0;
    this.cacheHits = 0;
  }
}
