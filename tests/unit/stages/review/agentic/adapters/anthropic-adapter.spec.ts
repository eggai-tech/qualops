jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('@/stages/review/agentic/tools', () => ({
  createAgenticTools: jest.fn().mockResolvedValue({ server: {}, dispose: jest.fn() }),
}));
jest.mock('@/shared/utils/logger');

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { AgentAdapterParams } from '@/stages/review/agentic/adapters/agent-adapter';
import { AnthropicAdapter } from '@/stages/review/agentic/adapters/anthropic-adapter';
import { createAgenticTools } from '@/stages/review/agentic/tools';

const mockQuery = query as jest.MockedFunction<typeof query>;
const mockCreateAgenticTools = createAgenticTools as jest.MockedFunction<typeof createAgenticTools>;

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
    mockCreateAgenticTools.mockResolvedValue({ server: {} as never, dispose: jest.fn() });
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
    // Only safe read-only built-ins are enabled. SDK Bash must NOT be present
    // so the agent cannot bypass our policy engine by calling it directly.
    expect(callOptions.tools).toEqual(['Read', 'Grep', 'Glob']);
    expect((callOptions.tools as string[]).includes('Bash')).toBe(false);
  });

  it('logs mcp bash tool_use and tool_result output', async () => {
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

  it('logs assistant text blocks', async () => {
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
    mockCreateAgenticTools.mockResolvedValueOnce({ server: {} as never, dispose: mockDispose });
    mockQuery.mockReturnValue(
      (async function* () {
        throw new Error('query failure');
      })(),
    );
    const adapter = new AnthropicAdapter();
    await expect(adapter.run(makeParams())).rejects.toThrow('query failure');
    expect(mockDispose).toHaveBeenCalled();
  });

  it('passes toolConfig to createAgenticTools', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: '[]' };
      })(),
    );
    const adapter = new AnthropicAdapter();
    const toolConfig = { bash: { workspaceRoot: '/workspace/pr' } };
    await adapter.run(makeParams({ toolConfig }));
    expect(mockCreateAgenticTools).toHaveBeenCalledWith(expect.any(String), toolConfig);
  });
});
