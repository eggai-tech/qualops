import type Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { z } from 'zod';

import {
  resolveSchemaName,
  schemaToJsonSchema,
  StructuredOutputError,
} from '@/ai/shared/structured';
import { estimateTokens } from '@/ai/shared/token-utils';
import { ConfigService } from '@/config/config';
import { envConfig } from '@/config/env';
import type { ResolvedStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import { BaseAIProvider, type PricingMultipliers } from './base';
import { AIProviderType } from './factory';
import type {
  AICompletionOptions,
  AICompletionOptionsWithSchema,
  AIMessage,
  AIResponse,
} from './provider';

type AnthropicSystemBlock = {
  type: 'text';
  text: string;
  cache_control?: { type: 'ephemeral'; ttl?: '1h' };
};

type AnthropicMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export class AnthropicProvider extends BaseAIProvider {
  readonly name = AIProviderType.ANTHROPIC;
  private client: Anthropic | null = null;
  private initialized = false;
  private readonly apiKey: string;

  constructor(stageConfig: ResolvedStageConfig) {
    super(stageConfig, 8000);
    this.apiKey = envConfig.get('anthropicApiKey') || '';
    this.validateConfiguration();
  }

  private validateConfiguration(): void {
    if (!this.apiKey) {
      throw new Error('ANTHROPIC_API_KEY environment variable is required for anthropic provider');
    }
    if (!this.apiKey.startsWith('sk-ant-')) {
      throw new Error('Invalid Anthropic API key format');
    }
    if (this.apiKey.length < 100) {
      throw new Error('Anthropic API key appears to be truncated');
    }
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
    this.client = new Anthropic({ apiKey: this.apiKey, maxRetries: 3, timeout: 200_000 });
    this.initialized = true;
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  protected pricingMultipliers(use1HourCache?: boolean): PricingMultipliers {
    return {
      cacheWriteMultiplier: use1HourCache ? 2.0 : 1.25,
      cacheReadMultiplier: 0.1,
    };
  }

  protected async completeText(options: AICompletionOptions): Promise<AIResponse<string>> {
    const client = await this.requireClient();
    const { messages, temperature, maxTokens, model, systemPrompt } = this.normalize(options);
    const { use1HourCache, system } = this.buildSystemBlocks(messages, systemPrompt);

    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: this.toAnthropicMessages(messages),
      });
      const raw = this.extractText(response);
      this.recordResponseUsage(response, messages, raw, use1HourCache);
      return {
        content: raw,
        raw,
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
      throw this.wrapError(error);
    }
  }

  protected async completeStructured<S extends z.ZodType>(
    options: AICompletionOptionsWithSchema<S>,
  ): Promise<AIResponse<z.infer<S>>> {
    const client = await this.requireClient();
    const { messages, temperature, maxTokens, model, systemPrompt } = this.normalize(options);
    const { use1HourCache, system } = this.buildSystemBlocks(messages, systemPrompt);
    const schemaName = resolveSchemaName(options.schema, options.schemaName);

    if (this.capabilities.structuredDialect === 'anthropic-output-config') {
      try {
        const response = await client.messages.parse({
          model,
          max_tokens: maxTokens,
          temperature,
          system,
          messages: this.toAnthropicMessages(messages),
          output_config: { format: zodOutputFormat(options.schema) },
        });
        const raw = this.extractText(response);
        if (response.parsed_output == null) {
          throw new StructuredOutputError('Anthropic returned no parsed_output', raw);
        }
        this.recordResponseUsage(response, messages, raw, use1HourCache);
        return {
          content: response.parsed_output as z.infer<S>,
          raw,
          usage: this.toTokenUsage(response.usage),
          model: response.model,
        };
      } catch (error) {
        if (error instanceof StructuredOutputError) throw error;
        throw this.wrapError(error);
      }
    }

    // tool_use fallback for Claude < 4.5
    const toolSchema = schemaToJsonSchema(options.schema) as Record<string, unknown>;
    try {
      const response = await client.messages.create({
        model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: this.toAnthropicMessages(messages),
        tools: [
          {
            name: schemaName,
            description: 'Return the result in this exact shape.',
            input_schema: toolSchema as Anthropic.Messages.Tool['input_schema'],
          },
        ],
        tool_choice: { type: 'tool', name: schemaName },
      });

      const toolUseBlock = response.content.find(
        (b): b is Anthropic.Messages.ToolUseBlock => b.type === 'tool_use',
      );
      const raw = JSON.stringify(toolUseBlock?.input ?? null);
      if (!toolUseBlock) {
        throw new StructuredOutputError('Anthropic returned no tool_use block', raw);
      }
      const parsed = options.schema.safeParse(toolUseBlock.input);
      if (!parsed.success) {
        throw new StructuredOutputError(
          `Schema validation failed: ${parsed.error.message}`,
          raw,
          parsed.error,
        );
      }
      this.recordResponseUsage(response, messages, raw, use1HourCache);
      return {
        content: parsed.data,
        raw,
        usage: this.toTokenUsage(response.usage),
        model: response.model,
      };
    } catch (error) {
      if (error instanceof StructuredOutputError) throw error;
      throw this.wrapError(error);
    }
  }

  private normalize(options: AICompletionOptions): {
    messages: AIMessage[];
    temperature: number;
    maxTokens: number;
    model: string;
    systemPrompt?: string;
  } {
    return {
      messages: options.messages,
      temperature: options.temperature ?? this.stageConfig.temperature ?? 0,
      maxTokens: options.maxTokens ?? this.maxTokens,
      model: options.model ?? this.stageConfig.model,
      systemPrompt: options.systemPrompt,
    };
  }

  private buildSystemBlocks(
    messages: AIMessage[],
    systemPrompt?: string,
  ): { use1HourCache: boolean; system: AnthropicSystemBlock[] | undefined } {
    const cacheTTL = ConfigService.getInstance().get('cacheTTL');
    const use1HourCache = Boolean(cacheTTL && cacheTTL >= 3_600_000);

    if (systemPrompt) {
      return {
        use1HourCache,
        system: [
          {
            type: 'text',
            text: systemPrompt,
            cache_control: use1HourCache ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' },
          },
        ],
      };
    }

    const systemMessages = messages.filter((m) => m.role === 'system');
    if (systemMessages.length === 0) return { use1HourCache, system: undefined };

    return {
      use1HourCache,
      system: systemMessages.map((m) => {
        const block: AnthropicSystemBlock = { type: 'text', text: m.content };
        if (m.cacheControl) {
          block.cache_control =
            m.cacheControl.ttl === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' };
        }
        return block;
      }),
    };
  }

  private toAnthropicMessages(messages: AIMessage[]): AnthropicMessage[] {
    return messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'user' ? 'user' : 'assistant',
        content: m.content,
      }));
  }

  private extractText(response: { content: Anthropic.Messages.ContentBlock[] }): string {
    return response.content
      .map((block) => ('text' in block && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n');
  }

  private recordResponseUsage(
    response: { usage?: Anthropic.Messages.Message['usage'] },
    messages: AIMessage[],
    raw: string,
    use1HourCache: boolean,
  ): void {
    type AnthropicUsage = Anthropic.Messages.Message['usage'] & {
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const usage = response.usage as AnthropicUsage | undefined;
    const inputTokens = usage?.input_tokens ?? estimateTokens(JSON.stringify(messages));
    const outputTokens = usage?.output_tokens ?? estimateTokens(raw);
    const cachedReadTokens = usage?.cache_read_input_tokens ?? 0;
    const cacheCreationTokens = usage?.cache_creation_input_tokens ?? 0;

    if (cachedReadTokens > 0) {
      logger.debug(
        `[CACHE HIT] ${cachedReadTokens.toLocaleString()} tokens from cache (90% discount)`,
      );
    }
    if (cacheCreationTokens > 0) {
      logger.debug(
        `[CACHE WRITE] ${cacheCreationTokens.toLocaleString()} tokens to ${
          use1HourCache ? '1-hour' : '5-minute'
        } cache`,
      );
    }

    this.recordUsage(inputTokens, outputTokens, {
      fullPriceInput: inputTokens,
      cachedReadTokens,
      cacheCreationTokens,
      use1HourCache,
    });
  }

  private toTokenUsage(usage?: Anthropic.Messages.Message['usage']) {
    if (!usage) return undefined;
    return {
      promptTokens: usage.input_tokens,
      completionTokens: usage.output_tokens,
      totalTokens: usage.input_tokens + usage.output_tokens,
    };
  }

  private async requireClient(): Promise<Anthropic> {
    if (!this.initialized) await this.initialize();
    if (!this.client) throw new Error('Anthropic client not initialized');
    return this.client;
  }

  private wrapError(error: unknown): Error {
    return new Error(
      `Anthropic completion failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
