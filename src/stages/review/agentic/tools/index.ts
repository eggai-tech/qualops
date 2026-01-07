import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import type { DependencyTrace, ExportComparison } from '../types';

export function createAgenticTools(cwd: string) {
  return createSdkMcpServer({
    name: 'qualops-agentic-tools',
    version: '1.0.0',
    tools: [
      tool(
        'find_usages',
        'Find all usages of a symbol (function, class, variable, type) across the codebase using ripgrep',
        {
          symbol: z.string().describe('The symbol name to search for (exact word match)'),
          scope: z.string().optional().describe('Limit search to this directory path'),
          fileType: z.string().optional().describe('File type filter (e.g., ts, js, tsx)'),
        },
        async ({ symbol, scope, fileType }) => {
          const searchPath = scope || cwd;
          const typeArg = fileType ? `--type ${fileType}` : '--type ts --type tsx';

          try {
            const result = execSync(`rg -n --word-regexp "${symbol}" ${searchPath} ${typeArg}`, {
              encoding: 'utf-8',
              cwd,
              maxBuffer: 10 * 1024 * 1024,
            });
            return { content: [{ type: 'text', text: result || 'No usages found' }] };
          } catch (error) {
            const execError = error as { status?: number; message?: string };
            if (execError.status === 1) {
              return { content: [{ type: 'text', text: 'No usages found' }] };
            }
            return {
              content: [{ type: 'text', text: `Error: ${execError.message || 'Unknown error'}` }],
            };
          }
        },
      ),

      tool(
        'trace_imports',
        'Trace import/export dependencies for a TypeScript file. Returns what the file imports and which files import it.',
        {
          filePath: z.string().describe('Path to the file to analyze (relative to cwd)'),
        },
        async ({ filePath }) => {
          const fullPath = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;

          if (!existsSync(fullPath)) {
            return { content: [{ type: 'text', text: `File not found: ${filePath}` }] };
          }

          const content = readFileSync(fullPath, 'utf-8');
          const imports = extractImports(content);
          const exports = extractExports(content);
          const importedBy = findImportingFiles(filePath, cwd);

          const result: DependencyTrace = {
            filePath,
            imports,
            importedBy,
            exports,
          };

          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        },
      ),

      tool(
        'git_diff_analysis',
        'Get detailed git diff for a commit range or specific file. Shows added/removed/modified lines.',
        {
          base: z.string().describe('Base commit or branch (e.g., main, HEAD~1)'),
          head: z.string().optional().describe('Head commit or branch (defaults to HEAD)'),
          file: z.string().optional().describe('Specific file to diff'),
          stat: z.boolean().optional().describe('Show diff stats only'),
        },
        async ({ base, head, file, stat }) => {
          const headRef = head || 'HEAD';
          const fileArg = file ? `-- ${file}` : '';
          const statArg = stat ? '--stat' : '';

          try {
            const diff = execSync(`git diff ${statArg} ${base}...${headRef} ${fileArg}`, {
              encoding: 'utf-8',
              cwd,
              maxBuffer: 10 * 1024 * 1024,
            });
            return { content: [{ type: 'text', text: diff || 'No differences found' }] };
          } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
          }
        },
      ),

      tool(
        'analyze_exports',
        'Analyze public exports from a TypeScript file and optionally compare with a previous version to detect breaking changes.',
        {
          filePath: z.string().describe('Path to the file to analyze'),
          compareWithRef: z
            .string()
            .optional()
            .describe('Git ref to compare with (e.g., main, HEAD~1)'),
        },
        async ({ filePath, compareWithRef }) => {
          const fullPath = filePath.startsWith('/') ? filePath : `${cwd}/${filePath}`;

          if (!existsSync(fullPath)) {
            return { content: [{ type: 'text', text: `File not found: ${filePath}` }] };
          }

          const currentContent = readFileSync(fullPath, 'utf-8');
          const currentExports = extractExports(currentContent);

          let comparison: ExportComparison | null = null;

          if (compareWithRef) {
            try {
              const oldContent = execSync(`git show ${compareWithRef}:${filePath}`, {
                encoding: 'utf-8',
                cwd,
              });
              const oldExports = extractExports(oldContent);
              comparison = compareExports(oldExports, currentExports);
            } catch {
              comparison = { added: currentExports, removed: [], modified: [] };
            }
          }

          const result = {
            filePath,
            exports: currentExports,
            comparison,
          };

          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        },
      ),

      tool(
        'find_interface_changes',
        'Find changes to TypeScript interfaces or types between two git refs',
        {
          base: z.string().describe('Base git ref'),
          head: z.string().optional().describe('Head git ref (defaults to HEAD)'),
          interfaceName: z.string().optional().describe('Specific interface to check'),
        },
        async ({ base, head, interfaceName }) => {
          const headRef = head || 'HEAD';
          const grepPattern = interfaceName
            ? `"(interface|type)\\s+${interfaceName}"`
            : '"(interface|type)\\s+\\w+"';

          try {
            const diff = execSync(
              `git diff ${base}...${headRef} --unified=5 -G ${grepPattern} -- "*.ts" "*.tsx"`,
              { encoding: 'utf-8', cwd, maxBuffer: 10 * 1024 * 1024 },
            );
            return { content: [{ type: 'text', text: diff || 'No interface changes found' }] };
          } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
          }
        },
      ),

      tool(
        'list_changed_files',
        'List all files changed between two git refs with change type (added/modified/deleted)',
        {
          base: z.string().describe('Base git ref'),
          head: z.string().optional().describe('Head git ref (defaults to HEAD)'),
          filter: z
            .string()
            .optional()
            .describe('Filter by status: A=added, M=modified, D=deleted'),
        },
        async ({ base, head, filter }) => {
          const headRef = head || 'HEAD';
          const filterArg = filter ? `--diff-filter=${filter}` : '';

          try {
            const files = execSync(`git diff --name-status ${filterArg} ${base}...${headRef}`, {
              encoding: 'utf-8',
              cwd,
            });
            return { content: [{ type: 'text', text: files || 'No changed files' }] };
          } catch (error) {
            return { content: [{ type: 'text', text: `Error: ${(error as Error).message}` }] };
          }
        },
      ),
    ],
  });
}

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

  // Named exports: export { name } or export { name as alias }
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

  // Direct exports: export const/let/var/function/class/interface/type
  const directExportRegex =
    /export\s+(?:const|let|var|function|class|interface|type|enum)\s+(\w+)/g;
  while ((match = directExportRegex.exec(content)) !== null) {
    exports.push(match[1]);
  }

  // Default export
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
  const _dirPath = targetPath.replace(/\/[^/]+$/, '');

  try {
    const result = execSync(
      `rg -l "from\\s+['\"].*${fileName}['\"]" --type ts --type tsx ${cwd} 2>/dev/null || true`,
      { encoding: 'utf-8', cwd },
    );
    return result
      .trim()
      .split('\n')
      .filter((f) => f && f !== targetPath);
  } catch {
    return [];
  }
}

function compareExports(oldExports: string[], newExports: string[]): ExportComparison {
  const oldSet = new Set(oldExports);
  const newSet = new Set(newExports);

  return {
    added: newExports.filter((e) => !oldSet.has(e)),
    removed: oldExports.filter((e) => !newSet.has(e)),
    modified: [], // Would need AST analysis for signature changes
  };
}
