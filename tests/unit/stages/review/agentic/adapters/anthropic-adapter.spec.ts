jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('@/stages/review/agentic/tools', () => ({
  createAgenticTools: jest.fn(() => ({})),
}));
jest.mock('@/shared/utils/logger');

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { AgentAdapterParams } from '@/stages/review/agentic/adapters/agent-adapter';
import { AnthropicAdapter } from '@/stages/review/agentic/adapters/anthropic-adapter';

const mockQuery = query as jest.MockedFunction<typeof query>;

function makeParams(overrides: Partial<AgentAdapterParams> = {}): AgentAdapterParams {
  return {
    systemPrompt: 'You are a reviewer',
    userPrompt: 'Review this code',
    agents: {},
    model: 'claude-test',
    cwd: process.cwd(),
    maxTurns: 10,
    ...overrides,
  };
}

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns output from a successful result message', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '["issue1"]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.output).toBe('["issue1"]');
  });

  it('extracts token counts from usage in result message', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          result: '[]',
          usage: { input_tokens: 100, output_tokens: 50 },
        };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
  });

  it('returns empty output and errorSubtype when result subtype is not success', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'error_max_turns' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.output).toBe('');
    expect(result.errorSubtype).toBe('error_max_turns');
  });

  it('invokes onToolCall for each tool_use block', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { path: 'src/foo.ts' } }],
          },
        };
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const onToolCall = jest.fn();
    const adapter = new AnthropicAdapter();
    await adapter.run(makeParams({ onToolCall }));
    expect(onToolCall).toHaveBeenCalledWith(1, 'Read', { path: 'src/foo.ts' });
  });

  it('passes maxBudgetUsd to query when provided', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    await adapter.run(makeParams({ maxBudgetUsd: 2.5 }));
    const callOptions = (mockQuery.mock.calls[0][0] as { options: { maxBudgetUsd?: number } })
      .options;
    expect(callOptions.maxBudgetUsd).toBe(2.5);
  });

  it('rethrows when query async generator throws', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        throw new Error('SDK failure');
      })(),
    );
    const adapter = new AnthropicAdapter();
    await expect(adapter.run(makeParams())).rejects.toThrow('SDK failure');
  });
});
