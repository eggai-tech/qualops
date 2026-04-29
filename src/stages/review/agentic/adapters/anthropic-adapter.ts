import { query } from '@anthropic-ai/claude-agent-sdk';

import { createAgenticTools } from '../tools';
import type { AgentAdapter, AgentAdapterParams, AgentAdapterResult } from './agent-adapter';
import { logger } from '../../../../shared/utils/logger';

export class AnthropicAdapter implements AgentAdapter {
  async run(params: AgentAdapterParams): Promise<AgentAdapterResult> {
    const { systemPrompt, userPrompt, agents, model, cwd, maxTurns, maxBudgetUsd, onToolCall } =
      params;

    const toolServer = createAgenticTools(cwd);

    const executablePath = process.env.CLAUDE_CODE_EXECUTABLE;

    const result = query({
      prompt: userPrompt,
      options: {
        systemPrompt,
        ...(executablePath && { pathToClaudeCodeExecutable: executablePath }),
        allowedTools: [
          'Read',
          'Grep',
          'Glob',
          'mcp__qualops-agentic-tools__find_usages',
          'mcp__qualops-agentic-tools__git_diff_analysis',
          'mcp__qualops-agentic-tools__list_changed_files',
        ],
        mcpServers: {
          'qualops-agentic-tools': toolServer,
        },
        agents,
        maxTurns,
        ...(maxBudgetUsd && { maxBudgetUsd }),
        ...(model && { model }),
        cwd,
        permissionMode: 'bypassPermissions',
      },
    });

    let output = '';
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;
    let errorSubtype: string | undefined;
    let turnIndex = 0;

    for await (const message of result) {
      logger.info(
        `[Agentic/Anthropic] Message: type=${message.type}, subtype=${'subtype' in message ? message.subtype : 'N/A'}`,
      );

      if (message.type === 'assistant') {
        turnIndex++;
        const content = 'message' in message ? message.message?.content : null;
        if (content && Array.isArray(content)) {
          for (const block of content) {
            if (block.type === 'text') {
              logger.info(
                `[Agentic/Anthropic] Assistant text (first 200 chars): ${block.text.substring(0, 200)}`,
              );
            } else if (block.type === 'tool_use') {
              logger.info(`[Agentic/Anthropic] Tool call: ${block.name}`);
              onToolCall?.(turnIndex, block.name, block.input);
            }
          }
        }
      }

      if (message.type === 'result') {
        if (message.subtype === 'success' && message.result) {
          logger.info(
            `[Agentic/Anthropic] Success result (first 500 chars): ${message.result.substring(0, 500)}`,
          );
          output = message.result;
          const usage =
            'usage' in message
              ? (message.usage as { input_tokens?: number; output_tokens?: number } | undefined)
              : undefined;
          inputTokens = usage?.input_tokens;
          outputTokens = usage?.output_tokens;
        } else if (message.subtype !== 'success') {
          errorSubtype = message.subtype;
          logger.error(`[Agentic/Anthropic] Agent error: ${message.subtype}`);
        }
      }
    }

    return { output, inputTokens, outputTokens, errorSubtype };
  }
}
