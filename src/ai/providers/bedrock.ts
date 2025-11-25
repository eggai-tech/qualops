import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';

import { AIProviderType } from './factory';
import type { AICompletionOptions, AIProvider, AIResponse, TokenStats } from './provider';
import { envConfig } from '../../config/env';
import type { AIStageConfig } from '../../shared/types';
import { logger } from '../../shared/utils/logger';
import { estimateTokens } from '../shared/token-utils';

const ANTHROPIC_VERSION = 'bedrock-2023-05-31';

interface BedrockContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: unknown;
}

interface BedrockPayload {
  anthropic_version: string;
  messages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
  max_tokens: number;
  temperature: number;
  system?: Array<{ type: string; text: string }>;
  response_format?: { type: string };
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

export class BedrockProvider implements AIProvider {
  readonly name = AIProviderType.BEDROCK;

  private client: BedrockRuntimeClient | null = null;
  private initialized = false;
  private readonly stageConfig: AIStageConfig;
  private readonly region: string;
  private readonly maxTokens = 4000;

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

  constructor(stageConfig: AIStageConfig) {
    this.stageConfig = stageConfig;
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
      throw new Error('AWS_SECRET_ACCESS_KEY environment variable is required for bedrock provider');
    }
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const module = await import('@aws-sdk/client-bedrock-runtime');
      const { BedrockRuntimeClient } = module;

      this.client = new BedrockRuntimeClient({
        region: this.region,
      });
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

  getModelName(): string {
    return this.stageConfig.model;
  }

  getMaxTokens(): number {
    return this.maxTokens;
  }

  getTemperature(): number {
    return this.stageConfig.temperature ?? 0;
  }

  async complete(options: AICompletionOptions): Promise<AIResponse> {
    await this.initialize();

    const { messages = [], temperature, maxTokens, systemPrompt, responseFormat } = options;

    const { bedrockMessages, system } = this.buildBedrockMessages(messages, systemPrompt);

    const payload: BedrockPayload = {
      anthropic_version: ANTHROPIC_VERSION,
      messages: bedrockMessages,
      max_tokens: maxTokens ?? this.maxTokens,
      temperature: temperature ?? this.stageConfig.temperature ?? 0,
    };

    if (system) {
      payload.system = system;
    }

    if (responseFormat === 'json') {
      payload.response_format = { type: 'json' };
    }

    const response = await this.invokeModel(payload);
    const responseText = this.extractText(response.content ?? []);

    const inputTokens = response.usage?.input_tokens ?? estimateTokens(JSON.stringify(messages));
    const outputTokens = response.usage?.output_tokens ?? estimateTokens(responseText);
    const cacheCreationTokens = response.usage?.cache_creation_input_tokens || 0;
    const cacheReadTokens = response.usage?.cache_read_input_tokens || 0;

    if (cacheReadTokens > 0) {
      logger.debug(`[CACHE HIT] ${cacheReadTokens.toLocaleString()} tokens from cache (90% discount)`);
    }
    if (cacheCreationTokens > 0) {
      logger.debug(`[CACHE WRITE] ${cacheCreationTokens.toLocaleString()} tokens written to cache`);
    }

    this.updateTokenStats(inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens);

    return {
      content: responseText,
      usage: response.usage
        ? {
            promptTokens: response.usage.input_tokens,
            completionTokens: response.usage.output_tokens,
            totalTokens: response.usage.input_tokens + response.usage.output_tokens,
          }
        : undefined,
      model: this.getModelId(),
    };
  }

  async completeWithStructure<T>(options: AICompletionOptions & { schema: unknown }): Promise<T> {
    const response = await this.complete({ ...options, responseFormat: 'json' });

    try {
      return JSON.parse(response.content) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse structured response from AWS Bedrock: ${message}`);
    }
  }

  async invoke(
    prompt: string,
    maxTokens?: number,
    _options?: { stage?: string; enableCaching?: boolean },
  ): Promise<string> {
    const response = await this.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens,
    });

    return response.content;
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
  }

  private getModelId(): string {
    return this.stageConfig.model;
  }

  private async invokeModel(payload: BedrockPayload): Promise<BedrockResponse> {
    const module = await import('@aws-sdk/client-bedrock-runtime');
    const { InvokeModelCommand } = module;

    const modelId = this.getModelId();

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    if (!this.client) {
      throw new Error('Bedrock client not initialized');
    }

    const response = await this.client.send(command);
    return this.parseResponse(response as BedrockSdkResponse);
  }

  private parseResponse(response: BedrockSdkResponse): BedrockResponse {
    if (!response?.body) {
      throw new Error('AWS Bedrock response missing body payload');
    }

    let raw: string;

    if (typeof response.body === 'string') {
      raw = response.body;
    } else if (response.body instanceof Uint8Array) {
      raw = new TextDecoder().decode(response.body);
    } else if (typeof response.body.text === 'function') {
      // Some SDK versions expose a text() helper
      raw = response.body.text();
    } else {
      raw = String(response.body);
    }

    try {
      return JSON.parse(raw);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to parse AWS Bedrock response: ${message}`);
    }
  }

  private buildBedrockMessages(
    messages: AICompletionOptions['messages'],
    systemPrompt?: string,
  ): {
    bedrockMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }>;
    system?: Array<{ type: string; text: string }>;
  } {
    const bedrockMessages: Array<{ role: string; content: Array<{ type: string; text: string }> }> = [];
    const systemPrompts: string[] = [];

    for (const message of messages ?? []) {
      if (message.role === 'system') {
        systemPrompts.push(message.content);
        continue;
      }

      const role = message.role === 'assistant' ? 'assistant' : 'user';
      bedrockMessages.push({
        role,
        content: [{ type: 'text', text: message.content }],
      });
    }

    if (systemPrompt) {
      systemPrompts.push(systemPrompt);
    }

    const system = systemPrompts.length ? systemPrompts.map((text) => ({ type: 'text', text })) : undefined;

    if (bedrockMessages.length === 0) {
      bedrockMessages.push({
        role: 'user',
        content: [{ type: 'text', text: '' }],
      });
    }

    return { bedrockMessages, system };
  }

  private extractText(content: BedrockContentBlock[]): string {
    if (!Array.isArray(content)) {
      return '';
    }

    const textBlocks = content
      .filter((block) => block.type === 'output_text' || block.type === 'text')
      .map((block) => block.text ?? '')
      .filter(Boolean);

    return textBlocks.join('\n');
  }

  private updateTokenStats(
    inputTokens: number,
    outputTokens: number,
    cacheCreationTokens?: number,
    cacheReadTokens?: number,
  ): void {
    this.tokenStats.totalInputTokens += inputTokens;
    this.tokenStats.totalOutputTokens += outputTokens;
    this.tokenStats.totalTokens += inputTokens + outputTokens;
    this.tokenStats.invocationCount++;

    if (cacheCreationTokens && cacheCreationTokens > 0) {
      this.cacheCreationTokens += cacheCreationTokens;
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
    const cacheWriteCost = ((cacheCreationTokens || 0) / 1_000_000) * pricing.inputPerMillion;
    const cacheReadCost = ((cacheReadTokens || 0) / 1_000_000) * (pricing.inputPerMillion * 0.1);
    const outputCost = (outputTokens / 1_000_000) * pricing.outputPerMillion;
    this.tokenStats.estimatedCost += regularInputCost + cacheWriteCost + cacheReadCost + outputCost;

    const logFrequency = this.tokenStats.invocationCount <= 20 ? 5 : 10;

    if (this.tokenStats.invocationCount % logFrequency === 0 || this.tokenStats.estimatedCost >= 0.5) {
      let logMsg =
        `[TOKENS][Bedrock] Invocations=${this.tokenStats.invocationCount}, ` +
        `Input=${this.tokenStats.totalInputTokens.toLocaleString()}, ` +
        `Output=${this.tokenStats.totalOutputTokens.toLocaleString()}`;

      if (this.cacheReadTokens > 0 || this.cacheCreationTokens > 0) {
        const cacheHitRate = ((this.cacheHits / this.tokenStats.invocationCount) * 100).toFixed(1);
        const cacheReadSavings = (this.cacheReadTokens / 1_000_000) * (this.stageConfig.inputPerMillion * 0.9);
        logMsg += `, CacheWrite=${this.cacheCreationTokens.toLocaleString()}`;
        logMsg += `, CacheRead=${this.cacheReadTokens.toLocaleString()} (${cacheHitRate}% hit rate)`;
        logMsg += `, CacheSavings=$${cacheReadSavings.toFixed(4)}`;
      }

      logMsg += `, EstimatedCost=$${this.tokenStats.estimatedCost.toFixed(4)}`;
      logger.info(logMsg);
    }
  }

  getDetailedTokenStats(): TokenStats & { inputCostPerMillion: number; outputCostPerMillion: number } {
    const pricing = {
      inputPerMillion: this.stageConfig.inputPerMillion,
      outputPerMillion: this.stageConfig.outputPerMillion,
    };
    return {
      ...this.tokenStats,
      inputCostPerMillion: pricing.inputPerMillion,
      outputCostPerMillion: pricing.outputPerMillion,
    };
  }
}
