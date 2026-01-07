import { query } from '@anthropic-ai/claude-agent-sdk';

import { AgentLoader } from './loaders/agent-loader';
import { createSubagentDefinitions, type AgentDefinition } from './subagents/definitions';
import { createAgenticTools } from './tools';
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
  private agentLoader: AgentLoader;

  constructor(job: PipelineJob, cwd?: string) {
    this.job = job;
    this.config = { ...DEFAULT_CONFIG, ...job.agentic };
    this.cwd = cwd || process.cwd();
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
            'Task',
            'mcp__qualops-agentic-tools__find_usages',
            'mcp__qualops-agentic-tools__trace_imports',
            'mcp__qualops-agentic-tools__git_diff_analysis',
            'mcp__qualops-agentic-tools__analyze_exports',
            'mcp__qualops-agentic-tools__find_interface_changes',
            'mcp__qualops-agentic-tools__list_changed_files',
          ],
          mcpServers: {
            'qualops-agentic-tools': toolServer,
          },
          agents: allAgents,
          maxTurns: this.config.maxTurns || 100,
          cwd: this.cwd,
          permissionMode: 'bypassPermissions',
        },
      });

      for await (const message of result) {
        if (message.type === 'assistant') {
          logger.debug(`[Agentic] Assistant message received`);
        }

        if (message.type === 'result') {
          if (message.subtype === 'success' && message.result) {
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

  private buildSystemPrompt(allAgents: Record<string, AgentDefinition>): string {
    const agentList = Object.entries(allAgents)
      .map(([name, def]) => `- **${name}**: ${def.description}`)
      .join('\n');

    return `You are an expert code reviewer performing a comprehensive PR review.

Your job is to coordinate specialized subagents to analyze the changed files and identify issues.

## Available Subagents

You have access to these specialized subagents via the Task tool:
${agentList}

## Review Process

1. First, understand the scope of changes using list_changed_files and git_diff_analysis
2. Analyze dependencies between changed files using trace_imports
3. Delegate specialized analysis to appropriate subagents based on the task
4. Collect and deduplicate findings from all subagents
5. Return a final consolidated list of issues

## Output Format

After all analysis is complete, output the final issues as a JSON array:

\`\`\`json
[
  {
    "type": "security|performance|bug|maintainability",
    "severity": "critical|high|medium|low",
    "description": "Clear description of the issue",
    "location": "file:line",
    "reasoning": "Why this is problematic",
    "suggestion": "How to fix it",
    "confidence": 7-10
  }
]
\`\`\`

Only include issues with confidence >= 7. If no issues are found, return an empty array.

## Important Guidelines

- Focus on the CHANGED code, not the entire codebase
- Verify findings before reporting - use tools to confirm issues exist
- Deduplicate issues that multiple subagents might find
- Prioritize security and breaking changes over style issues
- Be specific about file paths and line numbers`;
  }

  private buildUserPrompt(files: FileInfo[]): string {
    const fileList = files.map((f) => `- ${f.path}`).join('\n');

    const filesWithDiffs = files.filter((f) => f.diff);
    const diffSummary =
      filesWithDiffs.length > 0
        ? `\n\n## Changed Lines Summary\n${filesWithDiffs
            .map((f) => {
              const added = f.diff?.additions.size || 0;
              const deleted = f.diff?.deletions.size || 0;
              return `- ${f.path}: +${added}/-${deleted} lines`;
            })
            .join('\n')}`
        : '';

    return `Please review the following files that have been changed:

## Files to Review
${fileList}
${diffSummary}

Perform a comprehensive code review using the available subagents. Focus on:
1. Cross-file dependency impacts
2. Breaking API changes
3. Security vulnerabilities
4. Code quality and pattern violations

Return the final list of issues as JSON.`;
  }

  private parseIssuesFromResult(result: string, files: FileInfo[]): ReviewIssue[] {
    const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || result.match(/\[[\s\S]*\]/);

    if (!jsonMatch) {
      logger.warn('[Agentic] No JSON found in result');
      return [];
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);
      const issueArray = Array.isArray(parsed) ? parsed : [];

      return issueArray
        .filter((issue: any) => issue.confidence >= 7)
        .map((issue: any, index: number) => this.normalizeIssue(issue, index, files));
    } catch (error) {
      logger.warn(`[Agentic] Failed to parse issues: ${(error as Error).message}`);
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
