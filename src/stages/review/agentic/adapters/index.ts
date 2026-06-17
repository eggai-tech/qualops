import type { AgentAdapter } from './agent-adapter';
import { AnthropicAdapter } from './anthropic-adapter';
import { ConfigurableAgentAdapter } from './configurable-agent-adapter';
import { OpenAIAdapter } from './openai-adapter';
import { ConfigService } from '../../../../config/config';
import type { AIProviderName } from '../../../../shared/types';

const ADAPTERS: Array<{
  type: 'anthropic' | 'openai' | 'openai-compatible';
  ctor: new () => AgentAdapter;
}> = [
  { type: 'anthropic', ctor: AnthropicAdapter },
  { type: 'openai', ctor: OpenAIAdapter },
  { type: 'openai-compatible', ctor: ConfigurableAgentAdapter },
];

export function createAgentAdapter(provider: AIProviderName): AgentAdapter {
  const adapterType = ConfigService.getInstance().resolveAgentAdapterType(provider);
  if (!adapterType) {
    throw new Error(`Agentic mode is not implemented for provider: ${provider}`);
  }
  const entry = ADAPTERS.find((a) => a.type === adapterType);
  if (!entry) {
    throw new Error(`No adapter registered for type: ${adapterType}`);
  }
  return new entry.ctor();
}
