import { readFileSync } from 'node:fs';

import type { ModelConfig } from '../../../../shared/types';
import type { AgenticConfig, AgenticSubagentType } from '../../../../shared/types/config';
import { resolveBuiltinAgentPath } from '../../loaders/search-paths';

export interface AgentDefinition {
  description: string;
  prompt: string;
  tools: string[];
  model?: ModelConfig;
}

export type ResolvedAgentDefinition = Omit<AgentDefinition, 'model'> & { model?: string };

function loadBuiltinAgentDefinition(name: AgenticSubagentType): AgentDefinition {
  const path = resolveBuiltinAgentPath(name);
  if (!path) throw new Error(`[AgentLoader] Built-in agent markdown not found: ${name}`);

  const content = readFileSync(path, 'utf-8');
  const match = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`[AgentLoader] Missing frontmatter in built-in agent: ${name}`);

  const [, frontmatterStr, body] = match;
  let description = '';
  let tools: string[] = [];

  for (const line of frontmatterStr.split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (!kv) continue;
    const [, key, value] = kv;
    if (key === 'description') {
      description = value.trim().replace(/^["']|["']$/g, '');
    } else if (key === 'tools') {
      const arr = value.match(/\[([^\]]+)\]/);
      if (arr) tools = arr[1].split(',').map((t) => t.trim());
    }
  }

  if (!body.trim()) throw new Error(`[AgentLoader] Empty prompt in built-in agent: ${name}`);

  return { description, prompt: body.trim(), tools };
}

const SUBAGENT_DEFINITIONS: Record<AgenticSubagentType, AgentDefinition> = {
  'dependency-tracer': loadBuiltinAgentDefinition('dependency-tracer'),
  'breaking-change-detector': loadBuiltinAgentDefinition('breaking-change-detector'),
  'security-analyzer': loadBuiltinAgentDefinition('security-analyzer'),
  'pattern-validator': loadBuiltinAgentDefinition('pattern-validator'),
};

export function createSubagentDefinitions(config: AgenticConfig): Record<string, AgentDefinition> {
  const enabled =
    config.enabledSubagents || (Object.keys(SUBAGENT_DEFINITIONS) as AgenticSubagentType[]);
  const definitions: Record<string, AgentDefinition> = {};

  const bashSubagentAccess = config.bash?.subagentAccess ?? 'all';
  const addBash = bashSubagentAccess === 'all';

  for (const entry of enabled) {
    const type = typeof entry === 'string' ? entry : entry.name;
    if (type in SUBAGENT_DEFINITIONS) {
      const def = { ...SUBAGENT_DEFINITIONS[type as AgenticSubagentType] };
      if (addBash && !def.tools.includes('Bash')) {
        def.tools = [...def.tools, 'Bash'];
      }
      definitions[type] = def;
    }
  }

  return definitions;
}

export function getAllSubagentTypes(): AgenticSubagentType[] {
  return Object.keys(SUBAGENT_DEFINITIONS) as AgenticSubagentType[];
}
