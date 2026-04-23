import { Agent, getGlobalTraceProvider, run, setDefaultOpenAIClient, tool } from '@openai/agents';
import { z } from 'zod';

import type { AgentAdapter, AgentAdapterParams, AgentAdapterResult } from './agent-adapter';
import { envConfig } from '../../../../config/env';
import { logger } from '../../../../shared/utils/logger';
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
} from '../tools/handlers';

export class OpenAIAdapter implements AgentAdapter {
  async run(params: AgentAdapterParams): Promise<AgentAdapterResult> {
    const { systemPrompt, userPrompt, agents, model, cwd, maxTurns, onToolCall } = params;

    await configureOpenAIClient();
    getGlobalTraceProvider().setDisabled(true);

    const tools = buildOpenAITools(cwd, onToolCall);

    const handoffs = Object.entries(agents).map(([name, def]) => {
      const agentTools = def.tools ? tools.filter((t) => def.tools!.includes(t.name)) : tools;
      return new Agent({
        name,
        model: def.model ?? model,
        instructions: def.prompt,
        tools: agentTools,
      });
    });

    const orchestrator = new Agent({
      name: 'qualops-reviewer',
      model,
      instructions: systemPrompt,
      tools,
      handoffs,
    });

    logger.info(`[Agentic/OpenAI] Starting run with model=${model}, maxTurns=${maxTurns}`);

    const result = await run(orchestrator, userPrompt, { maxTurns });

    const output =
      typeof result.finalOutput === 'string'
        ? result.finalOutput
        : result.finalOutput != null
          ? JSON.stringify(result.finalOutput)
          : '';

    const usage = result.state.usage;

    logger.info(
      `[Agentic/OpenAI] Run complete. inputTokens=${usage.inputTokens}, outputTokens=${usage.outputTokens}`,
    );

    return {
      output,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    };
  }
}

async function configureOpenAIClient(): Promise<void> {
  const apiKey = envConfig.get('openaiApiKey') || '';
  const baseURL = envConfig.get('openaiApiBase');

  const { default: OpenAI, AzureOpenAI } = await import('openai');

  // Azure URLs follow the pattern: https://{resource}.openai.azure.com/openai/deployments/{deployment}
  // When detected, use AzureOpenAI with baseURL set to the resource root so that api-version
  // is injected automatically. We pass baseURL explicitly to avoid conflicts with OPENAI_BASE_URL.
  const azureMatch = baseURL?.match(
    /^(https:\/\/[^/]+\.openai\.azure\.com)(\/openai\/deployments\/[^/?]+)?/,
  );
  if (azureMatch) {
    const azureBaseURL = `${azureMatch[1]}/openai`;
    setDefaultOpenAIClient(
      new AzureOpenAI({ apiKey, baseURL: azureBaseURL, apiVersion: '2025-03-01-preview' }),
    );
  } else {
    setDefaultOpenAIClient(new OpenAI({ apiKey, baseURL }));
  }
}

function buildOpenAITools(cwd: string, onToolCall?: AgentAdapterParams['onToolCall']) {
  let turnIndex = 0;

  function trackCall(name: string, input: unknown) {
    turnIndex++;
    logger.info(`[Agentic/OpenAI] Tool call: ${name}`);
    onToolCall?.(turnIndex, name, input);
  }

  return [
    tool({
      name: 'read_file',
      description: 'Read the full contents of a file',
      parameters: z.object({
        filePath: z.string().describe('Path to the file (relative to cwd or absolute)'),
      }),
      execute: async ({ filePath }) => {
        trackCall('read_file', { filePath });
        return readFile(cwd, filePath);
      },
    }),

    tool({
      name: 'grep_files',
      description: 'Search files for a regex pattern using ripgrep',
      parameters: z.object({
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
      execute: async ({ pattern, glob, ignoreCase }) => {
        trackCall('grep_files', { pattern, glob, ignoreCase });
        return grepFiles(cwd, pattern, glob ?? undefined, ignoreCase ?? undefined);
      },
    }),

    tool({
      name: 'glob_files',
      description: 'Find files matching a glob pattern',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern to match files'),
      }),
      execute: async ({ pattern }) => {
        trackCall('glob_files', { pattern });
        return globFiles(cwd, pattern);
      },
    }),

    tool({
      name: 'find_usages',
      description:
        'Find all usages of a symbol (function, class, variable, type) across the codebase using ripgrep',
      parameters: z.object({
        symbol: z.string().describe('The symbol name to search for (exact word match)'),
        scope: z
          .string()
          .nullable()
          .default(null)
          .describe('Limit search to this directory path, or null'),
        fileType: z
          .string()
          .nullable()
          .default(null)
          .describe('File type filter (e.g., ts, js, tsx), or null'),
      }),
      execute: async ({ symbol, scope, fileType }) => {
        trackCall('find_usages', { symbol, scope, fileType });
        return findUsages(cwd, symbol, scope ?? undefined, fileType ?? undefined);
      },
    }),

    tool({
      name: 'trace_imports',
      description:
        'Trace import/export dependencies for a TypeScript file. Returns what the file imports and which files import it.',
      parameters: z.object({
        filePath: z.string().describe('Path to the file to analyze (relative to cwd)'),
      }),
      execute: async ({ filePath }) => {
        trackCall('trace_imports', { filePath });
        return traceImports(cwd, filePath);
      },
    }),

    tool({
      name: 'git_diff_analysis',
      description:
        'Get detailed git diff for a commit range or specific file. Shows added/removed/modified lines.',
      parameters: z.object({
        base: z.string().describe('Base commit or branch (e.g., main, HEAD~1)'),
        head: z
          .string()
          .nullable()
          .default(null)
          .describe('Head commit or branch (defaults to HEAD), or null'),
        file: z.string().nullable().default(null).describe('Specific file to diff, or null'),
        stat: z.boolean().nullable().default(null).describe('Show diff stats only, or null'),
      }),
      execute: async ({ base, head, file, stat }) => {
        trackCall('git_diff_analysis', { base, head, file, stat });
        return gitDiffAnalysis(cwd, base, head ?? undefined, file ?? undefined, stat ?? undefined);
      },
    }),

    tool({
      name: 'analyze_exports',
      description:
        'Analyze public exports from a TypeScript file and optionally compare with a previous version to detect breaking changes.',
      parameters: z.object({
        filePath: z.string().describe('Path to the file to analyze'),
        compareWithRef: z
          .string()
          .nullable()
          .default(null)
          .describe('Git ref to compare with (e.g., main, HEAD~1), or null'),
      }),
      execute: async ({ filePath, compareWithRef }) => {
        trackCall('analyze_exports', { filePath, compareWithRef });
        return analyzeExports(cwd, filePath, compareWithRef ?? undefined);
      },
    }),

    tool({
      name: 'find_interface_changes',
      description: 'Find changes to TypeScript interfaces or types between two git refs',
      parameters: z.object({
        base: z.string().describe('Base git ref'),
        head: z
          .string()
          .nullable()
          .default(null)
          .describe('Head git ref (defaults to HEAD), or null'),
        interfaceName: z
          .string()
          .nullable()
          .default(null)
          .describe('Specific interface to check, or null'),
      }),
      execute: async ({ base, head, interfaceName }) => {
        trackCall('find_interface_changes', { base, head, interfaceName });
        return findInterfaceChanges(cwd, base, head ?? undefined, interfaceName ?? undefined);
      },
    }),

    tool({
      name: 'list_changed_files',
      description:
        'List all files changed between two git refs with change type (added/modified/deleted)',
      parameters: z.object({
        base: z.string().describe('Base git ref'),
        head: z
          .string()
          .nullable()
          .default(null)
          .describe('Head git ref (defaults to HEAD), or null'),
        filter: z
          .string()
          .nullable()
          .default(null)
          .describe('Filter by status: A=added, M=modified, D=deleted, or null'),
      }),
      execute: async ({ base, head, filter }) => {
        trackCall('list_changed_files', { base, head, filter });
        return listChangedFiles(cwd, base, head ?? undefined, filter ?? undefined);
      },
    }),
  ];
}
