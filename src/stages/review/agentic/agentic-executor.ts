import { query } from '@anthropic-ai/claude-agent-sdk';

import { AgentLoader } from './loaders/agent-loader';
import { createSubagentDefinitions, type AgentDefinition } from './subagents/definitions';
import { createAgenticTools } from './tools';
import { fixMalformedJson } from '../../../ai/shared/parsers/json-parser';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo, PipelineJob, AgenticConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

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

    const systemPrompt = this.buildSystemPrompt(allAgents);
    const userPrompt = this.buildUserPrompt(files);

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
            const parsed = this.parseIssuesFromResult(message.result, files);
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

  private buildSystemPrompt(_allAgents: Record<string, AgentDefinition>): string {
    const customPrompt = this.config.systemPrompt || '';

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

  private buildUserPrompt(files: FileInfo[]): string {
    const mode = this.config.contextMode || 'auto';
    const maxPerFile = this.config.maxTokensPerFile || 8000;
    const maxTotal = this.config.maxTotalTokens || 50000;

    let totalTokens = 0;
    const fileContexts: string[] = [];

    const sorted = [...files].sort((a, b) => {
      const aChanges = (a.diff?.additions.size || 0) + (a.diff?.deletions.size || 0);
      const bChanges = (b.diff?.additions.size || 0) + (b.diff?.deletions.size || 0);
      return bChanges - aChanges;
    });

    for (const file of sorted) {
      const ctx = this.buildFileContext(file, mode, maxPerFile, maxTotal - totalTokens);
      if (ctx) {
        fileContexts.push(ctx);
        totalTokens += this.estimateTokens(ctx);
      }
      if (totalTokens >= maxTotal) break;
    }

    return `Review the following changed files for issues.

${fileContexts.join('\n\n---\n\n')}

Return issues as JSON. If checking dependencies, use Grep/Glob tools.`;
  }

  private buildFileContext(
    file: FileInfo,
    mode: string,
    maxTokens: number,
    remainingBudget: number,
  ): string {
    const budget = Math.min(maxTokens, remainingBudget);
    const useDiff = mode === 'diff' || (mode === 'auto' && file.rawDiff);

    let content: string;
    if (useDiff && file.rawDiff) {
      content = `### Diff\n\`\`\`diff\n${file.rawDiff}\n\`\`\``;
    } else {
      content = this.formatFileContent(file.content, budget);
    }

    const header = `## ${file.path}${file.framework ? ` (${file.framework})` : ''}`;
    return `${header}\n\n${content}`;
  }

  private formatFileContent(content: string, maxTokens: number): string {
    const lines = content.split('\n');
    const maxLines = Math.floor(maxTokens / 10);

    if (lines.length <= maxLines) {
      return this.addLineNumbers(content);
    }

    const truncated = lines.slice(0, maxLines).join('\n');
    return `${this.addLineNumbers(truncated)}\n[TRUNCATED: ${lines.length - maxLines} more lines]`;
  }

  private addLineNumbers(content: string): string {
    return content
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
      .join('\n');
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  private parseIssuesFromResult(result: string, files: FileInfo[]): ReviewIssue[] {
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || result.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      logger.warn('[Agentic] No JSON found in result');
      return [];
    }

    const jsonStr = fixMalformedJson(jsonMatch[1] || jsonMatch[0]);

    try {
      const parsed = JSON.parse(jsonStr);
      const issueArray = Array.isArray(parsed) ? parsed : [];

      return issueArray
        .filter((issue: any) => issue.confidence >= 7)
        .map((issue: any, index: number) => this.normalizeIssue(issue, index, files));
    } catch (error) {
      logger.warn(`[Agentic] Failed to parse issues: ${(error as Error).message}`);
      logger.warn(`[Agentic] JSON preview: ${jsonStr.slice(0, 300)}...`);
      return [];
    }
  }

  private normalizeIssue(issue: any, index: number, files: FileInfo[]): ReviewIssue {
    const location = this.parseLocation(issue.location || issue.file || '');
    const file = location.file || files[0]?.path || 'unknown';

    return {
      id: `agentic-${this.job.name}-${Date.now()}-${index}`,
      file,
      type: issue.type || 'maintainability',
      severity: issue.severity || 'medium',
      description: issue.description || 'No description',
      location: location.line ? `${location.line}` : '1',
      reasoning: issue.reasoning || '',
      suggestion: issue.suggestion || '',
      context: issue.context || '',
      confidence: issue.confidence || 7,
      knowledge_source: `agentic:${this.job.name}`,
      priority: this.calculatePriority(issue.severity),
      estimatedEffort: 'medium',
      tags: [issue.type, issue.severity, 'agentic'].filter(Boolean),
    };
  }

  private parseLocation(location: string): { file?: string; line?: number } {
    if (!location) return {};

    // Handle "file:line" format
    const match = location.match(/^(.+?):(\d+)/);
    if (match) {
      return { file: match[1], line: parseInt(match[2], 10) };
    }

    // Handle "line:N" format
    const lineMatch = location.match(/line:?\s*(\d+)/i);
    if (lineMatch) {
      return { line: parseInt(lineMatch[1], 10) };
    }

    return {};
  }

  private calculatePriority(severity: string): number {
    const priorities: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    return priorities[severity] || 3;
  }
}
