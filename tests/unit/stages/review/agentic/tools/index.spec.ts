jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: jest.fn((name: string) => ({ name })),
  createSdkMcpServer: jest.fn((opts: { tools: unknown[] }) => ({ tools: opts.tools })),
}));
jest.mock('@/stages/review/agentic/tools/bash/session', () => ({
  startBashSession: jest.fn(),
}));
jest.mock('@/stages/review/agentic/tools/handlers', () => ({
  findUsages: jest.fn(),
  traceImports: jest.fn(),
  gitDiffAnalysis: jest.fn(),
  analyzeExports: jest.fn(),
  findInterfaceChanges: jest.fn(),
  listChangedFiles: jest.fn(),
}));
jest.mock('@/shared/utils/logger');

import { createAgenticTools } from '@/stages/review/agentic/tools';
import { startBashSession } from '@/stages/review/agentic/tools/bash/session';

const mockStartBashSession = startBashSession as jest.MockedFunction<typeof startBashSession>;

describe('createAgenticTools', () => {
  const cwd = '/project';
  const toolConfig = { bash: {} };

  beforeEach(() => {
    mockStartBashSession.mockReset();
  });

  it('includes bash tool when session starts successfully', async () => {
    const mockDispose = jest.fn().mockResolvedValue(undefined);
    const mockSession = { exec: jest.fn(), dispose: jest.fn() };
    mockStartBashSession.mockResolvedValue({ session: mockSession as never, dispose: mockDispose });

    const { server, dispose } = await createAgenticTools(cwd, toolConfig);

    // bash tool should be included in the server
    const tools = (server as { tools: Array<{ name: string }> }).tools;
    expect(tools.some((t) => t.name === 'bash')).toBe(true);

    await dispose();
    expect(mockDispose).toHaveBeenCalled();
  });

  it('excludes bash tool when session start fails', async () => {
    mockStartBashSession.mockRejectedValue(new Error('spawn failed'));

    const { server, dispose } = await createAgenticTools(cwd, toolConfig);

    const tools = (server as { tools: Array<{ name: string }> }).tools;
    expect(tools.some((t) => t.name === 'bash')).toBe(false);

    // dispose should be a no-op and not throw
    await expect(dispose()).resolves.toBeUndefined();
  });

  it('always includes the standard non-bash tools', async () => {
    mockStartBashSession.mockRejectedValue(new Error('spawn failed'));

    const { server } = await createAgenticTools(cwd, toolConfig);

    const tools = (server as { tools: Array<{ name: string }> }).tools;
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
    await createAgenticTools(cwd, specificConfig);

    expect(mockStartBashSession).toHaveBeenCalledWith(specificConfig.bash, 'AgenticTools');
  });
});
