import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// buildSystemPrompt is private — test it via the public execute() interface
// by mocking the adapter and capturing the systemPrompt it receives.

jest.mock('@/stages/review/agentic/adapters', () => ({
  createAgentAdapter: jest.fn(),
}));
jest.mock('@/shared/utils/logger');

import type { PipelineJob } from '@/shared/types/config';
import { createAgentAdapter } from '@/stages/review/agentic/adapters';
import type {
  AgentAdapter,
  AgentAdapterParams,
} from '@/stages/review/agentic/adapters/agent-adapter';
import { AgenticExecutor } from '@/stages/review/agentic/agentic-executor';

const mockCreateAgentAdapter = createAgentAdapter as jest.MockedFunction<typeof createAgentAdapter>;

// AgenticExecutor resolves prompts relative to process.cwd()/.qualops/prompts
const promptsDir = resolve(process.cwd(), '.qualops/prompts/__agentic_executor_test__');

beforeAll(() => {
  mkdirSync(promptsDir, { recursive: true });
  writeFileSync(join(promptsDir, 'custom.md'), 'From file: custom instructions.');
});

afterAll(() => {
  rmSync(promptsDir, { recursive: true, force: true });
});

function makeJob(agenticOverrides: Record<string, unknown> = {}): PipelineJob {
  return {
    name: 'test-job',
    enabled: true,
    mode: 'agentic',
    passes: [],
    agentic: {
      maxTurns: 1,
      ...agenticOverrides,
    },
  } as unknown as PipelineJob;
}

let capturedParams: AgentAdapterParams | null = null;

function mockAdapterWithResult(result: string): AgentAdapter {
  capturedParams = null;
  return {
    run: jest.fn(async (params: AgentAdapterParams) => {
      capturedParams = params;
      return { output: result };
    }),
  };
}

function setupMockAdapter(result = '[]') {
  mockCreateAgentAdapter.mockReturnValue(mockAdapterWithResult(result));
}

async function runExecutor(job: PipelineJob): Promise<void> {
  setupMockAdapter();
  const executor = new AgenticExecutor(job, undefined, 'test-model');
  await executor.execute([{ path: 'src/foo.ts', content: 'const x = 1;' }]);
}

describe('AgenticExecutor — execute()', () => {
  beforeEach(() => {
    mockCreateAgentAdapter.mockReset();
  });

  it('returns empty array immediately when no files provided', async () => {
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    const result = await executor.execute([]);
    expect(result).toEqual([]);
    expect(mockCreateAgentAdapter).not.toHaveBeenCalled();
  });

  it('parses issues from a successful result', async () => {
    const issue = {
      type: 'security',
      severity: 'high',
      description: 'SQL injection',
      location: 'src/db.ts:10',
      reasoning: 'Unsanitized input',
      suggestion: 'Use parameterized queries',
      confidence: 9,
    };
    setupMockAdapter(JSON.stringify([issue]));
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    const result = await executor.execute([{ path: 'src/db.ts', content: 'query(input)' }]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('SQL injection');
  });

  it('returns empty array when adapter returns no output', async () => {
    mockCreateAgentAdapter.mockReturnValue({ run: jest.fn(async () => ({ output: '' })) });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    const result = await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    expect(result).toEqual([]);
  });

  it('parses issues from structuredOutput when adapter returns it', async () => {
    const issue = {
      type: 'security',
      severity: 'high',
      description: 'SQL injection',
      location: 'src/db.ts:10',
      confidence: 9,
    };
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => ({ output: '', structuredOutput: [issue] })),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    const result = await executor.execute([{ path: 'src/db.ts', content: 'query(input)' }]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('SQL injection');
  });

  it('passes onToolCall to adapter and tracks turn index', async () => {
    let capturedOnToolCall: AgentAdapterParams['onToolCall'];
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async (params: AgentAdapterParams) => {
        capturedOnToolCall = params.onToolCall;
        params.onToolCall?.(3, 'read_file', { filePath: 'src/foo.ts' });
        return { output: '[]' };
      }),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    expect(capturedOnToolCall).toBeDefined();
  });

  it('throws on hard failure error subtypes', async () => {
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => ({ output: '', errorSubtype: 'error_rate_limit_tokens' as const })),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await expect(executor.execute([{ path: 'src/foo.ts', content: 'x' }])).rejects.toThrow(
      'error_rate_limit_tokens',
    );
  });

  it('returns empty and does not throw on soft error subtypes', async () => {
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => ({ output: '', errorSubtype: 'error_max_turns' as const })),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    const result = await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    expect(result).toEqual([]);
  });

  it('throws when structuredOutput is not an array', async () => {
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => ({ output: '', structuredOutput: { unexpected: 'object' } })),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await expect(executor.execute([{ path: 'src/foo.ts', content: 'x' }])).rejects.toThrow(
      'structured output is not an array',
    );
  });

  it('throws when non-empty text output contains no JSON', async () => {
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => ({ output: 'No issues found in this code.' })),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await expect(executor.execute([{ path: 'src/foo.ts', content: 'x' }])).rejects.toThrow(
      'no parseable JSON issues',
    );
  });

  it('rethrows when adapter throws', async () => {
    mockCreateAgentAdapter.mockReturnValue({
      run: jest.fn(async () => {
        throw new Error('API failure');
      }),
    });
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await expect(executor.execute([{ path: 'src/foo.ts', content: 'x' }])).rejects.toThrow(
      'API failure',
    );
  });

  it('passes the provider from ConfigService to createAgentAdapter', async () => {
    setupMockAdapter();
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    // ConfigService reads from .qualopsrc.json; provider must be a known AIProviderName
    const calledWith = mockCreateAgentAdapter.mock.calls[0][0];
    expect(['anthropic', 'openai', 'openai-compatible', 'github', 'bedrock']).toContain(calledWith);
  });
});

describe('AgenticExecutor — systemPrompt / prompt composition', () => {
  beforeEach(() => {
    mockCreateAgentAdapter.mockReset();
  });

  it('passes empty system prompt when neither systemPrompt nor prompt is set', async () => {
    await runExecutor(makeJob());
    expect(capturedParams?.systemPrompt).toBe('');
  });

  it('injects inline systemPrompt into the system message', async () => {
    await runExecutor(makeJob({ systemPrompt: 'Inline instructions.' }));
    expect(capturedParams?.systemPrompt).toContain('Inline instructions.');
  });

  it('loads prompt from file and injects it into the system message', async () => {
    await runExecutor(makeJob({ prompt: '__agentic_executor_test__/custom.md' }));
    expect(capturedParams?.systemPrompt).toContain('From file: custom instructions.');
  });

  it('prepends systemPrompt before file prompt when both are set', async () => {
    await runExecutor(
      makeJob({
        systemPrompt: 'Inline first.',
        prompt: '__agentic_executor_test__/custom.md',
      }),
    );
    const sp = capturedParams?.systemPrompt ?? '';
    const inlinePos = sp.indexOf('Inline first.');
    const filePos = sp.indexOf('From file: custom instructions.');
    expect(inlinePos).toBeGreaterThanOrEqual(0);
    expect(filePos).toBeGreaterThanOrEqual(0);
    expect(inlinePos).toBeLessThan(filePos);
  });

  it('accepts promptConfig object form for prompt', async () => {
    await runExecutor(makeJob({ prompt: { file: '__agentic_executor_test__/custom.md' } }));
    expect(capturedParams?.systemPrompt).toContain('From file: custom instructions.');
  });
});
