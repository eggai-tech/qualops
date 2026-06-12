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

  it('passes resolved provider to createAgentAdapter', async () => {
    setupMockAdapter();
    const executor = new AgenticExecutor(makeJob(), undefined, 'test-model');
    await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    expect(mockCreateAgentAdapter).toHaveBeenCalledWith(expect.any(String));
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
