export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AICompletionOptions {
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  model?: string;
  systemPrompt?: string;
  responseFormat?: 'text' | 'json';
}

export interface AIResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cachedTokens?: number;
  };
  model?: string;
}

export interface AIProvider {
  name: string;

  initialize(): Promise<void>;

  complete(options: AICompletionOptions): Promise<AIResponse>;

  completeWithStructure<T>(options: AICompletionOptions & { schema: unknown }): Promise<T>;

  invoke(
    prompt: string,
    maxTokens?: number,
    options?: { stage?: string; enableCaching?: boolean },
  ): Promise<string>;

  isAvailable(): boolean;

  getModelName(): string;

  getMaxTokens(): number;

  getTemperature(): number;

  getTokenStats(): TokenStats;

  resetTokenStats?(): void;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface TokenStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalTokens: number;
  invocationCount: number;
  startTime: Date;
  estimatedCost: number;
}
