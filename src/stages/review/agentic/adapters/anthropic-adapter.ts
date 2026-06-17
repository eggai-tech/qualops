import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';

import { ReviewIssuesSchema } from '../../../../ai/shared/schemas/review-issue';
import { schemaToJsonSchema } from '../../../../ai/shared/structured';
import { createToolSet, type ToolSet } from '../tools';
import type {
  AgentAdapter,
  AgentAdapterParams,
  AgentAdapterResult,
  AgentErrorSubtype,
} from './agent-adapter';
import { logger } from '../../../../shared/utils/logger';

const REVIEW_ISSUES_JSON_SCHEMA = schemaToJsonSchema(ReviewIssuesSchema);

type QueryOptions = Parameters<typeof query>[0]['options'];

function toMcpServer(toolSet: ToolSet): ReturnType<typeof createSdkMcpServer> {
  const sdkTools = toolSet.tools.map((def) =>
    tool(def.name, def.description, def.schema.shape, async (args) => ({
      content: [{ type: 'text', text: await def.execute(args as Record<string, unknown>) }],
    })),
  );
  return createSdkMcpServer({
    name: 'qualops-agentic-tools',
    version: '1.0.0',
    tools: sdkTools,
  });
}

function buildQueryOptions(
  params: AgentAdapterParams,
  toolServer: ReturnType<typeof createSdkMcpServer>,
): QueryOptions {
  const { systemPrompt, agents, model, cwd, maxTurns, maxBudgetUsd } = params;
  const executablePath = process.env.CLAUDE_CODE_EXECUTABLE;

  return {
    systemPrompt,
    ...(executablePath && { pathToClaudeCodeExecutable: executablePath }),
    // Restrict to MCP tools only — no SDK built-ins. This ensures skipPatterns
    // enforcement in handlers.ts applies uniformly (SDK built-ins bypass handlers).
    // Shell access still goes through our MCP bash tool for policy enforcement.
    tools: [],
    allowedTools: [
      'mcp__qualops-agentic-tools__read_file',
      'mcp__qualops-agentic-tools__grep_files',
      'mcp__qualops-agentic-tools__glob_files',
      'mcp__qualops-agentic-tools__bash',
      'mcp__qualops-agentic-tools__find_usages',
      'mcp__qualops-agentic-tools__git_diff_analysis',
      'mcp__qualops-agentic-tools__list_changed_files',
    ],
    mcpServers: { 'qualops-agentic-tools': toolServer },
    agents,
    maxTurns,
    ...(maxBudgetUsd && { maxBudgetUsd }),
    ...(model && { model }),
    cwd,
    permissionMode: 'bypassPermissions',
    outputFormat: { type: 'json_schema' as const, schema: REVIEW_ISSUES_JSON_SCHEMA },
  };
}

function logBashToolResult(resultContent: string): void {
  try {
    const parsed = JSON.parse(resultContent) as Record<string, unknown>;
    if (!('exit_code' in parsed || 'stdout' in parsed)) return;
    const stdout = String(parsed['stdout'] ?? '').substring(0, 500);
    const stderr = String(parsed['stderr'] ?? '').substring(0, 200);
    const hint = parsed['semantic_hint'] ? ` (${parsed['semantic_hint']})` : '';
    logger.info(`[bash] ← exit=${parsed['exit_code']}${hint}`);
    if (stdout) logger.info(`[bash] ← stdout: ${stdout}`);
    if (stderr) logger.info(`[bash] ← stderr: ${stderr}`);
  } catch {
    // not a bash result
  }
}

function extractToolResultContent(block: { content: unknown }): string {
  return Array.isArray(block.content)
    ? (block.content as { type: string; text?: string }[])
        .map((c) => (c.type === 'text' ? c.text : ''))
        .join('')
    : String(block.content ?? '');
}

type SDKMessage = { type: string; subtype?: string; [key: string]: unknown };

function handleAssistantMessage(
  message: SDKMessage,
  turnIndex: number,
  onToolCall: AgentAdapterParams['onToolCall'],
): void {
  const raw = message as { message?: { content?: unknown } };
  const content = raw.message?.content;
  if (!content || !Array.isArray(content)) return;
  for (const block of content as {
    type: string;
    text?: string;
    name?: string;
    input?: unknown;
  }[]) {
    if (block.type === 'text') {
      logger.info(
        `[Agentic/Anthropic] Assistant text (first 200 chars): ${block.text!.substring(0, 200)}`,
      );
    } else if (block.type === 'tool_use') {
      logger.info(`[Agentic/Anthropic] Tool call: ${block.name}`);
      onToolCall?.(turnIndex, block.name!, block.input);
    }
  }
}

function handleUserMessage(message: SDKMessage): void {
  const raw = message as { message?: { content?: unknown } };
  const content = raw.message?.content;
  if (!content || !Array.isArray(content)) return;
  for (const block of content as Record<string, unknown>[]) {
    if (block['type'] === 'tool_result' && 'tool_use_id' in block && 'content' in block) {
      const resultContent = extractToolResultContent(block as { content: unknown });
      if (resultContent.length > 0) logBashToolResult(resultContent);
    }
  }
}

// Maps Anthropic SDK result subtypes to qualops error subtypes.
// SDK error subtypes: error_during_execution | error_max_turns | error_max_budget_usd | error_max_structured_output_retries
// Unknown subtypes fall back to 'error_unexpected'.
const ANTHROPIC_ERROR_SUBTYPE_MAP: Partial<Record<string, AgentErrorSubtype>> = {
  error_max_turns: 'error_max_turns',
  error_during_execution: 'error_provider_unavailable',
  error_max_budget_usd: 'error_rate_limit_tokens',
  error_max_structured_output_retries: 'error_content_filter',
};

function handleResultMessage(
  message: SDKMessage,
  state: {
    output: string;
    structuredOutput?: unknown;
    inputTokens?: number;
    outputTokens?: number;
    errorSubtype?: AgentErrorSubtype;
  },
): void {
  const msg = message as {
    subtype: string;
    result?: string;
    structured_output?: unknown;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  if (msg.subtype === 'success') {
    state.inputTokens = msg.usage?.input_tokens;
    state.outputTokens = msg.usage?.output_tokens;
    if (msg.structured_output !== undefined) {
      logger.info('[Agentic/Anthropic] Received structured output from SDK');
      state.structuredOutput = msg.structured_output;
    } else if (msg.result) {
      logger.info(
        `[Agentic/Anthropic] Success result (first 500 chars): ${msg.result.substring(0, 500)}`,
      );
      state.output = msg.result;
    }
  } else if (msg.subtype !== 'success') {
    const mapped = ANTHROPIC_ERROR_SUBTYPE_MAP[msg.subtype] ?? 'error_unexpected';
    if (mapped === 'error_unexpected') {
      logger.warn(`[Agentic/Anthropic] Unrecognized result subtype: ${msg.subtype}`);
    }
    state.errorSubtype = mapped;
    logger.error(`[Agentic/Anthropic] Agent error: ${msg.subtype} → ${mapped}`);
  }
}

export class AnthropicAdapter implements AgentAdapter {
  async run(params: AgentAdapterParams): Promise<AgentAdapterResult> {
    const toolSet = await createToolSet(params.cwd, params.toolConfig, params.skipPatterns);

    try {
      const toolServer = toMcpServer(toolSet);
      const result = query({
        prompt: params.userPrompt,
        options: buildQueryOptions(params, toolServer),
      });

      const state = {
        output: '',
        structuredOutput: undefined as unknown,
        inputTokens: undefined as number | undefined,
        outputTokens: undefined as number | undefined,
        errorSubtype: undefined as AgentErrorSubtype | undefined,
      };
      let turnIndex = 0;

      for await (const message of result) {
        const msg = message as SDKMessage;
        logger.info(
          `[Agentic/Anthropic] Message: type=${msg.type}, subtype=${msg.subtype ?? 'N/A'}`,
        );
        if (msg.type === 'assistant') handleAssistantMessage(msg, ++turnIndex, params.onToolCall);
        if (msg.type === 'user') handleUserMessage(msg);
        if (msg.type === 'result') handleResultMessage(msg, state);
      }

      return state;
    } finally {
      await toolSet.dispose();
    }
  }
}
