import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

import type { AgenticConfig, CustomAgentDefinition } from '../../../../shared/types/config';
import { logger } from '../../../../shared/utils/logger';
import { resolveCustomAgentsDir } from '../../loaders/search-paths';
import type { AgentDefinition } from '../subagents/definitions';

interface MarkdownAgentFrontmatter {
  description?: string;
  tools?: string[];
  model?: string;
}

export class AgentLoader {
  private cwd: string;

  constructor(cwd?: string) {
    this.cwd = resolve(cwd || process.cwd());
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

    // Load from custom agents directory (.qualops/agents) — user-defined agents, scanned by file
    const customAgentsDir = resolveCustomAgentsDir(this.cwd, config.agentsDir);

    if (!customAgentsDir) {
      logger.warn(
        `[AgentLoader] agentsDir "${config.agentsDir}" resolves outside project directory. Path traversal is not allowed.`,
      );
      return agents;
    }

    if (existsSync(customAgentsDir)) {
      for (const file of readdirSync(customAgentsDir).filter((f) => f.endsWith('.md'))) {
        const name = basename(file, '.md');
        if (agents[name]) continue;
        const agent = this.loadAgentFromMarkdown(join(customAgentsDir, file));
        if (agent) {
          agents[name] = agent;
          logger.debug(`[AgentLoader] Loaded custom agent from file: ${name}`);
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
        model: frontmatter.model,
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
          frontmatter.model = value.trim();
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
      model: custom.model,
    };
  }
}
