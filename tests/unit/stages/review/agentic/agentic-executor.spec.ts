import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

// buildSystemPrompt is private — test it via the public execute() interface
// by mocking the query function and capturing the systemPrompt it receives.

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: jest.fn(),
}));
jest.mock('@/stages/review/agentic/tools', () => ({
  createAgenticTools: jest.fn(() => ({})),
}));
jest.mock('@/shared/utils/logger');

import { query } from '@anthropic-ai/claude-agent-sdk';

import type { PipelineJob } from '@/shared/types/config';
import { logger } from '@/shared/utils/logger';
import { AgenticExecutor } from '@/stages/review/agentic/agentic-executor';

const mockQuery = query as jest.MockedFunction<typeof query>;

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

function capturedSystemPrompt(): string {
  const calls = mockQuery.mock.calls;
  const lastCall = calls[calls.length - 1];
  return (lastCall[0] as { options: { systemPrompt: string } }).options.systemPrompt;
}

async function runExecutor(job: PipelineJob): Promise<void> {
  // query returns an async iterable; emit a single result message so execute() finishes
  mockQuery.mockReturnValue(
    (async function* () {
      yield { type: 'result', subtype: 'success', result: '[]' };
    })(),
  );

  const executor = new AgenticExecutor(job);
  await executor.execute([{ path: 'src/foo.ts', content: 'const x = 1;' }]);
}

describe('AgenticExecutor — execute()', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('returns empty array immediately when no files provided', async () => {
    const executor = new AgenticExecutor(makeJob());
    const result = await executor.execute([]);
    expect(result).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('parses issues from a successful result message', async () => {
    const issue = {
      type: 'security',
      severity: 'high',
      description: 'SQL injection',
      location: 'src/db.ts:10',
      reasoning: 'Unsanitized input',
      suggestion: 'Use parameterized queries',
      confidence: 9,
    };
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'success', result: JSON.stringify([issue]) };
      })(),
    );
    const executor = new AgenticExecutor(makeJob());
    const result = await executor.execute([{ path: 'src/db.ts', content: 'query(input)' }]);
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('SQL injection');
  });

  it('logs error and continues when result subtype is not success', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        yield { type: 'result', subtype: 'error_max_turns' };
      })(),
    );
    const executor = new AgenticExecutor(makeJob());
    await executor.execute([{ path: 'src/foo.ts', content: 'x' }]);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('error_max_turns'));
  });

  it('rethrows when query throws', async () => {
    mockQuery.mockReturnValue(
      (async function* () {
        throw new Error('API failure');
      })(),
    );
    const executor = new AgenticExecutor(makeJob());
    await expect(executor.execute([{ path: 'src/foo.ts', content: 'x' }])).rejects.toThrow(
      'API failure',
    );
  });
});

describe('AgenticExecutor — systemPrompt / prompt composition', () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it('uses default prompt when neither systemPrompt nor prompt is set', async () => {
    await runExecutor(makeJob());
    const sp = capturedSystemPrompt();
    expect(sp).toContain('You are a code reviewer');
  });

  it('injects inline systemPrompt into the system message', async () => {
    await runExecutor(makeJob({ systemPrompt: 'Inline instructions.' }));
    const sp = capturedSystemPrompt();
    expect(sp).toContain('Inline instructions.');
  });

  it('loads prompt from file and injects it into the system message', async () => {
    await runExecutor(makeJob({ prompt: '__agentic_executor_test__/custom.md' }));
    const sp = capturedSystemPrompt();
    expect(sp).toContain('From file: custom instructions.');
  });

  it('prepends systemPrompt before file prompt when both are set', async () => {
    await runExecutor(
      makeJob({
        systemPrompt: 'Inline first.',
        prompt: '__agentic_executor_test__/custom.md',
      }),
    );
    const sp = capturedSystemPrompt();
    const inlinePos = sp.indexOf('Inline first.');
    const filePos = sp.indexOf('From file: custom instructions.');
    expect(inlinePos).toBeGreaterThanOrEqual(0);
    expect(filePos).toBeGreaterThanOrEqual(0);
    expect(inlinePos).toBeLessThan(filePos);
  });

  it('accepts promptConfig object form for prompt', async () => {
    await runExecutor(makeJob({ prompt: { file: '__agentic_executor_test__/custom.md' } }));
    const sp = capturedSystemPrompt();
    expect(sp).toContain('From file: custom instructions.');
  });
});
