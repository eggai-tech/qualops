import { runAgent, jsonSchema } from '@eggai/configurable-agent/lib';
import type { AgentConfig, AgentEvent } from '@eggai/configurable-agent/lib';
import { z } from 'zod';

import type { AgentAdapter, AgentAdapterParams, AgentAdapterResult } from './agent-adapter';
import { logger } from '../../../../shared/utils/logger';
import { createToolSet } from '../tools';

function toJsonSchema(schema: z.ZodObject<z.ZodRawShape>): Record<string, unknown> {
  // z.toJSONSchema emits Draft 2020-12 with a $schema key that confuses some providers.
  // Strip it and emit a plain draft-07-compatible object instead.
  const { $schema: _dropped, ...rest } = z.toJSONSchema(schema) as Record<string, unknown>;
  return rest;
}

function buildSystemPrompt(params: AgentAdapterParams, toolNames: string[]): string {
  const parts = [params.systemPrompt];

  const agentEntries = Object.entries(params.agents ?? {});
  if (agentEntries.length > 0) {
    parts.push('## Review perspectives\n');
    for (const [name, def] of agentEntries) {
      parts.push(`### ${name}\n${def.prompt}`);
    }
  }

  if (toolNames.length > 0) {
    parts.push(
      `## Available tools\nThe following tools are available. Use their EXACT names when calling them — do not use aliases like Read, Grep, or Glob:\n${toolNames.map((n) => `- ${n}`).join('\n')}\n\nUse these tools to trace cross-file issues, verify patterns, and confirm findings before reporting.`,
    );
  }

  return parts.filter(Boolean).join('\n\n');
}

function buildAgentConfig(params: AgentAdapterParams, toolNames: string[]) {
  return {
    systemPrompt: buildSystemPrompt(params, toolNames),
    model: {
      provider: 'openai-compatible' as const,
      name: params.model,
      ...(params.baseUrl && { baseUrl: params.baseUrl }),
      ...(params.apiKey !== undefined && { apiKey: params.apiKey }),
    },
    agent: { maxSteps: params.maxTurns },
    mcpTools: [],
    output: { structured: false },
    safety: {
      compaction: { triggerTokens: 100_000, keepRecentMessages: 6 },
      toolOutput: { triggerTokens: 4_000, headChars: 500, tailChars: 500 },
    },
  } satisfies AgentConfig;
}

export class ConfigurableAgentAdapter implements AgentAdapter {
  async run(params: AgentAdapterParams): Promise<AgentAdapterResult> {
    const qualopsTools = await createToolSet(params.cwd, params.toolConfig, params.skipPatterns);
    const config = buildAgentConfig(
      params,
      qualopsTools.tools.map((t) => t.name),
    );

    const tools: Record<
      string,
      {
        description: string;
        inputSchema: unknown;
        execute: (args: Record<string, unknown>) => Promise<string>;
      }
    > = {};
    for (const def of qualopsTools.tools) {
      tools[def.name] = {
        description: def.description,
        inputSchema: jsonSchema(toJsonSchema(def.schema)),
        execute: (args: Record<string, unknown>) => def.execute(args),
      };
    }

    // --- DEBUG ---
    process.stderr.write('\n=== [DEBUG] SYSTEM PROMPT ===\n' + config.systemPrompt + '\n');
    process.stderr.write('\n=== [DEBUG] USER PROMPT ===\n' + params.userPrompt + '\n');
    process.stderr.write('=== [DEBUG] END PROMPTS ===\n\n');
    // --- END DEBUG ---

    try {
      let output = '';
      let inputTokens: number | undefined;
      let outputTokens: number | undefined;
      let errorSubtype: string | undefined;
      let turnIndex = 0;

      await runAgent(
        config,
        [{ role: 'user', content: params.userPrompt }],
        async (event: AgentEvent) => {
          switch (event.type) {
            case 'tool_call':
              turnIndex++;
              logger.info(`[Agentic/ConfigurableAgent] Tool call: ${event.name}`);
              params.onToolCall?.(turnIndex, event.name, event.args);
              break;
            case 'final':
              output = event.content;
              inputTokens = event.usage?.inputTokens;
              outputTokens = event.usage?.outputTokens;
              logger.info(
                `[Agentic/ConfigurableAgent] Finished. steps=${event.steps}, stopReason=${event.stopReason}`,
              );
              break;
            case 'error':
              logger.warn(
                `[Agentic/ConfigurableAgent] Error: code=${event.code} — ${event.message}`,
              );
              if (event.details) {
                process.stderr.write(
                  `\n=== [DEBUG] ERROR DETAILS ===\n${JSON.stringify(event, null, 2)}\n=== [DEBUG] END ERROR ===\n\n`,
                );
              }
              switch (event.code) {
                case 'tool_call_on_final_step':
                  errorSubtype = 'error_max_turns';
                  break;
                case 'stream_error':
                  errorSubtype = 'error_provider_unavailable';
                  if (event.partialContent) {
                    logger.warn(
                      `[Agentic/ConfigurableAgent] Recovering partial response (${event.partialContent.length} chars)`,
                    );
                    output = event.partialContent;
                  }
                  break;
                case 'rate_limit_tokens':
                  errorSubtype = 'error_rate_limit_tokens';
                  if (event.partialContent) {
                    logger.warn(
                      `[Agentic/ConfigurableAgent] Recovering partial response before rate limit (${event.partialContent.length} chars)`,
                    );
                    output = event.partialContent;
                  }
                  break;
                case 'structured_output_failed':
                  errorSubtype = 'error_content_filter';
                  break;
                default:
                  throw new Error(`Agent failed: ${event.message}`);
              }
              break;
            default:
              break;
          }
        },
        undefined,
        { tools: tools as never },
      );

      return { output, inputTokens, outputTokens, errorSubtype };
    } finally {
      await qualopsTools.dispose();
    }
  }
}
