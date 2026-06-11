jest.mock('@/config/config', () => ({
  ConfigService: {
    getInstance: jest.fn(),
  },
}));
jest.mock('@/stages/review/agentic/adapters/anthropic-adapter', () => ({
  AnthropicAdapter: jest.fn().mockImplementation(() => ({ type: 'anthropic' })),
}));
jest.mock('@/stages/review/agentic/adapters/openai-adapter', () => ({
  OpenAIAdapter: jest.fn().mockImplementation(() => ({ type: 'openai' })),
}));
jest.mock('@/stages/review/agentic/adapters/configurable-agent-adapter', () => ({
  ConfigurableAgentAdapter: jest.fn().mockImplementation(() => ({ type: 'openai-compatible' })),
}));

import { ConfigService } from '@/config/config';
import type { AIProviderName } from '@/shared/types';
import { createAgentAdapter } from '@/stages/review/agentic/adapters';
import { AnthropicAdapter } from '@/stages/review/agentic/adapters/anthropic-adapter';
import { ConfigurableAgentAdapter } from '@/stages/review/agentic/adapters/configurable-agent-adapter';
import { OpenAIAdapter } from '@/stages/review/agentic/adapters/openai-adapter';

const mockGetInstance = ConfigService.getInstance as jest.MockedFunction<
  typeof ConfigService.getInstance
>;

function setupProvider(adapterType: 'anthropic' | 'openai' | 'openai-compatible' | undefined) {
  mockGetInstance.mockReturnValue({
    resolveAgentAdapterType: jest.fn().mockReturnValue(adapterType),
  } as unknown as ReturnType<typeof ConfigService.getInstance>);
}

describe('createAgentAdapter — adapter selection', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns AnthropicAdapter for provider "anthropic"', () => {
    setupProvider('anthropic');
    const adapter = createAgentAdapter('anthropic' as AIProviderName);
    expect(AnthropicAdapter).toHaveBeenCalledTimes(1);
    expect(adapter).toEqual({ type: 'anthropic' });
  });

  it('returns OpenAIAdapter for provider "openai"', () => {
    setupProvider('openai');
    const adapter = createAgentAdapter('openai' as AIProviderName);
    expect(OpenAIAdapter).toHaveBeenCalledTimes(1);
    expect(adapter).toEqual({ type: 'openai' });
  });

  it('returns OpenAIAdapter for provider "github" (openai adapter type)', () => {
    setupProvider('openai');
    const adapter = createAgentAdapter('github' as AIProviderName);
    expect(OpenAIAdapter).toHaveBeenCalledTimes(1);
    expect(adapter).toEqual({ type: 'openai' });
  });

  it('returns ConfigurableAgentAdapter for provider "openai-compatible"', () => {
    setupProvider('openai-compatible');
    const adapter = createAgentAdapter('openai-compatible' as AIProviderName);
    expect(ConfigurableAgentAdapter).toHaveBeenCalledTimes(1);
    expect(adapter).toEqual({ type: 'openai-compatible' });
  });

  it('throws for a provider with no agentic support', () => {
    setupProvider(undefined);
    expect(() => createAgentAdapter('bedrock' as AIProviderName)).toThrow(
      'Agentic mode is not implemented for provider: bedrock',
    );
  });
});
