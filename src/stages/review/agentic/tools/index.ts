import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { BashInput, BASH_TOOL_DESCRIPTION, startBashSession } from './bash';
import {
  findUsages,
  traceImports,
  gitDiffAnalysis,
  analyzeExports,
  findInterfaceChanges,
  listChangedFiles,
} from './handlers';
import { logger } from '../../../../shared/utils/logger';
import type { ToolConfig } from '../adapters/agent-adapter';

export async function createAgenticTools(
  cwd: string,
  toolConfig: ToolConfig,
): Promise<{ server: ReturnType<typeof createSdkMcpServer>; dispose: () => Promise<void> }> {
  let bashDispose: () => Promise<void> = async () => {};
  const bashTools: ReturnType<typeof tool>[] = [];

  try {
    const { session, dispose } = await startBashSession(toolConfig.bash, 'AgenticTools');
    bashDispose = dispose;
    bashTools.push(
      tool(
        'bash',
        BASH_TOOL_DESCRIPTION,
        {
          command: BashInput.shape.command,
          description: BashInput.shape.description,
          purpose: BashInput.shape.purpose,
          timeout_ms: BashInput.shape.timeout_ms,
        },
        async (args) => {
          const output = await session.exec(args);
          return { content: [{ type: 'text', text: JSON.stringify(output) }] };
        },
      ),
    );
  } catch (err) {
    logger.warn('[AgenticTools] Failed to start BashSession — bash tool unavailable', { err });
  }

  const server = createSdkMcpServer({
    name: 'qualops-agentic-tools',
    version: '1.0.0',
    tools: [
      ...bashTools,
      tool(
        'find_usages',
        'Find all usages of a symbol (function, class, variable, type) across the codebase using ripgrep',
        {
          symbol: z.string().describe('The symbol name to search for (exact word match)'),
          scope: z.string().optional().describe('Limit search to this directory path'),
          fileType: z.string().optional().describe('File type filter (e.g., ts, js, tsx)'),
        },
        async ({ symbol, scope, fileType }) => ({
          content: [{ type: 'text', text: findUsages(cwd, symbol, scope, fileType) }],
        }),
      ),

      tool(
        'trace_imports',
        'Trace import/export dependencies for a TypeScript file. Returns what the file imports and which files import it.',
        {
          filePath: z.string().describe('Path to the file to analyze (relative to cwd)'),
        },
        async ({ filePath }) => ({
          content: [{ type: 'text', text: traceImports(cwd, filePath) }],
        }),
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
        async ({ base, head, file, stat }) => ({
          content: [{ type: 'text', text: gitDiffAnalysis(cwd, base, head, file, stat) }],
        }),
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
        async ({ filePath, compareWithRef }) => ({
          content: [{ type: 'text', text: analyzeExports(cwd, filePath, compareWithRef) }],
        }),
      ),

      tool(
        'find_interface_changes',
        'Find changes to TypeScript interfaces or types between two git refs',
        {
          base: z.string().describe('Base git ref'),
          head: z.string().optional().describe('Head git ref (defaults to HEAD)'),
          interfaceName: z.string().optional().describe('Specific interface to check'),
        },
        async ({ base, head, interfaceName }) => ({
          content: [{ type: 'text', text: findInterfaceChanges(cwd, base, head, interfaceName) }],
        }),
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
        async ({ base, head, filter }) => ({
          content: [{ type: 'text', text: listChangedFiles(cwd, base, head, filter) }],
        }),
      ),
    ],
  });

  return { server, dispose: bashDispose };
}
