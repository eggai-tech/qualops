import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

import type { AgenticConfig, CustomAgentDefinition } from '../../../../shared/types/config';
import { logger } from '../../../../shared/utils/logger';
import type { AgentDefinition } from '../subagents/definitions';

interface MarkdownAgentFrontmatter {
  description?: string;
  tools?: string[];
  model?: 'sonnet' | 'opus' | 'haiku';
}

export class AgentLoader {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || process.cwd();
  }

  loadCustomAgents(config: AgenticConfig): Record<string, AgentDefinition> {
    const agents: Record<string, AgentDefinition> = {};

    // Load from inline config
    if (config.customAgents) {
      for (const agent of config.customAgents) {
        agents[agent.name] = this.convertToAgentDefinition(agent);
        logger.debug(`[AgentLoader] Loaded inline agent: ${agent.name}`);
      }
    }

    // Load from agents directory
    const agentsDir = config.agentsDir || '.qualops/agents';
    const fullAgentsDir = join(this.cwd, agentsDir);

    if (existsSync(fullAgentsDir)) {
      const files = readdirSync(fullAgentsDir).filter((f) => f.endsWith('.md'));

      for (const file of files) {
        const filePath = join(fullAgentsDir, file);
        const agent = this.loadAgentFromMarkdown(filePath);

        if (agent) {
          const name = basename(file, '.md');
          agents[name] = agent;
          logger.debug(`[AgentLoader] Loaded agent from file: ${name}`);
        }
      }
    }

    return agents;
  }

  private loadAgentFromMarkdown(filePath: string): AgentDefinition | null {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const { frontmatter, body } = this.parseMarkdown(content);

      if (!body.trim()) {
        logger.warn(`[AgentLoader] Empty prompt in ${filePath}`);
        return null;
      }

      return {
        description: frontmatter.description || `Custom agent from ${basename(filePath)}`,
        prompt: body.trim(),
        tools: frontmatter.tools || ['Read', 'Grep', 'Glob'],
        model: frontmatter.model || 'sonnet',
      };
    } catch (error) {
      logger.error(
        `[AgentLoader] Failed to load agent from ${filePath}: ${(error as Error).message}`,
      );
      return null;
    }
  }

  private parseMarkdown(content: string): { frontmatter: MarkdownAgentFrontmatter; body: string } {
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

    if (!frontmatterMatch) {
      return { frontmatter: {}, body: content };
    }

    const frontmatterStr = frontmatterMatch[1];
    const body = frontmatterMatch[2];

    const frontmatter: MarkdownAgentFrontmatter = {};

    // Parse YAML-like frontmatter (simple key: value pairs)
    for (const line of frontmatterStr.split('\n')) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, value] = match;

        if (key === 'description') {
          frontmatter.description = value.trim().replace(/^["']|["']$/g, '');
        } else if (key === 'model') {
          frontmatter.model = value.trim() as 'sonnet' | 'opus' | 'haiku';
        } else if (key === 'tools') {
          // Handle array format: tools: [Read, Grep, Glob]
          const arrayMatch = value.match(/\[([^\]]+)\]/);
          if (arrayMatch) {
            frontmatter.tools = arrayMatch[1].split(',').map((t) => t.trim());
          }
        }
      }
    }

    return { frontmatter, body };
  }

  private convertToAgentDefinition(custom: CustomAgentDefinition): AgentDefinition {
    return {
      description: custom.description,
      prompt: custom.prompt,
      tools: custom.tools || ['Read', 'Grep', 'Glob'],
      model: custom.model || 'sonnet',
    };
  }
}
