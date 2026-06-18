jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
  tool: jest.fn((name: string, _desc: string, _schema: unknown, execute: unknown) => ({
    name,
    execute,
  })),
  createSdkMcpServer: jest.fn((opts: { tools: unknown[] }) => ({ tools: opts.tools })),
}));
jest.mock('@/stages/review/agentic/tools', () => ({
  createToolSet: jest.fn().mockResolvedValue({ tools: [], dispose: jest.fn() }),
}));
jest.mock('@/shared/utils/logger');

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { AgentAdapterParams } from '@/stages/review/agentic/adapters/agent-adapter';
import { AnthropicAdapter } from '@/stages/review/agentic/adapters/anthropic-adapter';
import { createToolSet } from '@/stages/review/agentic/tools';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockCreateToolSet = createToolSet as jest.MockedFunction<typeof createToolSet>;

function makeParams(overrides: Partial<AgentAdapterParams> = {}): AgentAdapterParams {
  return {
    systemPrompt: 'You are a reviewer',
    userPrompt: 'Review this code',
    agents: {},
    model: 'claude-test',
    cwd: process.cwd(),
    maxTurns: 10,
    toolConfig: { bash: {} },
    ...overrides,
  };
}

describe('AnthropicAdapter', () => {
  beforeEach(() => {
    mockQuery.mockReset();
    mockCreateToolSet.mockResolvedValue({ tools: [], dispose: jest.fn() });
  });

  it('falls back to text output when structured_output is absent from result', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '["issue1"]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.output).toBe('["issue1"]');
    expect(result.structuredOutput).toBeUndefined();
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

  it.each([
    ['error_max_turns', 'error_max_turns'],
    ['error_during_execution', 'error_provider_unavailable'],
    ['error_max_budget_usd', 'error_rate_limit_tokens'],
    ['error_max_structured_output_retries', 'error_content_filter'],
  ] as const)(
    'maps SDK subtype "%s" to qualops subtype "%s" and returns empty output',
    async (sdkSubtype, expectedSubtype) => {
      mockQuery.mockReturnValue(
        (async function* () {
          yield { type: 'result', subtype: sdkSubtype };
        })(),
      );
      const adapter = new AnthropicAdapter();
      const result = await adapter.run(makeParams());
      expect(result.errorSubtype).toBe(expectedSubtype);
      expect(result.output).toBe('');
    },
  );

  it('maps unknown SDK result subtype to error_unexpected', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'error_billing_hard_limit' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.errorSubtype).toBe('error_unexpected');
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

  it('returns structuredOutput when result contains structured_output wrapper', async () => {
    const issues = [{ description: 'sql injection', confidence: 9 }];
    mockQuery.mockReturnValue(
      (async function* () {
        // SDK returns the root object wrapper { issues: [...] } matching our schema
        yield { type: 'result', subtype: 'success', structured_output: { issues } };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.structuredOutput).toEqual(issues);
    expect(result.output).toBe('');
  });

  it('falls back to result text when structured_output has unexpected shape', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'result',
          subtype: 'success',
          structured_output: { unexpected: 'shape' },
          result: '[{"description":"fallback issue"}]',
        };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.structuredOutput).toBeUndefined();
    expect(result.output).toBe('[{"description":"fallback issue"}]');
  });

  it('returns empty output when structured_output is malformed and no result text', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', structured_output: { unexpected: 'shape' } };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.structuredOutput).toBeUndefined();
    expect(result.output).toBe('');
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

  it('uses bypassPermissions, includes mcp bash in allowedTools, and has no canUseTool', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    await adapter.run(makeParams());
    const callOptions = (
      mockQuery.mock.calls[0][0] as {
        options: {
          allowedTools: string[];
          tools: unknown;
          canUseTool?: unknown;
          permissionMode?: string;
        };
      }
    ).options;
    expect(callOptions.permissionMode).toBe('bypassPermissions');
    expect(callOptions.allowedTools).toContain('mcp__qualops-agentic-tools__bash');
    expect(callOptions.allowedTools).not.toContain('Bash');
    expect(callOptions.canUseTool).toBeUndefined();
    // No SDK built-ins — all file access goes through MCP tools so skipPatterns
    // enforcement in handlers.ts applies uniformly. SDK Bash must NOT be present.
    expect(callOptions.tools).toEqual([]);
    expect((callOptions.tools as string[]).includes('Bash')).toBe(false);
  });

  it('invokes onToolCall for mcp bash tool_use blocks', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'mcp__qualops-agentic-tools__bash',
                input: { command: 'git log --oneline' },
              },
            ],
          },
        };
        yield {
          type: 'user',
          message: {
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'tu_1',
                content: [
                  {
                    type: 'text',
                    text: JSON.stringify({ exit_code: 0, stdout: 'abc123 commit', stderr: '' }),
                  },
                ],
              },
            ],
          },
        };
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const onToolCall = jest.fn();
    const adapter = new AnthropicAdapter();
    await adapter.run(makeParams({ onToolCall }));
    expect(onToolCall).toHaveBeenCalledWith(1, 'mcp__qualops-agentic-tools__bash', {
      command: 'git log --oneline',
    });
  });

  it('processes assistant text blocks without affecting output', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Analyzing the code...' }],
          },
        };
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const result = await adapter.run(makeParams());
    expect(result.output).toBe('[]');
  });

  it('calls dispose even when query throws', async () => {
    const mockDispose = jest.fn().mockResolvedValue(undefined);
    mockCreateToolSet.mockResolvedValueOnce({ tools: [], dispose: mockDispose });
    mockQuery.mockReturnValue(
      (async function* () {
        throw new Error('query failure');
      })(),
    );
    const adapter = new AnthropicAdapter();
    await expect(adapter.run(makeParams())).rejects.toThrow('query failure');
    expect(mockDispose).toHaveBeenCalled();
  });

  it('passes toolConfig to createToolSet', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const toolConfig = { bash: { workspaceRoot: '/workspace/pr' } };
    await adapter.run(makeParams({ toolConfig }));
    expect(mockCreateToolSet).toHaveBeenCalledWith(expect.any(String), toolConfig, undefined);
  });
});
