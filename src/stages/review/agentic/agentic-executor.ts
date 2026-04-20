import { query } from '@anthropic-ai/claude-agent-sdk';

import { AgentLoader } from './loaders/agent-loader';
import { buildUserPrompt } from './prompt-builder';
import { parseIssuesFromResult } from './result-parser';
import { createSubagentDefinitions, type AgentDefinition } from './subagents/definitions';
import { createAgenticTools } from './tools';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo, PipelineJob, AgenticConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { PromptLoader } from '../loaders/prompt-loader';

const DEFAULT_CONFIG: AgenticConfig = {
  maxTurns: 100,
  maxBudgetUsd: 10.0,
  enabledSubagents: [
    'dependency-tracer',
    'breaking-change-detector',
    'security-analyzer',
    'pattern-validator',
  ],
  customAgents: [],
  agentsDir: '.qualops/agents',
  systemPrompt: '',
};

export class AgenticExecutor {
  private config: AgenticConfig;
  private job: PipelineJob;
  private cwd: string;
  private model: string | undefined;
  private agentLoader: AgentLoader;

  constructor(job: PipelineJob, cwd?: string, model?: string) {
    this.job = job;
    this.config = { ...DEFAULT_CONFIG, ...job.agentic };
    this.cwd = cwd || process.cwd();
    this.model = model;
    this.agentLoader = new AgentLoader(this.cwd);
  }

  async execute(files: FileInfo[]): Promise<ReviewIssue[]> {
    logger.info(`[Agentic] Starting agentic review for job: ${this.job.name}`);
    logger.info(`[Agentic] Files to review: ${files.length}`);

    if (files.length === 0) {
      logger.info('[Agentic] No files to review');
      return [];
    }

    const toolServer = createAgenticTools(this.cwd);

    // Load built-in subagents
    const builtInAgents = createSubagentDefinitions(this.config);

    // Load custom agents from config and files
    const customAgents = this.agentLoader.loadCustomAgents(this.config);

    // Merge all agents (custom agents can override built-in)
    const allAgents: Record<string, AgentDefinition> = { ...builtInAgents, ...customAgents };

    const agentNames = Object.keys(allAgents);
    logger.info(`[Agentic] Available agents: ${agentNames.join(', ')}`);
    logger.info(`[Agentic] Custom agents: ${Object.keys(customAgents).join(', ') || 'none'}`);

    const _enabledSubagents = this.config.enabledSubagents || [];

    const systemPrompt = await this.buildSystemPrompt(allAgents);
    const userPrompt = buildUserPrompt(files, this.config);

    const issues: ReviewIssue[] = [];

    try {
      const result = query({
        prompt: userPrompt,
        options: {
          systemPrompt,
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
          agents: allAgents,
          maxTurns: this.config.maxTurns || 100,
          ...(this.config.maxBudgetUsd && { maxBudgetUsd: this.config.maxBudgetUsd }),
          ...(this.model && { model: this.model }),
          cwd: this.cwd,
          permissionMode: 'bypassPermissions',
        },
      });

      for await (const message of result) {
        logger.info(
          `[Agentic] Message: type=${message.type}, subtype=${'subtype' in message ? message.subtype : 'N/A'}`,
        );

        if (message.type === 'assistant') {
          const content = 'message' in message ? message.message?.content : null;
          if (content && Array.isArray(content)) {
            for (const block of content) {
              if (block.type === 'text') {
                logger.info(
                  `[Agentic] Assistant text (first 200 chars): ${block.text.substring(0, 200)}`,
                );
              } else if (block.type === 'tool_use') {
                logger.info(`[Agentic] Tool call: ${block.name}`);
              }
            }
          }
        }

        if (message.type === 'result') {
          if (message.subtype === 'success' && message.result) {
            logger.info(
              `[Agentic] Success result (first 500 chars): ${message.result.substring(0, 500)}`,
            );
            const parsed = parseIssuesFromResult(message.result, files, this.job.name, this.cwd);
            issues.push(...parsed);
            logger.info(`[Agentic] Parsed ${parsed.length} issues from result`);
          } else if (message.subtype !== 'success') {
            logger.error(`[Agentic] Agent error: ${message.subtype}`);
          }
        }
      }
    } catch (error) {
      logger.error(`[Agentic] Execution failed: ${(error as Error).message}`);
      throw error;
    }

    logger.info(`[Agentic] Review completed: ${issues.length} total issues`);
    return issues;
  }

  private async buildSystemPrompt(_allAgents: Record<string, AgentDefinition>): Promise<string> {
    const parts: string[] = [];

    if (this.config.systemPrompt) {
      parts.push(this.config.systemPrompt);
    }

    if (this.config.prompt) {
      const { content } = await PromptLoader.load(this.config.prompt);
      parts.push(content);
    }

    const customPrompt = parts.join('\n\n');

    return `You are a code reviewer. File contents and diffs are provided below.

${customPrompt}

## Process

1. Analyze the provided code/diffs
2. Use Grep/Glob ONLY if checking external dependencies
3. Output JSON findings

## Output Format

\`\`\`json
[
  {
    "type": "security|bug|performance|maintainability",
    "severity": "critical|high|medium|low",
    "description": "What the issue is",
    "location": "src/file.ts:42",
    "reasoning": "Why this is a problem",
    "suggestion": "How to fix it",
    "confidence": 8
  }
]
\`\`\`

If no issues found, output: \`\`\`json\n[]\n\`\`\`

## Rules

- confidence >= 7
- Focus on changed code
- Max 10 tool calls`;
  }
}
