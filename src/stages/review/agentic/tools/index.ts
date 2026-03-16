import { execSync } from 'node:child_process';

import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

export function createAgenticTools(cwd: string) {
  return createSdkMcpServer({
    name: 'qualops-agentic-tools',
    version: '1.0.0',
    tools: [
      tool(
        'git_diff',
        'Get git diff for a commit range or specific file. Shows added/removed/modified lines.',
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
        'git_show',
        'Show a file at a specific git ref. Useful for comparing current vs previous versions.',
        {
          ref: z.string().describe('Git ref (e.g., main, HEAD~1, abc123)'),
          file: z.string().describe('File path relative to repo root'),
        },
        async ({ ref, file }) => {
          try {
            const content = execSync(`git show ${ref}:${file}`, {
              encoding: 'utf-8',
              cwd,
              maxBuffer: 10 * 1024 * 1024,
            });
            return { content: [{ type: 'text', text: content }] };
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
