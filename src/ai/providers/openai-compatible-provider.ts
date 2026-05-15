import type OpenAI from 'openai';
import { zodResponseFormat } from 'openai/helpers/zod';
import type {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions/completions';
import type { z } from 'zod';

import {
  parseAndValidate,
  resolveSchemaName,
  schemaToJsonSchema,
  StructuredOutputError,
} from '@/ai/shared/structured';
import { estimateTokens } from '@/ai/shared/token-utils';
import type { ResolvedStageConfig } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

import { BaseAIProvider, type PricingMultipliers } from './base';
import type { AICompletionOptions, AICompletionOptionsWithSchema, AIResponse } from './provider';

interface OpenAICompatibleProviderConfig {
  name: 'github' | 'openai' | (string & {});
  friendlyName: 'GitHub Models' | 'OpenAI' | (string & {});
  apiKey?: string;
  baseURL?: string;
}

export abstract class OpenAICompatibleProvider extends BaseAIProvider {
  readonly name: OpenAICompatibleProviderConfig['name'];
  protected readonly apiKey: string;
  private readonly friendlyName: OpenAICompatibleProviderConfig['friendlyName'];
  private readonly baseURL: string | undefined;
  private client: OpenAI | null = null;
  private initialized = false;

  constructor(stageConfig: ResolvedStageConfig, providerConfig: OpenAICompatibleProviderConfig) {
    super(stageConfig, 8000);
    this.name = providerConfig.name;
    this.friendlyName = providerConfig.friendlyName;
    this.apiKey = providerConfig.apiKey ?? '';
    this.baseURL = providerConfig.baseURL;

    this.validateApiKey();
    this.validateConfiguration();
  }

  protected abstract validateApiKey(): void;

  private validateConfiguration(): void {
    const required = ['provider', 'model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in this.stageConfig));
    if (missing.length > 0) {
      throw new Error(`Missing required ${this.friendlyName} config: ${missing.join(', ')}`);
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return;
    try {
      const { default: OpenAI } = await import('openai');
      this.client = new OpenAI({
        apiKey: this.apiKey,
        baseURL: this.baseURL,
        maxRetries: 0,
        timeout: 60_000,
      });
      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize ${this.friendlyName} provider: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  isAvailable(): boolean {
    return Boolean(this.apiKey);
  }

  protected pricingMultipliers(): PricingMultipliers {
    return { cacheWriteMultiplier: 1.0, cacheReadMultiplier: 0.5 };
  }

  protected async completeText(options: AICompletionOptions): Promise<AIResponse<string>> {
    const client = await this.requireClient();
    const params = this.buildBaseParams(options);

    try {
      const response = await client.chat.completions.create(params);
      const content = response.choices[0]?.message?.content ?? '';
      this.recordResponseUsage(response, params, content);
      return {
        content,
        raw: content,
        usage: this.toTokenUsage(response.usage),
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
    const baseParams = this.buildBaseParams(options);
    const schemaName = resolveSchemaName(options.schema, options.schemaName);

    if (this.capabilities.structuredDialect === 'openai-json-schema-strict') {
      try {
        const completion = await client.chat.completions.parse({
          ...baseParams,
          response_format: zodResponseFormat(options.schema, schemaName),
        });
        const message = completion.choices[0]?.message;
        const raw = message?.content ?? '';
        if (!message?.parsed) {
          throw new StructuredOutputError('OpenAI strict parser returned no parsed payload', raw);
        }
        this.recordResponseUsage(completion, baseParams, raw);
        return {
          content: message.parsed as z.infer<S>,
          raw,
          usage: this.toTokenUsage(completion.usage),
          model: completion.model,
        };
      } catch (error) {
        if (error instanceof StructuredOutputError) throw error;
        throw this.wrapError(error);
      }
    }

    // json_object dialect: ask for JSON, validate with zod ourselves.
    const jsonSchema = schemaToJsonSchema(options.schema);
    const schemaInstruction =
      `Respond with a single JSON value that conforms to this JSON Schema. Do not wrap in markdown.\n\n` +
      `Schema (${schemaName}):\n${JSON.stringify(jsonSchema, null, 2)}`;

    const messages: ChatCompletionMessageParam[] = [
      { role: 'system', content: schemaInstruction },
      ...((baseParams.messages as ChatCompletionMessageParam[]) ?? []),
    ];

    try {
      const response = await client.chat.completions.create({
        ...baseParams,
        messages,
        response_format: { type: 'json_object' },
      });
      const raw = response.choices[0]?.message?.content ?? '';
      const parsed = parseAndValidate(raw, options.schema);
      this.recordResponseUsage(response, baseParams, raw);
      return {
        content: parsed,
        raw,
        usage: this.toTokenUsage(response.usage),
        model: response.model,
      };
    } catch (error) {
      if (error instanceof StructuredOutputError) throw error;
      throw this.wrapError(error);
    }
  }

  private buildBaseParams(options: AICompletionOptions): ChatCompletionCreateParamsNonStreaming {
    const {
      messages,
      temperature = this.stageConfig.temperature ?? 0,
      maxTokens = this.maxTokens,
      model = this.stageConfig.model,
      systemPrompt,
    } = options;

    logger.debug(`[${this.name}] model=${model} messages=${messages.length}`);

    const openaiMessages: ChatCompletionMessageParam[] = messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));
    if (systemPrompt) {
      openaiMessages.unshift({ role: 'system', content: systemPrompt });
    }

    const params: ChatCompletionCreateParamsNonStreaming = { model, messages: openaiMessages };
    if (this.capabilities.maxTokensField === 'max_completion_tokens') {
      params.max_completion_tokens = maxTokens;
    } else {
      params.max_tokens = maxTokens;
    }
    if (this.capabilities.supportsTemperature) {
      params.temperature = temperature;
    }
    return params;
  }

  private recordResponseUsage(
    response: { usage?: OpenAI.CompletionUsage | null },
    params: ChatCompletionCreateParamsNonStreaming,
    content: string,
  ): void {
    const inputTokens =
      response.usage?.prompt_tokens ?? estimateTokens(JSON.stringify(params.messages));
    const outputTokens = response.usage?.completion_tokens ?? estimateTokens(content);
    const cachedTokens = response.usage?.prompt_tokens_details?.cached_tokens ?? 0;

    if (cachedTokens > 0) {
      logger.debug(
        `[CACHE HIT] ${cachedTokens.toLocaleString()} tokens cached (${(
          (cachedTokens / Math.max(1, inputTokens)) *
          100
        ).toFixed(1)}% of input)`,
      );
    }

    this.recordUsage(inputTokens, outputTokens, { cachedReadTokens: cachedTokens });
  }

  private toTokenUsage(usage?: OpenAI.CompletionUsage | null) {
    if (!usage) return undefined;
    return {
      promptTokens: usage.prompt_tokens,
      completionTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
      cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? 0,
    };
  }

  private async requireClient(): Promise<OpenAI> {
    if (!this.initialized) await this.initialize();
    if (!this.client) throw new Error(`${this.friendlyName} client not initialized`);
    return this.client;
  }

  private wrapError(error: unknown): Error {
    if (error instanceof Error) {
      error.message = `${this.friendlyName} completion failed: ${error.message}`;
      return error;
    }
    return new Error(`${this.friendlyName} completion failed: ${String(error)}`);
  }
}
