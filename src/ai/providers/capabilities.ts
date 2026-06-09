import type { AIProviderName } from '@/shared/types';

import modelCatalog from './model-capabilities.json';

export type StructuredOutputDialect =
  | 'openai-json-schema-strict'
  | 'openai-json-object' // kept for compat, no longer newly assigned
  | 'anthropic-output-config'
  | 'anthropic-tool-use'
  | 'unstructured'; // prose pipeline — model does not support json_schema

export interface ProviderCapabilities {
  structuredDialect: StructuredOutputDialect;
  supportsTemperature: boolean;
  maxTokensField: 'max_tokens' | 'max_completion_tokens';
}

const ANTHROPIC_NATIVE_STRUCTURED_MODELS: RegExp[] = [
  /^claude-sonnet-4-[5-9]/,
  /^claude-opus-4-[5-9]/,
  /^claude-haiku-4-[5-9]/,
  /^claude-mythos/,
];

type CatalogEntry = { supportsResponseSchema: boolean; supportsToolUse: boolean };
const catalogModels = modelCatalog.models as Record<string, CatalogEntry>;

/**
 * Look up a model in the litellm catalog.
 * Tries exact match first, then strips a provider prefix (e.g. "openai/gpt-4o" → "gpt-4o").
 * Returns null when the model is not in the catalog — callers should default to unstructured.
 */
function lookupCatalog(model: string): CatalogEntry | null {
  if (catalogModels[model]) return catalogModels[model];
  // Try stripping a leading "provider/" prefix
  const slash = model.indexOf('/');
  if (slash !== -1) {
    const bare = model.slice(slash + 1);
    if (catalogModels[bare]) return catalogModels[bare];
  }
  // Try finding a catalog entry whose key ends with "/" + model
  const suffix = `/${model}`;
  for (const key of Object.keys(catalogModels)) {
    if (key.endsWith(suffix)) return catalogModels[key];
  }
  return null;
}

export function detectCapabilities(provider: AIProviderName, model: string): ProviderCapabilities {
  switch (provider) {
    case 'openai':
      return detectOpenAICapabilities(model);
    case 'github':
      return detectOpenAICapabilities(model);
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

function detectOpenAICapabilities(model: string): ProviderCapabilities {
  // o-series and gpt-5 reasoning models reject `temperature` and require
  // `max_completion_tokens`. This is a separate concern from structured output
  // support — they still support json_schema.
  const isReasoning = /^o[1-9](?:-|$)/.test(model) || /^gpt-5/.test(model);

  const entry = lookupCatalog(model);
  // Reasoning models detected by regex but absent from the catalog (e.g. o1-preview,
  // o1-mini) fall back to unstructured since we cannot confirm json_schema support.
  const supportsStrict = entry?.supportsResponseSchema ?? false;

  return {
    structuredDialect: supportsStrict ? 'openai-json-schema-strict' : 'unstructured',
    supportsTemperature: !isReasoning,
    maxTokensField: isReasoning ? 'max_completion_tokens' : 'max_tokens',
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
