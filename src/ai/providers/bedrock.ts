import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { z } from 'zod';

import {
  parseAndValidate,
  resolveSchemaName,
  schemaToJsonSchema,
  StructuredOutputError,
} from '@/ai/shared/structured';
import { estimateTokens } from '@/ai/shared/token-utils';
import { envConfig } from '@/config/env';
import type { ResolvedStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import { BaseAIProvider, type PricingMultipliers } from './base';
import { AIProviderType } from './factory';
import { TOKENS_PER_MILLION } from './pricing-constants';
import type {
  AICompletionOptions,
  AICompletionOptionsWithSchema,
  AIMessage,
  AIResponse,
} from './provider';

const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

interface BedrockContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface BedrockTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

interface BedrockPayload {
  anthropic_version: string;
  messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  max_tokens: number;
  temperature: number;
  system?: Array<{ type: string; text: string }>;
  tools?: BedrockTool[];
  tool_choice?: { type: 'tool'; name: string };
}

interface BedrockResponse {
  content?: BedrockContentBlock[];
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface BedrockSdkResponse {
  body?: string | Uint8Array | { text: () => string };
}

export class BedrockProvider extends BaseAIProvider {
  readonly name = AIProviderType.BEDROCK;

  private client: BedrockRuntimeClient | null = null;
  private initialized = false;
  private readonly region: string;

  constructor(stageConfig: ResolvedStageConfig) {
    super(stageConfig, 4000);
    this.region = envConfig.get('awsRegion') || process.env.AWS_REGION || 'eu-west-1';
    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    const required = ['provider', 'model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in this.stageConfig));
    if (missing.length > 0) {
      throw new Error(`Missing required Bedrock config: ${missing.join(', ')}`);
    }
    if (!envConfig.get('awsRegion')) {
      throw new Error('AWS_REGION environment variable is required for bedrock provider');
    }
    if (!envConfig.get('awsAccessKeyId')) {
      throw new Error('AWS_ACCESS_KEY_ID environment variable is required for bedrock provider');
    }
    if (!envConfig.get('awsSecretAccessKey')) {
      throw new Error(
        'AWS_SECRET_ACCESS_KEY environment variable is required for bedrock provider',
      );
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const { BedrockRuntimeClient } = await import('@aws-sdk/client-bedrock-runtime');
      this.client = new BedrockRuntimeClient({ region: this.region });
      this.initialized = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        "Failed to initialize AWS Bedrock client. Install '@aws-sdk/client-bedrock-runtime' and ensure AWS credentials/region are configured. Original error: " +
          message,
      );
    }
  }

  isAvailable(): boolean {
    return this.initialized;
  }

  protected pricingMultipliers(): PricingMultipliers {
    return { cacheWriteMultiplier: 1.0, cacheReadMultiplier: 0.1 };
  }

  /**
   * Bedrock's historical log policy: log every 5 invocations during the first 20 calls (then
   * every 10), or whenever cost crosses $0.50. Always on (no env gate). Uses a single-line
   * structured format for grep-ability in CloudWatch.
   */
  protected logUsageIfDue(): void {
    const stats = this.currentTokenStats;
    const frequency = stats.invocationCount <= 20 ? 5 : 10;
    const tick = stats.invocationCount % frequency === 0 || stats.estimatedCost >= 0.5;
    if (!tick) return;

    const counters = this.currentCacheCounters;
    let msg =
      `[TOKENS][Bedrock] Invocations=${stats.invocationCount}, ` +
      `Input=${stats.totalInputTokens.toLocaleString()}, ` +
      `Output=${stats.totalOutputTokens.toLocaleString()}`;

    if (counters.reads > 0 || counters.writes > 0) {
      const hitRate = ((counters.hits / stats.invocationCount) * 100).toFixed(1);
      const cacheReadSavings =
        (counters.reads / TOKENS_PER_MILLION) * (this.stageConfig.inputPerMillion * 0.9);
      msg += `, CacheWrite=${counters.writes.toLocaleString()}`;
      msg += `, CacheRead=${counters.reads.toLocaleString()} (${hitRate}% hit rate)`;
      msg += `, CacheSavings=$${cacheReadSavings.toFixed(4)}`;
    }

    msg += `, EstimatedCost=$${stats.estimatedCost.toFixed(4)}`;
    logger.info(msg);
  }

  protected async completeText(options: AICompletionOptions): Promise<AIResponse<string>> {
    await this.initialize();
    const { messages, temperature, maxTokens, systemPrompt } = this.normalize(options);
    const { bedrockMessages, system } = this.buildBedrockMessages(messages, systemPrompt);

    const payload: BedrockPayload = {
      anthropic_version: ANTHROPIC_VERSION,
      messages: bedrockMessages,
      max_tokens: maxTokens,
      temperature,
    };
    if (system) payload.system = system;

    const response = await this.invokeModel(payload);
    const text = this.extractText(response.content ?? []);
    this.recordResponseUsage(response, messages, text);

    return {
      content: text,
      raw: text,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
      model: this.stageConfig.model,
    };
  }

  protected async completeStructured<S extends z.ZodType>(
    options: AICompletionOptionsWithSchema<S>,
  ): Promise<AIResponse<z.infer<S>>> {
    await this.initialize();
    const { messages, temperature, maxTokens, systemPrompt } = this.normalize(options);
    const { bedrockMessages, system } = this.buildBedrockMessages(messages, systemPrompt);
    const schemaName = resolveSchemaName(options.schema, options.schemaName);

    const payload: BedrockPayload = {
      anthropic_version: ANTHROPIC_VERSION,
      messages: bedrockMessages,
      max_tokens: maxTokens,
      temperature,
      tools: [
        {
          name: schemaName,
          description: 'Return the result in this exact shape.',
          input_schema: schemaToJsonSchema(options.schema),
        },
      ],
      tool_choice: { type: 'tool', name: schemaName },
    };
    if (system) payload.system = system;

    const response = await this.invokeModel(payload);
    const toolUseBlock = (response.content ?? []).find((b) => b.type === 'tool_use');
    const raw = JSON.stringify(toolUseBlock?.input ?? null);

    if (!toolUseBlock) {
      throw new StructuredOutputError('Bedrock returned no tool_use block', raw);
    }

    const validated = options.schema.safeParse(toolUseBlock.input);
    if (!validated.success) {
      // Last-resort fallback: some adapters return the JSON in a text block. Try parse+validate.
      try {
        const fallbackText = this.extractText(response.content ?? []);
        const data = parseAndValidate(fallbackText, options.schema);
        this.recordResponseUsage(response, messages, fallbackText);
        return {
          content: data,
          raw: fallbackText,
          usage: this.toTokenUsage(response.usage),
          model: this.stageConfig.model,
        };
      } catch {
        throw new StructuredOutputError(
          `Schema validation failed: ${validated.error.message}`,
          raw,
          validated.error,
        );
      }
    }

    this.recordResponseUsage(response, messages, raw);
    return {
      content: validated.data,
      raw,
      usage: this.toTokenUsage(response.usage),
      model: this.stageConfig.model,
    };
  }

  private normalize(options: AICompletionOptions): {
    messages: AIMessage[];
    temperature: number;
    maxTokens: number;
    systemPrompt?: string;
  } {
    return {
      messages: options.messages ?? [],
      temperature: options.temperature ?? this.stageConfig.temperature ?? 0,
      maxTokens: options.maxTokens ?? this.maxTokens,
      systemPrompt: options.systemPrompt,
    };
  }

  private async invokeModel(payload: BedrockPayload): Promise<BedrockResponse> {
    const { InvokeModelCommand } = await import('@aws-sdk/client-bedrock-runtime');
    const command = new InvokeModelCommand({
      modelId: this.stageConfig.model,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });
    if (!this.client) throw new Error('Bedrock client not initialized');
    const response = await this.client.send(command);
    return this.parseResponse(response as BedrockSdkResponse);
  }

  private parseResponse(response: BedrockSdkResponse): BedrockResponse {
    if (!response?.body) throw new Error('AWS Bedrock response missing body payload');

    let raw: string;
    if (typeof response.body === 'string') raw = response.body;
    else if (response.body instanceof Uint8Array) raw = new TextDecoder().decode(response.body);
    else if (typeof response.body.text === 'function') raw = response.body.text();
    else raw = String(response.body);

    try {
      return JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse AWS Bedrock response: ${message}`);
    }
  }

  private buildBedrockMessages(
    messages: AIMessage[],
    systemPrompt?: string,
  ): {
    bedrockMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    system?: Array<{ type: string; text: string }>;
  } {
    const bedrockMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }> =
      [];
    const systemPrompts: string[] = [];

    for (const message of messages) {
      if (message.role === 'system') {
        systemPrompts.push(message.content);
        continue;
      }
      bedrockMessages.push({
        role: message.role === 'assistant' ? 'assistant' : 'user',
        content: [{ type: 'text', text: message.content }],
      });
    }

    if (systemPrompt) systemPrompts.push(systemPrompt);

    const system = systemPrompts.length
      ? systemPrompts.map((text) => ({ type: 'text', text }))
      : undefined;

    if (bedrockMessages.length === 0) {
      bedrockMessages.push({ role: 'user', content: [{ type: 'text', text: '' }] });
    }

    return { bedrockMessages, system };
  }

  private extractText(content: BedrockContentBlock[]): string {
    if (!Array.isArray(content)) return '';
    return content
      .filter((b) => b.type === 'output_text' || b.type === 'text')
      .map((b) => b.text ?? '')
      .filter(Boolean)
      .join('\n');
  }

  private recordResponseUsage(response: BedrockResponse, messages: AIMessage[], raw: string): void {
    const inputTokens = response.usage?.input_tokens ?? estimateTokens(JSON.stringify(messages));
    const outputTokens = response.usage?.output_tokens ?? estimateTokens(raw);
    const cachedReadTokens = response.usage?.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens ?? 0;

    if (cachedReadTokens > 0) {
      logger.debug(
        `[CACHE HIT] ${cachedReadTokens.toLocaleString()} tokens from cache (90% discount)`,
      );
    }
    if (cacheCreationTokens > 0) {
      logger.debug(`[CACHE WRITE] ${cacheCreationTokens.toLocaleString()} tokens written to cache`);
    }

    this.recordUsage(inputTokens, outputTokens, {
      fullPriceInput: inputTokens,
      cachedReadTokens,
      cacheCreationTokens,
    });
  }

  private toTokenUsage(usage?: BedrockResponse['usage']) {
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
    };
  }

  /**
   * Backwards-compatible accessor for legacy callers — returns the same `TokenStats` plus pricing.
   */
  getDetailedTokenStats() {
    return {
      ...this.getTokenStats(),
      inputCostPerMillion: this.stageConfig.inputPerMillion,
      outputCostPerMillion: this.stageConfig.outputPerMillion,
    };
  }
}
