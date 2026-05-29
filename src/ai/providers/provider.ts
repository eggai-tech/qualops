import type { z } from 'zod';

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  cacheControl?: { ttl?: '5m' | '1h' };
}

export interface AICompletionOptions {
  messages: AIMessage[];
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  model?: string;
}

export type AICompletionOptionsWithSchema<S extends z.ZodType> = AICompletionOptions & {
  schema: S;
  schemaName?: string;
};

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface AIResponse<T = string> {
  content: T;
  raw: string;
  usage?: TokenUsage;
  model?: string;
}

export interface AIProvider {
  name: string;

  initialize(): Promise<void>;

  complete<S extends z.ZodType>(
    options: AICompletionOptionsWithSchema<S>,
  ): Promise<AIResponse<z.infer<S>>>;
  complete(options: AICompletionOptions): Promise<AIResponse<string>>;

  invoke(
    prompt: string,
    maxTokens?: number,
    options?: { stage?: string; enableCaching?: boolean },
  ): Promise<string>;

  isAvailable(): boolean;
  isUnstructured(): boolean;
  getModelName(): string;
  getMaxTokens(): number;
  getTemperature(): number;
  getTokenStats(): TokenStats;
  resetTokenStats?(): void;
}

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  invocationCount: number;
  startTime: Date;
  estimatedCost: number;
}
