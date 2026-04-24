import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { DependencyTrace, ExportComparison } from '../types';

// ─── Safe command execution ────────────────────────────────────────────────────

/**
 * Runs a command without a shell, passing args as an array to avoid injection.
 * Returns stdout on success, or throws with the stderr/status attached.
 */
function runSafe(cmd: string, args: string[], cwd: string, maxBuffer = 10 * 1024 * 1024): string {
  const result = spawnSync(cmd, args, {
    encoding: 'utf-8',
    cwd,
    maxBuffer,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const err = new Error(result.stderr?.trim() || `Command exited with status ${result.status}`);
    (err as NodeJS.ErrnoException & { status?: number }).status = result.status ?? undefined;
    throw err;
  }
  return result.stdout;
}

// ─── Custom tools ─────────────────────────────────────────────────────────────

export function findUsages(cwd: string, symbol: string, scope?: string, fileType?: string): string {
  const searchPath = scope || cwd;
  const typeArgs = fileType ? ['--type', fileType] : ['--type', 'ts', '--type', 'tsx'];

  try {
    return (
      runSafe('rg', ['-n', '--word-regexp', symbol, searchPath, ...typeArgs], cwd) ||
      'No usages found'
    );
  } catch (error) {
    const execError = error as { status?: number; message?: string };
    if (execError.status === 1) return 'No usages found';
    return `Error: ${execError.message || 'Unknown error'}`;
  }
}

export function traceImports(cwd: string, filePath: string): string {
  const fullPath = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;

  if (!existsSync(fullPath)) {
    return `File not found: ${filePath}`;
  }

  const content = readFileSync(fullPath, 'utf-8');
  const imports = extractImports(content);
  const exports = extractExports(content);
  const importedBy = findImportingFiles(filePath, cwd);

  const result: DependencyTrace = { filePath, imports, importedBy, exports };
  return JSON.stringify(result, null, 2);
}

export function gitDiffAnalysis(
  cwd: string,
  base: string,
  head?: string,
  file?: string,
  stat?: boolean,
): string {
  const headRef = head || 'HEAD';

  const args = ['diff'];
  if (stat) args.push('--stat');
  args.push(`${base}...${headRef}`);
  if (file) args.push('--', file);

  try {
    return runSafe('git', args, cwd) || 'No differences found';
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export function analyzeExports(cwd: string, filePath: string, compareWithRef?: string): string {
  const fullPath = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;

  if (!existsSync(fullPath)) {
    return `File not found: ${filePath}`;
  }

  const currentContent = readFileSync(fullPath, 'utf-8');
  const currentExports = extractExports(currentContent);

  let comparison: ExportComparison | null = null;

  if (compareWithRef) {
    try {
      const oldContent = runSafe('git', ['show', `${compareWithRef}:${filePath}`], cwd);
      const oldExports = extractExports(oldContent);
      comparison = compareExportSets(oldExports, currentExports);
    } catch {
      comparison = { added: currentExports, removed: [], modified: [] };
    }
  }

  return JSON.stringify({ filePath, exports: currentExports, comparison }, null, 2);
}

export function findInterfaceChanges(
  cwd: string,
  base: string,
  head?: string,
  interfaceName?: string,
): string {
  const headRef = head || 'HEAD';
  const grepPattern = interfaceName
    ? `(interface|type)\\s+${interfaceName}`
    : '(interface|type)\\s+\\w+';

  try {
    return (
      runSafe(
        'git',
        ['diff', `${base}...${headRef}`, '--unified=5', `-G${grepPattern}`, '--', '*.ts', '*.tsx'],
        cwd,
      ) || 'No interface changes found'
    );
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

export function listChangedFiles(
  cwd: string,
  base: string,
  head?: string,
  filter?: string,
): string {
  const headRef = head || 'HEAD';
  const args = ['diff', '--name-status'];
  if (filter) args.push(`--diff-filter=${filter}`);
  args.push(`${base}...${headRef}`);

  try {
    return runSafe('git', args, cwd) || 'No changed files';
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

// ─── Filesystem tools (for OpenAI adapter — Anthropic SDK provides these built-in) ──

export function readFile(cwd: string, filePath: string): string {
  const fullPath = filePath.startsWith('/') ? filePath : join(cwd, filePath);
  const resolved = resolve(fullPath);

  const cwdPrefix = cwd.endsWith('/') ? cwd : cwd + '/';
  if (resolved !== cwd && !resolved.startsWith(cwdPrefix)) {
    return `Error: Path outside project directory: ${filePath}`;
  }

  if (!existsSync(resolved)) {
    return `File not found: ${filePath}`;
  }

  try {
    return readFileSync(resolved, 'utf-8');
  } catch (error) {
    return `Error reading file: ${(error as Error).message}`;
  }
}

export function grepFiles(
  cwd: string,
  pattern: string,
  glob?: string,
  ignoreCase?: boolean,
): string {
  const args = ['-n'];
  if (ignoreCase) args.push('-i');
  if (glob) args.push('--glob', glob);
  args.push(pattern, cwd);

  try {
    return runSafe('rg', args, cwd) || 'No matches found';
  } catch (error) {
    const execError = error as { status?: number; message?: string };
    if (execError.status === 1) return 'No matches found';
    return `Error: ${execError.message || 'Unknown error'}`;
  }
}

export function globFiles(cwd: string, pattern: string): string {
  try {
    const result = runSafe(
      'find',
      [cwd, '-path', pattern, '-not', '-path', '*/node_modules/*'],
      cwd,
    );
    return result.trim() || 'No files found';
  } catch (error) {
    return `Error: ${(error as Error).message}`;
  }
}

// ─── Private helpers ──────────────────────────────────────────────────────────

function extractImports(content: string): string[] {
  const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)\s+from\s+)?['"]([^'"]+)['"]/g;
  const imports: string[] = [];
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  return imports;
}

function extractExports(content: string): string[] {
  const exports: string[] = [];

  const namedExportRegex = /export\s*\{([^}]+)\}/g;
  let match;
  while ((match = namedExportRegex.exec(content)) !== null) {
    const names = match[1].split(',').map((n) =>
      n
        .trim()
        .split(/\s+as\s+/)[0]
        .trim(),
    );
    exports.push(...names);
  }

  const directExportRegex =
    /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  while ((match = directExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  if (/export\s+default/.test(content)) {
    exports.push('default');
  }

  return [...new Set(exports)];
}

function findImportingFiles(targetPath: string, cwd: string): string[] {
  const fileName =
    targetPath
      .split('/')
      .pop()
      ?.replace(/\.[^.]+$/, '') || '';

  try {
    const result = spawnSync('rg', ['-l', fileName, '--type', 'ts', cwd], {
      encoding: 'utf-8',
      cwd,
    });
    if (result.error) return [];
    // exit code 1 = no matches (not an error)
    if (result.status !== 0 && result.status !== 1) return [];
    return (result.stdout ?? '')
      .trim()
      .split('\n')
      .filter((f) => f && f !== targetPath);
  } catch {
    return [];
  }
}

function compareExportSets(oldExports: string[], newExports: string[]): ExportComparison {
  const oldSet = new Set(oldExports);
  const newSet = new Set(newExports);

  return {
    added: newExports.filter((e) => !oldSet.has(e)),
    removed: oldExports.filter((e) => !newSet.has(e)),
    modified: [],
  };
}
