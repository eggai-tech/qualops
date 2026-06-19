jest.mock('@/stages/review/agentic/tools/bash/session', () => ({
  startBashSession: jest.fn(),
}));
jest.mock('@/stages/review/agentic/tools/handlers', () => ({
  readFile: jest.fn(),
  grepFiles: jest.fn(),
  globFiles: jest.fn(),
  findUsages: jest.fn(),
  traceImports: jest.fn(),
  gitDiffAnalysis: jest.fn(),
  listChangedFiles: jest.fn(),
}));
jest.mock('@/shared/utils/logger');

import { createToolSet } from '@/stages/review/agentic/tools';
import { startBashSession } from '@/stages/review/agentic/tools/bash/session';

const mockStartBashSession = startBashSession as jest.MockedFunction<typeof startBashSession>;

describe('createToolSet', () => {
  const cwd = '/project';
  const toolConfig = { bash: {} };

  beforeEach(() => {
    mockStartBashSession.mockReset();
  });

  it('includes bash tool when session starts successfully', async () => {
    const mockDispose = jest.fn().mockResolvedValue(undefined);
    const mockSession = { exec: jest.fn(), dispose: jest.fn() };
    mockStartBashSession.mockResolvedValue({ session: mockSession as never, dispose: mockDispose });

    const { tools, dispose } = await createToolSet(cwd, toolConfig);

    expect(tools.some((t) => t.name === 'bash')).toBe(true);

    await dispose();
    expect(mockDispose).toHaveBeenCalled();
  });

  it('excludes bash tool when session start fails', async () => {
    mockStartBashSession.mockRejectedValue(new Error('spawn failed'));

    const { tools, dispose } = await createToolSet(cwd, toolConfig);

    expect(tools.some((t) => t.name === 'bash')).toBe(false);

    // dispose should be a no-op and not throw
    await expect(dispose()).resolves.toBeUndefined();
  });

  it('always includes the standard non-bash tools', async () => {
    mockStartBashSession.mockRejectedValue(new Error('spawn failed'));

    const { tools } = await createToolSet(cwd, toolConfig);

    const names = tools.map((t) => t.name);
    expect(names).toContain('find_usages');
    expect(names).toContain('git_diff_analysis');
    expect(names).toContain('list_changed_files');
  });

  it('passes toolConfig.bash to startBashSession', async () => {
    const mockDispose = jest.fn().mockResolvedValue(undefined);
    mockStartBashSession.mockResolvedValue({
      session: { exec: jest.fn(), dispose: jest.fn() } as never,
      dispose: mockDispose,
    });

    const specificConfig = { bash: { workspaceRoot: '/workspace/pr', maxCallsPerReview: 50 } };
    await createToolSet(cwd, specificConfig);

    expect(mockStartBashSession).toHaveBeenCalledWith(specificConfig.bash, 'AgenticTools');
  });

  it('each tool definition has name, description, schema, and execute', async () => {
    mockStartBashSession.mockRejectedValue(new Error('spawn failed'));

    const { tools } = await createToolSet(cwd, toolConfig);

    for (const tool of tools) {
      expect(typeof tool.name).toBe('string');
      expect(typeof tool.description).toBe('string');
      expect(tool.schema).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });

  it('bash tool description uses cwd when workspaceRoot is absent (local environment)', async () => {
    mockStartBashSession.mockResolvedValue({
      session: { exec: jest.fn(), dispose: jest.fn() } as never,
      dispose: jest.fn().mockResolvedValue(undefined),
    });

    const localCwd = '/home/runner/work/my-repo';
    const { tools } = await createToolSet(localCwd, { bash: {} });

    const bashTool = tools.find((t) => t.name === 'bash');
    expect(bashTool?.description).toContain(localCwd);
    expect(bashTool?.description).not.toContain('/workspace/pr');
  });

  it('bash tool description uses workspaceRoot when set (CI environment)', async () => {
    mockStartBashSession.mockResolvedValue({
      session: { exec: jest.fn(), dispose: jest.fn() } as never,
      dispose: jest.fn().mockResolvedValue(undefined),
    });

    const { tools } = await createToolSet(cwd, { bash: { workspaceRoot: '/workspace/pr' } });

    const bashTool = tools.find((t) => t.name === 'bash');
    expect(bashTool?.description).toContain('/workspace/pr');
    expect(bashTool?.description).not.toContain(cwd);
  });
});
