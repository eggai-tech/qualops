import { z } from 'zod';

import { BashInput, BASH_TOOL_DESCRIPTION, startBashSession } from './bash';
import {
  readFile,
  grepFiles,
  globFiles,
  findUsages,
  traceImports,
  gitDiffAnalysis,
  analyzeExports,
  findInterfaceChanges,
  listChangedFiles,
} from './handlers';
import { logger } from '../../../../shared/utils/logger';
import type { ToolConfig } from '../adapters/agent-adapter';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodObject<z.ZodRawShape>;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface ToolSet {
  tools: ToolDefinition[];
  dispose: () => Promise<void>;
}

export async function createToolSet(cwd: string, toolConfig: ToolConfig): Promise<ToolSet> {
  let dispose: () => Promise<void> = async () => {};
  const tools: ToolDefinition[] = [];

  try {
    const { session, dispose: bashDispose } = await startBashSession(
      toolConfig.bash,
      'AgenticTools',
    );
    dispose = bashDispose;
    tools.push({
      name: 'bash',
      description: BASH_TOOL_DESCRIPTION,
      schema: BashInput,
      execute: async (args) => {
        const output = await session.exec(args as z.infer<typeof BashInput>);
        return JSON.stringify(output);
      },
    });
  } catch (err) {
    logger.warn('[AgenticTools] Failed to start BashSession — bash tool unavailable', { err });
  }

  tools.push(
    {
      name: 'read_file',
      description: 'Read the full contents of a file',
      schema: z.object({
        filePath: z.string().describe('Path to the file (relative to cwd or absolute)'),
      }),
      execute: async ({ filePath }) => readFile(cwd, filePath as string, toolConfig.skipPatterns),
    },

    {
      name: 'grep_files',
      description: 'Search files for a regex pattern using ripgrep',
      schema: z.object({
        pattern: z.string().describe('Regex pattern to search for'),
        glob: z
          .string()
          .nullable()
          .default(null)
          .describe('Glob pattern to filter files (e.g. "*.ts"), or null'),
        ignoreCase: z
          .boolean()
          .nullable()
          .default(null)
          .describe('Case-insensitive search, or null'),
      }),
      execute: async ({ pattern, glob, ignoreCase }) =>
        grepFiles(
          cwd,
          pattern as string,
          (glob as string | null) ?? undefined,
          (ignoreCase as boolean | null) ?? undefined,
          toolConfig.skipPatterns,
        ),
    },

    {
      name: 'glob_files',
      description: 'Find files matching a glob pattern',
      schema: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
      }),
      execute: async ({ pattern }) => globFiles(cwd, pattern as string, toolConfig.skipPatterns),
    },

    {
      name: 'find_usages',
      description:
        'Find all usages of a symbol (function, class, variable, type) across the codebase using ripgrep',
      schema: z.object({
        symbol: z.string().describe('The symbol name to search for (exact word match)'),
        scope: z.string().optional().describe('Limit search to this directory path'),
        fileType: z.string().optional().describe('File type filter (e.g., ts, js, tsx)'),
      }),
      execute: async ({ symbol, scope, fileType }) =>
        findUsages(
          cwd,
          symbol as string,
          scope as string | undefined,
          fileType as string | undefined,
        ),
    },

    {
      name: 'trace_imports',
      description:
        'Trace import/export dependencies for a TypeScript file. Returns what the file imports and which files import it.',
      schema: z.object({
        filePath: z.string().describe('Path to the file to analyze (relative to cwd)'),
      }),
      execute: async ({ filePath }) => traceImports(cwd, filePath as string),
    },

    {
      name: 'git_diff_analysis',
      description:
        'Get detailed git diff for a commit range or specific file. Shows added/removed/modified lines.',
      schema: z.object({
        base: z.string().describe('Base commit or branch (e.g., main, HEAD~1)'),
        head: z.string().optional().describe('Head commit or branch (defaults to HEAD)'),
        file: z.string().optional().describe('Specific file to diff'),
        stat: z.boolean().optional().describe('Show diff stats only'),
      }),
      execute: async ({ base, head, file, stat }) =>
        gitDiffAnalysis(
          cwd,
          base as string,
          head as string | undefined,
          file as string | undefined,
          stat as boolean | undefined,
        ),
    },

    {
      name: 'analyze_exports',
      description:
        'Analyze public exports from a TypeScript file and optionally compare with a previous version to detect breaking changes.',
      schema: z.object({
        filePath: z.string().describe('Path to the file to analyze'),
        compareWithRef: z
          .string()
          .optional()
          .describe('Git ref to compare with (e.g., main, HEAD~1)'),
      }),
      execute: async ({ filePath, compareWithRef }) =>
        analyzeExports(cwd, filePath as string, compareWithRef as string | undefined),
    },

    {
      name: 'find_interface_changes',
      description: 'Find changes to TypeScript interfaces or types between two git refs',
      schema: z.object({
        base: z.string().describe('Base git ref'),
        head: z.string().optional().describe('Head git ref (defaults to HEAD)'),
        interfaceName: z.string().optional().describe('Specific interface to check'),
      }),
      execute: async ({ base, head, interfaceName }) =>
        findInterfaceChanges(
          cwd,
          base as string,
          head as string | undefined,
          interfaceName as string | undefined,
        ),
    },

    {
      name: 'list_changed_files',
      description:
        'List all files changed between two git refs with change type (added/modified/deleted)',
      schema: z.object({
        base: z.string().describe('Base git ref'),
        head: z.string().optional().describe('Head git ref (defaults to HEAD)'),
        filter: z.string().optional().describe('Filter by status: A=added, M=modified, D=deleted'),
      }),
      execute: async ({ base, head, filter }) =>
        listChangedFiles(
          cwd,
          base as string,
          head as string | undefined,
          filter as string | undefined,
        ),
    },
  );

  return { tools, dispose };
}
