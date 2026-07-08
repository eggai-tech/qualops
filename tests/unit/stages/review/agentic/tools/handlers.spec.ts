jest.mock('node:child_process', () => ({ spawnSync: jest.fn() }));
jest.mock('node:fs', () => ({ existsSync: jest.fn(), readFileSync: jest.fn() }));
jest.mock('glob', () => ({ glob: jest.fn() }));

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

const mockGlob = jest.requireMock<{ glob: jest.Mock }>('glob').glob;

import {
  findUsages,
  gitDiffAnalysis,
  globFiles,
  grepFiles,
  listChangedFiles,
  readFile,
  traceImports,
} from '@/stages/review/agentic/tools/handlers';

const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

const CWD = '/project/repo';

function spawnOk(stdout: string) {
  return { stdout, stderr: '', status: 0, error: undefined, pid: 0, output: [], signal: null };
}

function spawnFail(stderr: string, status = 2) {
  return { stdout: '', stderr, status, error: undefined, pid: 0, output: [], signal: null };
}

function spawnError(message: string) {
  return {
    stdout: '',
    stderr: '',
    status: null,
    error: new Error(message),
    pid: 0,
    output: [],
    signal: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ─── findUsages ───────────────────────────────────────────────────────────────

describe('findUsages', () => {
  it('returns rg output on success', () => {
    mockSpawnSync.mockReturnValue(spawnOk('src/foo.ts:5:const myFn = ') as any);
    expect(findUsages(CWD, 'myFn')).toBe('src/foo.ts:5:const myFn = ');
  });

  it('returns "No usages found" when rg exits with status 1', () => {
    mockSpawnSync.mockReturnValue(spawnFail('', 1) as any);
    expect(findUsages(CWD, 'myFn')).toBe('No usages found');
  });

  it('returns error message on other failures', () => {
    mockSpawnSync.mockReturnValue(spawnError('rg not found') as any);
    expect(findUsages(CWD, 'myFn')).toMatch(/rg not found/);
  });

  it('uses scope when provided', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    findUsages(CWD, 'myFn', '/project/repo/src');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'rg',
      expect.arrayContaining(['/project/repo/src']),
      expect.anything(),
    );
  });

  it('rejects scope path outside cwd', () => {
    const result = findUsages(CWD, 'myFn', '/etc/passwd');
    expect(result).toMatch(/outside project directory/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('rejects scope path with traversal', () => {
    const result = findUsages(CWD, 'myFn', '../../etc');
    expect(result).toMatch(/outside project directory/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('uses custom fileType when provided', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    findUsages(CWD, 'myFn', undefined, 'js');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'rg',
      expect.arrayContaining(['--type', 'js']),
      expect.anything(),
    );
  });

  it('appends --glob exclusions for each skipPattern', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    findUsages(CWD, 'myFn', undefined, undefined, ['node_modules/**', 'dist/**']);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'rg',
      expect.arrayContaining(['--glob', '!node_modules/**', '--glob', '!dist/**']),
      expect.anything(),
    );
  });
});

// ─── traceImports ─────────────────────────────────────────────────────────────

describe('traceImports', () => {
  it('rejects path traversal outside cwd', () => {
    const result = traceImports(CWD, '../../etc/passwd');
    expect(result).toMatch(/outside project directory/);
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('rejects absolute path outside cwd', () => {
    const result = traceImports(CWD, '/etc/passwd');
    expect(result).toMatch(/outside project directory/);
  });

  it('returns "File not found" when file does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    expect(traceImports(CWD, 'src/missing.ts')).toBe('File not found: src/missing.ts');
  });

  it('returns JSON with imports and exports', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(`import { foo } from './foo';\nexport const bar = 1;` as any);
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    const result = JSON.parse(traceImports(CWD, 'src/mod.ts'));
    expect(result.imports).toContain('./foo');
    expect(result.exports).toContain('bar');
  });

  it('returns "File excluded" when file matches a skipPattern', () => {
    const result = traceImports(CWD, 'src/foo.spec.ts', ['**/*.spec.ts']);
    expect(result).toBe('File excluded: matches skip pattern.');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });

  it('blocks skipPattern bypass via path traversal (src/../node_modules/secret.js)', () => {
    const result = traceImports(CWD, 'src/../node_modules/secret.js', ['node_modules/**']);
    expect(result).toBe('File excluded: matches skip pattern.');
    expect(mockExistsSync).not.toHaveBeenCalled();
  });
});

// ─── gitDiffAnalysis ──────────────────────────────────────────────────────────

describe('gitDiffAnalysis', () => {
  it('rejects base ref starting with -', () => {
    const result = gitDiffAnalysis(CWD, '--upload-pack=evil');
    expect(result).toMatch(/invalid git ref/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('rejects head ref starting with -', () => {
    const result = gitDiffAnalysis(CWD, 'main', '--evil');
    expect(result).toMatch(/invalid git ref/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('returns diff output', () => {
    mockSpawnSync.mockReturnValue(spawnOk('+ added line\n') as any);
    expect(gitDiffAnalysis(CWD, 'main')).toBe('+ added line\n');
  });

  it('returns "No differences found" on empty output', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    expect(gitDiffAnalysis(CWD, 'main')).toBe('No differences found');
  });

  it('returns error string on failure', () => {
    mockSpawnSync.mockReturnValue(spawnFail('not a git repo') as any);
    expect(gitDiffAnalysis(CWD, 'main')).toBe('Error: not a git repo');
  });

  it('passes --stat flag when stat=true', () => {
    mockSpawnSync.mockReturnValue(spawnOk('1 file changed') as any);
    gitDiffAnalysis(CWD, 'main', undefined, undefined, true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['--stat']),
      expect.anything(),
    );
  });

  it('returns "File excluded" when file matches a skipPattern', () => {
    const result = gitDiffAnalysis(CWD, 'main', undefined, 'src/foo.spec.ts', undefined, [
      '**/*.spec.ts',
    ]);
    expect(result).toBe('File excluded: matches skip pattern.');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('blocks skipPattern bypass via path traversal in file param', () => {
    const result = gitDiffAnalysis(
      CWD,
      'main',
      undefined,
      'src/../node_modules/secret.js',
      undefined,
      ['node_modules/**'],
    );
    expect(result).toBe('File excluded: matches skip pattern.');
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});

// ─── listChangedFiles ─────────────────────────────────────────────────────────

describe('listChangedFiles', () => {
  it('rejects base ref starting with -', () => {
    const result = listChangedFiles(CWD, '--evil');
    expect(result).toMatch(/invalid git ref/);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it('returns file list output', () => {
    mockSpawnSync.mockReturnValue(spawnOk('M src/foo.ts\nA src/bar.ts\n') as any);
    expect(listChangedFiles(CWD, 'main')).toBe('M src/foo.ts\nA src/bar.ts\n');
  });

  it('returns "No changed files" on empty output', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    expect(listChangedFiles(CWD, 'main')).toBe('No changed files');
  });

  it('returns error string on failure', () => {
    mockSpawnSync.mockReturnValue(spawnFail('git error') as any);
    expect(listChangedFiles(CWD, 'main')).toBe('Error: git error');
  });

  it('passes diff-filter when filter is provided', () => {
    mockSpawnSync.mockReturnValue(spawnOk('A src/new.ts\n') as any);
    listChangedFiles(CWD, 'main', undefined, 'A');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['--diff-filter=A']),
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

  it('returns "File excluded" when file matches a skipPattern', () => {
    const result = readFile(CWD, 'src/foo.spec.ts', ['**/*.spec.ts']);
    expect(result).toBe('File excluded: matches skip pattern.');
  });

  it('blocks skipPattern bypass via ./ prefix (src/../node_modules/secret.js)', () => {
    const result = readFile(CWD, 'src/../node_modules/secret.js', ['node_modules/**']);
    expect(result).toBe('File excluded: matches skip pattern.');
  });

  it('blocks skipPattern bypass via ./ prefix (./node_modules/secret.js)', () => {
    const result = readFile(CWD, './node_modules/secret.js', ['node_modules/**']);
    expect(result).toBe('File excluded: matches skip pattern.');
  });

  it('does not exclude cwd itself (resolvedPath === cwd edge case)', () => {
    // Passing the cwd as the file path resolves to exactly cwd — isSkipped should
    // return '.' as the relative path and not match a file-targeting pattern.
    mockExistsSync.mockReturnValue(false);
    const result = readFile(CWD, CWD, ['**/*.ts']);
    expect(result).not.toBe('File excluded: matches skip pattern.');
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
    mockSpawnSync.mockReturnValue(spawnOk('src/foo.ts:1:const x') as any);
    expect(grepFiles(CWD, 'const x')).toBe('src/foo.ts:1:const x');
  });

  it('returns "No matches found" when rg exits with status 1', () => {
    mockSpawnSync.mockReturnValue(spawnFail('', 1) as any);
    expect(grepFiles(CWD, 'nope')).toBe('No matches found');
  });

  it('returns error on other failures', () => {
    mockSpawnSync.mockReturnValue(spawnError('rg error') as any);
    expect(grepFiles(CWD, 'x')).toMatch(/rg error/);
  });

  it('adds -i flag when ignoreCase is true', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    grepFiles(CWD, 'foo', undefined, true);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'rg',
      expect.arrayContaining(['-i']),
      expect.anything(),
    );
  });

  it('adds --glob flag when glob is provided', () => {
    mockSpawnSync.mockReturnValue(spawnOk('') as any);
    grepFiles(CWD, 'foo', '*.ts');
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'rg',
      expect.arrayContaining(['--glob', '*.ts']),
      expect.anything(),
    );
  });
});

// ─── globFiles ────────────────────────────────────────────────────────────────

describe('globFiles', () => {
  it('returns matched file paths', async () => {
    mockGlob.mockResolvedValue(['src/foo.ts', 'src/bar.ts'] as any);
    expect(await globFiles(CWD, '**/*.ts')).toBe('src/foo.ts\nsrc/bar.ts');
  });

  it('returns "No files found" on empty output', async () => {
    mockGlob.mockResolvedValue([] as any);
    expect(await globFiles(CWD, '**/*.xyz')).toBe('No files found');
  });

  it('returns error string on failure', async () => {
    mockGlob.mockRejectedValue(new Error('glob error'));
    expect(await globFiles(CWD, '**/*.ts')).toBe('Error: glob error');
  });

  it('passes skipPatterns as ignore option', async () => {
    mockGlob.mockResolvedValue(['src/app.ts'] as any);
    await globFiles(CWD, '**/*.ts', ['node_modules/**', 'dist/**']);
    expect(mockGlob).toHaveBeenCalledWith('**/*.ts', {
      cwd: CWD,
      dot: true,
      ignore: ['node_modules/**', 'dist/**'],
    });
  });
});
