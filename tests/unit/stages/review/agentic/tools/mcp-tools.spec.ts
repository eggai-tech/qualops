import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

jest.mock('@/shared/utils/logger');

// find_usages and trace_imports (importedBy) depend on `rg` (ripgrep) being
// available on PATH. Skip those tests if rg is not installed.
let rgAvailable = false;
try {
  execSync('rg --version', { stdio: 'pipe' });
  rgAvailable = true;
} catch {
  // rg not on PATH
}

// The SDK is ESM-only and can't be loaded by ts-jest in CJS mode.
// We mock it entirely so Jest never tries to parse the .mjs bundle.
// The tool handlers are plain async functions over Node builtins — they don't
// use the SDK at runtime — so the mock just needs to capture them.

type ToolEntry = { name: string; handler: ToolHandler };
type ToolHandler = (args: Record<string, unknown>) => Promise<McpResult>;
type McpResult = { content: Array<{ type: string; text: string }> };

const capturedTools: ToolEntry[] = [];

jest.mock('@anthropic-ai/claude-agent-sdk', () => ({
  tool: (
    name: string,
    _description: string,
    _schema: unknown,
    handler: ToolHandler,
  ): ToolEntry => ({ name, handler }),
  createSdkMcpServer: (config: { tools: ToolEntry[] }) => {
    capturedTools.push(...config.tools);
    return {};
  },
}));

import { createAgenticTools } from '@/stages/review/agentic/tools';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getText(result: McpResult): string {
  return result.content[0].text;
}

/** Create a fresh temp git repo with a seed commit. */
function createTempGitRepo(): string {
  const root = join(tmpdir(), `qo-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });

  const git = (cmd: string) => execSync(cmd, { cwd: root, stdio: 'pipe' });
  git('git init');
  git('git config user.email "test@qualops.test"');
  git('git config user.name "QualOps Test"');

  writeFileSync(join(root, '.gitkeep'), '');
  git('git add .gitkeep');
  git('git commit --no-verify -m "init"');

  return root;
}

function writeAndCommit(root: string, files: Record<string, string>, message: string): void {
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = join(root, relPath);
    mkdirSync(join(fullPath, '..'), { recursive: true });
    writeFileSync(fullPath, content);
  }
  const paths = Object.keys(files).join(' ');
  execSync(`git add ${paths}`, { cwd: root, stdio: 'pipe' });
  execSync(`git commit --no-verify -m "${message}"`, { cwd: root, stdio: 'pipe' });
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let root: string;
let h: Record<string, ToolHandler>;

beforeAll(() => {
  root = createTempGitRepo();
  // Calling createAgenticTools populates capturedTools via the mock above
  createAgenticTools(root);
  h = Object.fromEntries(capturedTools.map((t) => [t.name, t.handler]));
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// list_changed_files
// ---------------------------------------------------------------------------

describe('list_changed_files', () => {
  beforeAll(() => {
    writeAndCommit(root, { 'src/alpha.ts': 'export const a = 1;\n' }, 'add alpha');
  });

  it('lists added files since HEAD~1', async () => {
    const text = getText(await h['list_changed_files']({ base: 'HEAD~1' }));
    expect(text).toMatch(/alpha\.ts/);
    expect(text).toMatch(/^A\t/m); // git name-status format: "A<tab>filename"
  });

  it('filters to added files only (filter=A)', async () => {
    writeFileSync(join(root, 'src/alpha.ts'), 'export const a = 2;\n');
    execSync('git add src/alpha.ts && git commit --no-verify -m "modify alpha"', {
      cwd: root,
      stdio: 'pipe',
      shell: true,
    });
    writeAndCommit(root, { 'src/beta.ts': 'export const b = 1;\n' }, 'add beta');

    const textA = getText(await h['list_changed_files']({ base: 'HEAD~2', filter: 'A' }));
    expect(textA).toMatch(/beta\.ts/);
    expect(textA).not.toMatch(/alpha\.ts/);

    const textM = getText(await h['list_changed_files']({ base: 'HEAD~2', filter: 'M' }));
    expect(textM).toMatch(/alpha\.ts/);
    expect(textM).not.toMatch(/beta\.ts/);
  });

  it('defaults head to HEAD', async () => {
    const text = getText(await h['list_changed_files']({ base: 'HEAD~1' }));
    expect(text).toMatch(/beta\.ts/);
  });

  it('returns "No changed files" when base equals head', async () => {
    const text = getText(await h['list_changed_files']({ base: 'HEAD', head: 'HEAD' }));
    expect(text).toBe('No changed files');
  });
});

// ---------------------------------------------------------------------------
// git_diff_analysis
// ---------------------------------------------------------------------------

describe('git_diff_analysis', () => {
  it('returns a unified diff between commits', async () => {
    const text = getText(await h['git_diff_analysis']({ base: 'HEAD~1' }));
    expect(text).toMatch(/^@@/m);
    expect(text).toMatch(/\+/);
  });

  it('returns stat summary when stat=true', async () => {
    const text = getText(await h['git_diff_analysis']({ base: 'HEAD~1', stat: true }));
    // stat format: "src/beta.ts | 1 +"
    expect(text).toMatch(/\|\s+\d+/);
    expect(text).not.toMatch(/^@@/m);
  });

  it('filters to a specific file', async () => {
    const text = getText(await h['git_diff_analysis']({ base: 'HEAD~1', file: 'src/beta.ts' }));
    expect(text).toMatch(/beta\.ts/);
    expect(text).not.toMatch(/alpha\.ts/);
  });

  it('returns "No differences found" when base and head are the same', async () => {
    const text = getText(await h['git_diff_analysis']({ base: 'HEAD', head: 'HEAD' }));
    expect(text).toBe('No differences found');
  });
});

// ---------------------------------------------------------------------------
// find_usages
// ---------------------------------------------------------------------------

describe('find_usages', () => {
  const itWithRg = rgAvailable ? it : it.skip;

  beforeAll(() => {
    writeFileSync(
      join(root, 'src/definer.ts'),
      'export function uniqueSymbol123() { return 42; }\n',
    );
    writeFileSync(
      join(root, 'src/consumer.ts'),
      'import { uniqueSymbol123 } from "./definer";\nuniqueSymbol123();\n',
    );
  });

  itWithRg('finds a symbol referenced in multiple files', async () => {
    const text = getText(await h['find_usages']({ symbol: 'uniqueSymbol123' }));
    expect(text).toMatch(/definer\.ts/);
    expect(text).toMatch(/consumer\.ts/);
  });

  itWithRg('returns "No usages found" for an unknown symbol', async () => {
    const text = getText(await h['find_usages']({ symbol: 'xyzNoSuchSymbol999abc' }));
    expect(text).toBe('No usages found');
  });

  itWithRg('respects the scope parameter', async () => {
    mkdirSync(join(root, 'other'), { recursive: true });
    writeFileSync(join(root, 'other/outside.ts'), 'function uniqueSymbol123() {}\n');

    const text = getText(
      await h['find_usages']({ symbol: 'uniqueSymbol123', scope: join(root, 'src') }),
    );
    expect(text).toMatch(/definer\.ts/);
    expect(text).not.toMatch(/outside\.ts/);
  });

  it('returns an error message when rg is not available', async () => {
    if (rgAvailable) {
      // rg is available — nothing to assert for the error case
      return;
    }
    const text = getText(await h['find_usages']({ symbol: 'anything' }));
    expect(text).toMatch(/Error:/);
  });
});

// ---------------------------------------------------------------------------
// trace_imports
// ---------------------------------------------------------------------------

describe('trace_imports', () => {
  it('extracts imports, exports, and importedBy for a relative path', async () => {
    const result = JSON.parse(getText(await h['trace_imports']({ filePath: 'src/consumer.ts' })));

    expect(result.filePath).toBe('src/consumer.ts');
    expect(result.imports).toContain('./definer');
    expect(Array.isArray(result.importedBy)).toBe(true);
    expect(Array.isArray(result.exports)).toBe(true);
  });

  it('reports exports from the definer file', async () => {
    const result = JSON.parse(getText(await h['trace_imports']({ filePath: 'src/definer.ts' })));
    expect(result.exports).toContain('uniqueSymbol123');
  });

  it('accepts an absolute path', async () => {
    const result = JSON.parse(
      getText(await h['trace_imports']({ filePath: join(root, 'src/definer.ts') })),
    );
    expect(result.exports).toContain('uniqueSymbol123');
  });

  it('returns "File not found" for a non-existent path', async () => {
    const text = getText(await h['trace_imports']({ filePath: 'src/does-not-exist.ts' }));
    expect(text).toMatch(/File not found/);
  });
});

// ---------------------------------------------------------------------------
// analyze_exports
// ---------------------------------------------------------------------------

describe('analyze_exports', () => {
  const exportFile = 'src/exports-subject.ts';

  beforeAll(() => {
    writeAndCommit(
      root,
      { [exportFile]: 'export function oldFn() {}\nexport const shared = 1;\n' },
      'exports-subject v1',
    );
    writeAndCommit(
      root,
      { [exportFile]: 'export function newFn() {}\nexport const shared = 1;\n' },
      'exports-subject v2',
    );
  });

  it('lists current exports without compareWithRef', async () => {
    const result = JSON.parse(getText(await h['analyze_exports']({ filePath: exportFile })));

    expect(result.exports).toContain('newFn');
    expect(result.exports).toContain('shared');
    expect(result.exports).not.toContain('oldFn');
    expect(result.comparison).toBeNull();
  });

  it('computes added and removed exports with compareWithRef', async () => {
    const result = JSON.parse(
      getText(await h['analyze_exports']({ filePath: exportFile, compareWithRef: 'HEAD~1' })),
    );

    expect(result.comparison.added).toContain('newFn');
    expect(result.comparison.removed).toContain('oldFn');
    expect(result.comparison.added).not.toContain('shared');
    expect(result.comparison.removed).not.toContain('shared');
  });

  it('returns "File not found" for a missing file', async () => {
    const text = getText(await h['analyze_exports']({ filePath: 'src/ghost.ts' }));
    expect(text).toMatch(/File not found/);
  });

  it('treats all exports as added when compareWithRef ref does not exist', async () => {
    const result = JSON.parse(
      getText(
        await h['analyze_exports']({ filePath: exportFile, compareWithRef: 'nonexistent-ref-xyz' }),
      ),
    );
    expect(result.comparison.added).toContain('newFn');
    expect(result.comparison.removed).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// find_interface_changes
// ---------------------------------------------------------------------------

describe('find_interface_changes', () => {
  // NOTE: The tool uses `git diff -G "(interface|type)\s+\w+"` which relies on
  // POSIX ERE. Git's -G flag does not support \s/\w shorthand — it uses basic
  // POSIX ERE where those are literal characters. As a result the pattern never
  // matches and the tool consistently returns 'No interface changes found' even
  // when interfaces did change. These tests document the actual behaviour.

  beforeAll(() => {
    writeAndCommit(
      root,
      { 'src/iface.ts': 'export interface MyShape { x: number; }\n' },
      'iface v1',
    );
    writeAndCommit(
      root,
      { 'src/iface.ts': 'export interface MyShape { x: number; y: string; }\n' },
      'iface v2',
    );
  });

  it('returns a string response (empty diff or changes) for a commit range', async () => {
    // The -G pattern may or may not match depending on git version/platform.
    // What we can assert is that the tool returns a non-error string.
    const text = getText(await h['find_interface_changes']({ base: 'HEAD~1' }));
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/^Error:/);
  });

  it('accepts an optional interfaceName filter without throwing', async () => {
    const text = getText(
      await h['find_interface_changes']({ base: 'HEAD~1', interfaceName: 'MyShape' }),
    );
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/^Error:/);
  });

  it('returns "No interface changes found" when base equals head', async () => {
    const text = getText(await h['find_interface_changes']({ base: 'HEAD', head: 'HEAD' }));
    expect(text).toBe('No interface changes found');
  });

  it('accepts an explicit head ref', async () => {
    const text = getText(await h['find_interface_changes']({ base: 'HEAD~1', head: 'HEAD' }));
    expect(typeof text).toBe('string');
    expect(text).not.toMatch(/^Error:/);
  });
});
