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
  toolConfig: ToolConfig;
  onToolCall?: (turn: number, name: string, input: unknown) => void;
}

export interface AgentAdapterResult {
  output: string;
  inputTokens?: number;
  outputTokens?: number;
  /** Set when the agent run did not complete successfully (e.g. 'error_max_turns'). */
  errorSubtype?: string;
}

export interface AgentAdapter {
  run(params: AgentAdapterParams): Promise<AgentAdapterResult>;
}
