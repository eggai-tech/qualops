import type { BashConfig } from '../../../../shared/types/config';
import type { ResolvedAgentDefinition } from '../subagents/definitions';

export interface ToolConfig {
  bash: BashConfig;
  // Future tools add their config here, namespaced by tool name.
}

export interface AgentAdapterParams {
  systemPrompt: string;
  userPrompt: string;
  agents: Record<string, ResolvedAgentDefinition>;
  model: string;
  cwd: string;
  maxTurns: number;
  maxBudgetUsd?: number;
  skipPatterns?: string[];
  toolConfig: ToolConfig;
  onToolCall?: (turn: number, name: string, input: unknown) => void;
  baseUrl?: string;
}

export type AgentErrorSubtype =
  | 'error_max_turns'
  | 'error_provider_unavailable'
  | 'error_rate_limit_tokens'
  | 'error_max_tokens'
  | 'error_content_filter'
  | 'error_parse_failed'
  | 'error_unexpected';

export interface AgentAdapterResult {
  output: string;
  /** Pre-parsed issues array from SDK structured output. Bypasses text parsing when set. */
  structuredOutput?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  /** Set when the agent run did not complete successfully. */
  errorSubtype?: AgentErrorSubtype;
}

export interface AgentAdapter {
  run(params: AgentAdapterParams): Promise<AgentAdapterResult>;
}
