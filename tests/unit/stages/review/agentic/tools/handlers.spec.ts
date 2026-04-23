jest.mock('node:child_process', () => ({ execSync: jest.fn() }));
jest.mock('node:fs', () => ({ existsSync: jest.fn(), readFileSync: jest.fn() }));

import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

import {
  analyzeExports,
  findInterfaceChanges,
  findUsages,
  gitDiffAnalysis,
  globFiles,
  grepFiles,
  listChangedFiles,
  readFile,
  traceImports,
} from '@/stages/review/agentic/tools/handlers';

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

const CWD = '/project/repo';

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── findUsages ───────────────────────────────────────────────────────────────

describe('findUsages', () => {
  it('returns rg output on success', () => {
    mockExecSync.mockReturnValue('src/foo.ts:5:const myFn = ' as any);
    expect(findUsages(CWD, 'myFn')).toBe('src/foo.ts:5:const myFn = ');
  });

  it('returns "No usages found" when rg exits with status 1', () => {
    mockExecSync.mockImplementation(() => {
      const e: any = new Error();
      e.status = 1;
      throw e;
    });
    expect(findUsages(CWD, 'myFn')).toBe('No usages found');
  });

  it('returns error message on other failures', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('rg not found');
    });
    expect(findUsages(CWD, 'myFn')).toBe('Error: rg not found');
  });

  it('uses scope when provided', () => {
    mockExecSync.mockReturnValue('' as any);
    findUsages(CWD, 'myFn', '/project/repo/src');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('/project/repo/src'),
      expect.anything(),
    );
  });

  it('uses custom fileType when provided', () => {
    mockExecSync.mockReturnValue('' as any);
    findUsages(CWD, 'myFn', undefined, 'js');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--type js'),
      expect.anything(),
    );
  });
});

// ─── traceImports ─────────────────────────────────────────────────────────────

describe('traceImports', () => {
  it('returns "File not found" when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(traceImports(CWD, 'src/missing.ts')).toBe('File not found: src/missing.ts');
  });

  it('returns JSON with imports and exports', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`import { foo } from './foo';\nexport const bar = 1;` as any);
    mockExecSync.mockReturnValue('' as any);
    const result = JSON.parse(traceImports(CWD, 'src/mod.ts'));
    expect(result.imports).toContain('./foo');
    expect(result.exports).toContain('bar');
  });
});

// ─── gitDiffAnalysis ──────────────────────────────────────────────────────────

describe('gitDiffAnalysis', () => {
  it('returns diff output', () => {
    mockExecSync.mockReturnValue('+ added line\n' as any);
    expect(gitDiffAnalysis(CWD, 'main')).toBe('+ added line\n');
  });

  it('returns "No differences found" on empty output', () => {
    mockExecSync.mockReturnValue('' as any);
    expect(gitDiffAnalysis(CWD, 'main')).toBe('No differences found');
  });

  it('returns error string on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repo');
    });
    expect(gitDiffAnalysis(CWD, 'main')).toBe('Error: not a git repo');
  });

  it('passes --stat flag when stat=true', () => {
    mockExecSync.mockReturnValue('1 file changed' as any);
    gitDiffAnalysis(CWD, 'main', undefined, undefined, true);
    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('--stat'), expect.anything());
  });
});

// ─── analyzeExports ───────────────────────────────────────────────────────────

describe('analyzeExports', () => {
  it('returns "File not found" when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(analyzeExports(CWD, 'src/missing.ts')).toBe('File not found: src/missing.ts');
  });

  it('returns exports JSON for existing file', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('export const foo = 1;\nexport default class Bar {}' as any);
    const result = JSON.parse(analyzeExports(CWD, 'src/mod.ts'));
    expect(result.exports).toContain('foo');
    expect(result.exports).toContain('default');
    expect(result.comparison).toBeNull();
  });

  it('includes comparison when compareWithRef is provided', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('export const foo = 1;' as any);
    mockExecSync.mockReturnValue('export const oldFn = () => {};' as any);
    const result = JSON.parse(analyzeExports(CWD, 'src/mod.ts', 'main'));
    expect(result.comparison).toBeTruthy();
    expect(result.comparison.added).toContain('foo');
    expect(result.comparison.removed).toContain('oldFn');
  });

  it('uses added=currentExports when git show fails', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('export const foo = 1;' as any);
    mockExecSync.mockImplementation(() => {
      throw new Error('git error');
    });
    const result = JSON.parse(analyzeExports(CWD, 'src/mod.ts', 'main'));
    expect(result.comparison.added).toContain('foo');
    expect(result.comparison.removed).toEqual([]);
  });
});

// ─── findInterfaceChanges ─────────────────────────────────────────────────────

describe('findInterfaceChanges', () => {
  it('returns diff output', () => {
    mockExecSync.mockReturnValue('interface Foo {}' as any);
    expect(findInterfaceChanges(CWD, 'main')).toBe('interface Foo {}');
  });

  it('returns "No interface changes found" on empty output', () => {
    mockExecSync.mockReturnValue('' as any);
    expect(findInterfaceChanges(CWD, 'main')).toBe('No interface changes found');
  });

  it('returns error string on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git error');
    });
    expect(findInterfaceChanges(CWD, 'main')).toBe('Error: git error');
  });

  it('scopes to specific interface when interfaceName is provided', () => {
    mockExecSync.mockReturnValue('interface Foo {}' as any);
    findInterfaceChanges(CWD, 'main', undefined, 'Foo');
    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('Foo'), expect.anything());
  });
});

// ─── listChangedFiles ─────────────────────────────────────────────────────────

describe('listChangedFiles', () => {
  it('returns file list output', () => {
    mockExecSync.mockReturnValue('M src/foo.ts\nA src/bar.ts\n' as any);
    expect(listChangedFiles(CWD, 'main')).toBe('M src/foo.ts\nA src/bar.ts\n');
  });

  it('returns "No changed files" on empty output', () => {
    mockExecSync.mockReturnValue('' as any);
    expect(listChangedFiles(CWD, 'main')).toBe('No changed files');
  });

  it('returns error string on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('git error');
    });
    expect(listChangedFiles(CWD, 'main')).toBe('Error: git error');
  });

  it('passes diff-filter when filter is provided', () => {
    mockExecSync.mockReturnValue('A src/new.ts\n' as any);
    listChangedFiles(CWD, 'main', undefined, 'A');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--diff-filter=A'),
      expect.anything(),
    );
  });
});

// ─── readFile ─────────────────────────────────────────────────────────────────

describe('readFile', () => {
  it('reads a file within cwd', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('file contents' as any);
    expect(readFile(CWD, 'src/foo.ts')).toBe('file contents');
  });

  it('rejects a path that resolves outside cwd via prefix exploit', () => {
    // /project/repo-evil starts with /project/repo but is a sibling dir
    const result = readFile('/project/repo', '/project/repo-evil/secret.txt');
    expect(result).toBe('Error: Path outside project directory: /project/repo-evil/secret.txt');
  });

  it('rejects path traversal via ..', () => {
    const result = readFile(CWD, '../outside.txt');
    expect(result).toBe('Error: Path outside project directory: ../outside.txt');
  });

  it('returns "File not found" when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = readFile(CWD, 'src/missing.ts');
    expect(result).toBe('File not found: src/missing.ts');
  });

  it('returns error message when readFileSync throws', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockImplementation(() => {
      throw new Error('EACCES');
    });
    expect(readFile(CWD, 'src/foo.ts')).toBe('Error reading file: EACCES');
  });
});

// ─── grepFiles ────────────────────────────────────────────────────────────────

describe('grepFiles', () => {
  it('returns matching lines', () => {
    mockExecSync.mockReturnValue('src/foo.ts:1:const x' as any);
    expect(grepFiles(CWD, 'const x')).toBe('src/foo.ts:1:const x');
  });

  it('returns "No matches found" when rg exits with status 1', () => {
    mockExecSync.mockImplementation(() => {
      const e: any = new Error();
      e.status = 1;
      throw e;
    });
    expect(grepFiles(CWD, 'nope')).toBe('No matches found');
  });

  it('returns error on other failures', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('rg error');
    });
    expect(grepFiles(CWD, 'x')).toBe('Error: rg error');
  });

  it('adds -i flag when ignoreCase is true', () => {
    mockExecSync.mockReturnValue('' as any);
    grepFiles(CWD, 'foo', undefined, true);
    expect(mockExecSync).toHaveBeenCalledWith(expect.stringContaining('-i'), expect.anything());
  });

  it('adds --glob flag when glob is provided', () => {
    mockExecSync.mockReturnValue('' as any);
    grepFiles(CWD, 'foo', '*.ts');
    expect(mockExecSync).toHaveBeenCalledWith(
      expect.stringContaining('--glob "*.ts"'),
      expect.anything(),
    );
  });
});

// ─── globFiles ────────────────────────────────────────────────────────────────

describe('globFiles', () => {
  it('returns matched file paths', () => {
    mockExecSync.mockReturnValue('/project/repo/src/foo.ts\n' as any);
    expect(globFiles(CWD, '**/*.ts')).toBe('/project/repo/src/foo.ts');
  });

  it('returns "No files found" on empty output', () => {
    mockExecSync.mockReturnValue('\n' as any);
    expect(globFiles(CWD, '**/*.xyz')).toBe('No files found');
  });

  it('returns error string on failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('find error');
    });
    expect(globFiles(CWD, '**/*.ts')).toBe('Error: find error');
  });
});
