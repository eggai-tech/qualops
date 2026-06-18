jest.mock('@openai/agents', () => ({
  Agent: jest.fn(),
  run: jest.fn(),
  setDefaultOpenAIClient: jest.fn(),
  getGlobalTraceProvider: jest.fn(() => ({ setDisabled: jest.fn() })),
  // Preserve the full opts so tests can inspect name + call execute
  tool: jest.fn((opts: { name: string; execute: (args: unknown) => Promise<string> }) => opts),
}));
jest.mock('openai', () => {
  const ctor = jest.fn(() => ({}));
  ctor.default = ctor;
  ctor.AzureOpenAI = jest.fn(() => ({}));
  return ctor;
});
jest.mock('@/config/env', () => ({ envConfig: { get: jest.fn().mockReturnValue('') } }));
jest.mock('@/stages/review/agentic/tools/handlers');
jest.mock('@/stages/review/agentic/tools/bash/session', () => ({
  startBashSession: jest.fn().mockResolvedValue({ session: null, dispose: jest.fn() }),
}));
jest.mock('@/shared/utils/logger');

import { run as mockRun, Agent as MockAgent } from '@openai/agents';

import type { AgentAdapterParams } from '@/stages/review/agentic/adapters/agent-adapter';
import { OpenAIAdapter } from '@/stages/review/agentic/adapters/openai-adapter';
import { startBashSession } from '@/stages/review/agentic/tools/bash/session';
import * as handlers from '@/stages/review/agentic/tools/handlers';

const mockRunFn = mockRun as jest.MockedFunction<typeof mockRun>;
const MockAgentCtor = MockAgent as jest.MockedClass<typeof MockAgent>;
const mockStartBashSession = startBashSession as jest.MockedFunction<typeof startBashSession>;

// Cast to jest mocks for all handler functions
const h = handlers as jest.Mocked<typeof handlers>;

const CWD = '/project/repo';

function makeParams(overrides: Partial<AgentAdapterParams> = {}): AgentAdapterParams {
  return {
    systemPrompt: 'You are a reviewer',
    userPrompt: 'Review this code',
    agents: {},
    model: 'gpt-5-mini',
    cwd: CWD,
    maxTurns: 10,
    toolConfig: { bash: {} },
    ...overrides,
  };
}

function makeRunResult(inputTokens = 0, outputTokens = 0) {
  return {
    finalOutput: { issues: [] },
    state: { usage: { inputTokens, outputTokens } },
  };
}

/** Capture tools built during a run() invocation by intercepting Agent constructor calls. */
function capturedTools(): Array<{ name: string; execute: (args: unknown) => Promise<string> }> {
  // The first Agent constructor call is the first handoff (or orchestrator if no handoffs).
  // With no agents, only the orchestrator is created — its tools are captured from the last call.
  const calls = MockAgentCtor.mock.calls;
  if (!calls.length) return [];
  const lastCall = calls[calls.length - 1][0] as { tools: any[] };
  return lastCall?.tools ?? [];
}

describe('OpenAIAdapter — run()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockAgentCtor.mockImplementation(() => ({}) as InstanceType<typeof MockAgent>);
  });

  it('returns structuredOutput from run() finalOutput.issues', async () => {
    const issues = [{ description: 'issue1', confidence: 9 }];
    mockRunFn.mockResolvedValue({
      finalOutput: { issues },
      state: { usage: { inputTokens: 0, outputTokens: 0 } },
    } as any);
    const result = await new OpenAIAdapter().run(makeParams());
    expect(result.structuredOutput).toEqual(issues);
    expect(result.output).toBe('');
  });

  it('extracts token counts from state.usage', async () => {
    mockRunFn.mockResolvedValue(makeRunResult(120, 60) as any);
    const result = await new OpenAIAdapter().run(makeParams());
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(60);
  });

  it('throws when finalOutput is null', async () => {
    mockRunFn.mockResolvedValue({
      finalOutput: null,
      state: { usage: { inputTokens: 0, outputTokens: 0 } },
    } as any);
    await expect(new OpenAIAdapter().run(makeParams())).rejects.toThrow('finalOutput is missing');
  });

  it('passes maxTurns to run()', async () => {
    mockRunFn.mockResolvedValue(makeRunResult() as any);
    await new OpenAIAdapter().run(makeParams({ maxTurns: 42 }));
    expect((mockRunFn.mock.calls[0][2] as { maxTurns: number }).maxTurns).toBe(42);
  });

  it('creates one orchestrator when agents is empty', async () => {
    mockRunFn.mockResolvedValue(makeRunResult() as any);
    await new OpenAIAdapter().run(makeParams());
    expect(MockAgentCtor).toHaveBeenCalledTimes(1);
  });

  it('creates orchestrator + handoff agent for each entry in agents', async () => {
    mockRunFn.mockResolvedValue(makeRunResult() as any);
    await new OpenAIAdapter().run(
      makeParams({
        agents: {
          'security-analyzer': {
            description: 'Security',
            prompt: 'Check security',
            tools: ['find_usages'],
          },
        },
      }),
    );
    expect(MockAgentCtor).toHaveBeenCalledTimes(2);
  });

  it('rethrows when run() throws', async () => {
    mockRunFn.mockRejectedValue(new Error('OpenAI failure'));
    await expect(new OpenAIAdapter().run(makeParams())).rejects.toThrow('OpenAI failure');
  });
});

describe('OpenAIAdapter — tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    MockAgentCtor.mockImplementation((opts: any) => opts as InstanceType<typeof MockAgent>);
    mockRunFn.mockResolvedValue(makeRunResult() as any);
  });

  async function getToolExecute(name: string) {
    await new OpenAIAdapter().run(makeParams());
    const tool = capturedTools().find((t) => t.name === name);
    if (!tool) throw new Error(`Tool "${name}" not found`);
    return tool.execute.bind(tool);
  }

  it('read_file tool calls readFile handler', async () => {
    h.readFile.mockReturnValue('file contents');
    const execute = await getToolExecute('read_file');
    const result = await execute({ filePath: 'src/foo.ts' });
    expect(h.readFile).toHaveBeenCalledWith(CWD, 'src/foo.ts', undefined);
    expect(result).toBe('file contents');
  });

  it('grep_files tool calls grepFiles handler', async () => {
    h.grepFiles.mockReturnValue('match');
    const execute = await getToolExecute('grep_files');
    const result = await execute({ pattern: 'foo', glob: '*.ts', ignoreCase: true });
    expect(h.grepFiles).toHaveBeenCalledWith(CWD, 'foo', '*.ts', true, undefined);
    expect(result).toBe('match');
  });

  it('glob_files tool calls globFiles handler', async () => {
    h.globFiles.mockResolvedValue('/project/repo/src/foo.ts');
    const execute = await getToolExecute('glob_files');
    const result = await execute({ pattern: '**/*.ts' });
    expect(h.globFiles).toHaveBeenCalledWith(CWD, '**/*.ts', undefined);
    expect(result).toBe('/project/repo/src/foo.ts');
  });

  it('find_usages tool calls findUsages handler', async () => {
    h.findUsages.mockReturnValue('usages');
    const execute = await getToolExecute('find_usages');
    const result = await execute({ symbol: 'myFn' });
    expect(h.findUsages).toHaveBeenCalledWith(CWD, 'myFn', undefined, undefined, undefined);
    expect(result).toBe('usages');
  });

  it('trace_imports tool calls traceImports handler', async () => {
    h.traceImports.mockReturnValue('{}');
    const execute = await getToolExecute('trace_imports');
    const result = await execute({ filePath: 'src/foo.ts' });
    expect(h.traceImports).toHaveBeenCalledWith(CWD, 'src/foo.ts', undefined);
    expect(result).toBe('{}');
  });

  it('git_diff_analysis tool calls gitDiffAnalysis handler', async () => {
    h.gitDiffAnalysis.mockReturnValue('diff output');
    const execute = await getToolExecute('git_diff_analysis');
    const result = await execute({ base: 'main' });
    expect(h.gitDiffAnalysis).toHaveBeenCalledWith(
      CWD,
      'main',
      undefined,
      undefined,
      undefined,
      undefined,
    );
    expect(result).toBe('diff output');
  });

  it('list_changed_files tool calls listChangedFiles handler', async () => {
    h.listChangedFiles.mockReturnValue('M foo.ts');
    const execute = await getToolExecute('list_changed_files');
    const result = await execute({ base: 'main' });
    expect(h.listChangedFiles).toHaveBeenCalledWith(CWD, 'main', undefined, undefined);
    expect(result).toBe('M foo.ts');
  });

  it('onToolCall is invoked with turn and tool name', async () => {
    h.readFile.mockReturnValue('contents');
    const onToolCall = jest.fn();
    await new OpenAIAdapter().run(makeParams({ onToolCall }));
    const execute = capturedTools().find((t) => t.name === 'read_file')?.execute;
    await execute?.({ filePath: 'src/foo.ts' });
    expect(onToolCall).toHaveBeenCalledWith(1, 'read_file', { filePath: 'src/foo.ts' });
  });

  it('continues and returns structuredOutput when startBashSession throws', async () => {
    const issues = [{ description: 'issue', confidence: 8 }];
    mockStartBashSession.mockRejectedValueOnce(new Error('spawn failed'));
    mockRunFn.mockResolvedValue({
      finalOutput: { issues },
      state: { usage: { inputTokens: 0, outputTokens: 0 } },
    } as never);
    const result = await new OpenAIAdapter().run(makeParams());
    expect(result.structuredOutput).toEqual(issues);
  });

  it('calls dispose in finally even when run throws', async () => {
    const mockDispose = jest.fn().mockResolvedValue(undefined);
    mockStartBashSession.mockResolvedValueOnce({ session: null as never, dispose: mockDispose });
    mockRunFn.mockRejectedValueOnce(new Error('run failed'));
    await expect(new OpenAIAdapter().run(makeParams())).rejects.toThrow('run failed');
    expect(mockDispose).toHaveBeenCalled();
  });
});
