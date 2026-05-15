import type { AIProviderName } from '@/shared/types';

export type StructuredOutputDialect =
  | 'openai-json-schema-strict'
  | 'openai-json-object'
  | 'anthropic-output-config'
  | 'anthropic-tool-use'
  | 'prompt-fallback';

export interface ProviderCapabilities {
  structuredDialect: StructuredOutputDialect;
  supportsTemperature: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}

const OPENAI_STRICT_MODELS: RegExp[] = [/^gpt-5/, /^gpt-4o/, /^o[1-9]/];

const GITHUB_STRICT_MODELS: RegExp[] = [/(?:^|\/)gpt-4o(?:-2024-08-06|-2024-11-20)?$/];

const ANTHROPIC_NATIVE_STRUCTURED_MODELS: RegExp[] = [
  /^claude-sonnet-4-[5-9]/,
  /^claude-opus-4-[5-9]/,
  /^claude-haiku-4-[5-9]/,
  /^claude-mythos/,
];

export function detectCapabilities(provider: AIProviderName, model: string): ProviderCapabilities {
  switch (provider) {
    case 'openai':
      return detectOpenAICapabilities(model, false);
    case 'github':
      return detectOpenAICapabilities(model, true);
    case 'anthropic':
      return detectAnthropicCapabilities(model);
    case 'bedrock':
      return detectBedrockCapabilities(model);
    default: {
      const _exhaustive: never = provider;
      throw new Error(`Unknown provider: ${String(_exhaustive)}`);
    }
  }
}

function detectOpenAICapabilities(model: string, isGitHub: boolean): ProviderCapabilities {
  const isGpt5 = /^gpt-5/.test(model);
  const isOSeries = /^o[1-9]/.test(model);
  const matchers = isGitHub ? GITHUB_STRICT_MODELS : OPENAI_STRICT_MODELS;
  const supportsStrict = matchers.some((re) => re.test(model));

  // o-series and gpt-5 reject `temperature` and require `max_completion_tokens`.
  const isReasoningModel = isGpt5 || isOSeries;

  return {
    structuredDialect: supportsStrict ? 'openai-json-schema-strict' : 'openai-json-object',
    supportsTemperature: !isReasoningModel,
    maxTokensField: isReasoningModel ? 'max_completion_tokens' : 'max_tokens',
  };
}

function detectAnthropicCapabilities(model: string): ProviderCapabilities {
  const supportsNative = ANTHROPIC_NATIVE_STRUCTURED_MODELS.some((re) => re.test(model));
  return {
    structuredDialect: supportsNative ? 'anthropic-output-config' : 'anthropic-tool-use',
    supportsTemperature: true,
    maxTokensField: 'max_tokens',
  };
}

function detectBedrockCapabilities(_model: string): ProviderCapabilities {
  return {
    structuredDialect: 'anthropic-tool-use',
    supportsTemperature: true,
    maxTokensField: 'max_tokens',
  };
}
