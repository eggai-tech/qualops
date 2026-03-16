import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  query,
  type AgentDefinition as SDKAgentDefinition,
  type SDKMessage,
  type SDKResultSuccess,
  type SDKAssistantMessage,
  type SDKTaskNotificationMessage,
} from '@anthropic-ai/claude-agent-sdk';

import { AgentLoader } from './loaders/agent-loader';
import { createSubagentDefinitions, type AgentDefinition } from './subagents/definitions';
import { createAgenticTools } from './tools';
import { addStageTokenStats } from '../../../shared/runtime/session-context';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo, PipelineJob, AgenticConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

const DEFAULT_CONFIG: AgenticConfig = {
  maxTurns: 100,
  maxBudgetUsd: 3.0,
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

const ISSUE_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['security', 'bug', 'performance', 'maintainability'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
          location: { type: 'string' },
          reasoning: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { type: 'number' },
        },
        required: ['type', 'severity', 'description', 'location', 'confidence'],
      },
    },
  },
  required: ['issues'],
};

interface SubagentMetric {
  agentName: string;
  status?: string;
  summary?: string;
  totalTokens?: number;
  toolUses?: number;
  durationMs?: number;
}

interface RawIssue {
  type?: string;
  severity?: string;
  description?: string;
  location?: string;
  reasoning?: string;
  suggestion?: string;
  confidence?: number;
  context?: string;
}

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
    logger.info(`[Agentic] Starting review for job: ${this.job.name} (${files.length} files)`);

    if (files.length === 0) {
      logger.info('[Agentic] No files to review');
      return [];
    }

    const toolServer = createAgenticTools(this.cwd);
    const builtInAgents = createSubagentDefinitions(this.config);
    this.applySubagentOverrides(builtInAgents);
    const customAgents = this.agentLoader.loadCustomAgents(this.config);
    const allAgents: Record<string, AgentDefinition> = { ...builtInAgents, ...customAgents };

    logger.info(`[Agentic] Agents: ${Object.keys(allAgents).join(', ')}`);

    const systemPrompt = this.buildSystemPrompt(allAgents);
    const userPrompt = this.buildUserPrompt(files);
    const abortController = new AbortController();
    const issues: ReviewIssue[] = [];
    const subagentMetrics: Record<string, SubagentMetric> = {};
    let budgetExhausted = false;

    try {
      const result = query({
        prompt: userPrompt,
        options: {
          systemPrompt,
          agents: allAgents as Record<string, SDKAgentDefinition>,
          allowedTools: [
            'Read',
            'Grep',
            'Glob',
            'mcp__qualops-agentic-tools__git_diff',
            'mcp__qualops-agentic-tools__git_show',
            'mcp__qualops-agentic-tools__list_changed_files',
          ],
          mcpServers: {
            'qualops-agentic-tools': toolServer,
          },
          maxTurns: this.config.maxTurns || 100,
          cwd: this.cwd,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          abortController,
          outputFormat: { type: 'json_schema', schema: ISSUE_SCHEMA },
        },
      });

      for await (const message of result) {
        this.handleMessage(message, issues, subagentMetrics, files);

        if (this.checkBudget(message, abortController)) {
          budgetExhausted = true;
          break;
        }
      }
    } catch (error) {
      if (budgetExhausted) {
        logger.warn(`[Agentic] Budget exhausted, returning ${issues.length} partial results`);
      } else {
        logger.error(`[Agentic] Execution failed: ${(error as Error).message}`);
        if (issues.length === 0) throw error;
        logger.warn(`[Agentic] Returning ${issues.length} partial results from before failure`);
      }
    }

    this.logSubagentMetrics(subagentMetrics);
    logger.info(`[Agentic] Review completed: ${issues.length} issues`);
    return issues;
  }

  private handleMessage(
    message: SDKMessage,
    issues: ReviewIssue[],
    metrics: Record<string, SubagentMetric>,
    files: FileInfo[],
  ): void {
    if (message.type === 'assistant') {
      this.handleAssistantMessage(message as SDKAssistantMessage);
    }

    if (message.type === 'system' && 'subtype' in message) {
      if (message.subtype === 'task_started') {
        const taskId = (message as any).task_id as string;
        metrics[taskId] = { agentName: taskId };
        logger.info(`[Agentic] Subagent started: ${taskId}`);
      }

      if (message.subtype === 'task_notification') {
        const notif = message as SDKTaskNotificationMessage;
        metrics[notif.task_id] = {
          agentName: notif.task_id,
          status: notif.status,
          summary: notif.summary,
          totalTokens: notif.usage?.total_tokens,
          toolUses: notif.usage?.tool_uses,
          durationMs: notif.usage?.duration_ms,
        };
        logger.info(
          `[Agentic] Subagent ${notif.status}: ${notif.task_id} (${notif.usage?.total_tokens || 0} tokens)`,
        );

        if (notif.status === 'completed' && notif.summary) {
          const parsed = this.parseIssuesFromText(notif.summary, files);
          if (parsed.length > 0) {
            issues.push(...parsed);
            logger.info(
              `[Agentic] Captured ${parsed.length} issues from subagent ${notif.task_id}`,
            );
          }
        }
      }
    }

    if (message.type === 'result') {
      if (message.subtype === 'success') {
        const success = message as SDKResultSuccess;
        this.reportTokenUsage(success);

        if (success.structured_output) {
          const output = success.structured_output as { issues?: RawIssue[] };
          if (output.issues) {
            const parsed = output.issues
              .filter((i) => (i.confidence || 0) >= 7)
              .map((i, idx) => this.normalizeIssue(i, idx, files));
            issues.length = 0;
            issues.push(...parsed);
            logger.info(`[Agentic] Structured output: ${parsed.length} issues`);
          }
        } else if (success.result) {
          const parsed = this.parseIssuesFromText(success.result, files);
          issues.length = 0;
          issues.push(...parsed);
          logger.info(`[Agentic] Parsed ${parsed.length} issues from result text`);
        }
      } else {
        logger.error(`[Agentic] Agent error: ${message.subtype}`);
      }
    }
  }

  private handleAssistantMessage(message: SDKAssistantMessage): void {
    const content = message.message?.content;
    if (!content || !Array.isArray(content)) return;

    for (const block of content) {
      if (block.type === 'tool_use') {
        logger.info(`[Agentic] Tool: ${block.name}`);
      }
    }
  }

  private checkBudget(message: SDKMessage, abortController: AbortController): boolean {
    if (!this.config.maxBudgetUsd) return false;

    if (message.type === 'result' && message.subtype === 'success') {
      const cost = (message as SDKResultSuccess).total_cost_usd;
      if (cost >= this.config.maxBudgetUsd) {
        logger.warn(
          `[Agentic] Budget limit reached: $${cost.toFixed(4)} >= $${this.config.maxBudgetUsd}`,
        );
        return true;
      }
    }

    // Mid-run budget check from assistant message usage
    if (message.type === 'assistant') {
      const usage = (message as SDKAssistantMessage).message?.usage;
      if (usage) {
        const estimatedCost =
          ((usage.input_tokens || 0) / 1_000_000) * 3.0 +
          ((usage.output_tokens || 0) / 1_000_000) * 15.0;

        if (estimatedCost >= this.config.maxBudgetUsd * 0.9) {
          logger.warn(`[Agentic] Approaching budget limit (~$${estimatedCost.toFixed(4)})`);
          abortController.abort();
          return true;
        }
      }
    }

    return false;
  }

  private reportTokenUsage(result: SDKResultSuccess): void {
    let totalInput = 0;
    let totalOutput = 0;
    let totalCached = 0;

    for (const usage of Object.values(result.modelUsage)) {
      totalInput += usage.inputTokens;
      totalOutput += usage.outputTokens;
      totalCached += usage.cacheReadInputTokens;
    }

    addStageTokenStats(
      `review-agentic:${this.job.name}`,
      result.num_turns,
      totalInput,
      totalOutput,
      totalCached,
      result.total_cost_usd,
    );

    logger.info(
      `[Agentic] Cost: $${result.total_cost_usd.toFixed(4)} | Turns: ${result.num_turns} | ` +
        `Input: ${totalInput} | Output: ${totalOutput} | Cached: ${totalCached}`,
    );

    for (const [model, usage] of Object.entries(result.modelUsage)) {
      logger.info(
        `[Agentic]   ${model}: $${usage.costUSD.toFixed(4)} (in: ${usage.inputTokens}, out: ${usage.outputTokens})`,
      );
    }
  }

  private logSubagentMetrics(metrics: Record<string, SubagentMetric>): void {
    const entries = Object.values(metrics);
    if (entries.length === 0) return;

    logger.info(`[Agentic] Subagent summary:`);
    for (const m of entries) {
      logger.info(
        `[Agentic]   ${m.agentName}: ${m.status || 'unknown'} | ${m.totalTokens || 0} tokens | ${m.toolUses || 0} tools | ${m.durationMs || 0}ms`,
      );
    }
  }

  private applySubagentOverrides(agents: Record<string, AgentDefinition>): void {
    const overrides = this.config.subagentOverrides;
    if (!overrides) return;

    for (const [name, override] of Object.entries(overrides)) {
      if (!agents[name]) continue;

      if (override.prompt) {
        const promptPath = resolve(this.cwd, override.prompt);
        if (existsSync(promptPath)) {
          agents[name].prompt = readFileSync(promptPath, 'utf-8');
          logger.info(`[Agentic] Overriding ${name} prompt from ${override.prompt}`);
        } else {
          logger.warn(`[Agentic] Prompt override not found: ${promptPath}`);
        }
      }

      if (override.description) agents[name].description = override.description;
      if (override.model) agents[name].model = override.model as AgentDefinition['model'];
      if (override.tools) agents[name].tools = override.tools;
      if (override.disallowedTools) agents[name].disallowedTools = override.disallowedTools;
      if (override.maxTurns) agents[name].maxTurns = override.maxTurns;
    }
  }

  private buildSystemPrompt(allAgents: Record<string, AgentDefinition>): string {
    if (this.config.coordinatorPrompt) {
      const promptPath = resolve(this.cwd, this.config.coordinatorPrompt);
      if (existsSync(promptPath)) {
        logger.info(`[Agentic] Using coordinator prompt from ${this.config.coordinatorPrompt}`);
        return readFileSync(promptPath, 'utf-8');
      }
      logger.warn(`[Agentic] Coordinator prompt not found: ${promptPath}, using default`);
    }

    const customPrompt = this.config.systemPrompt || '';
    const agentList = Object.entries(allAgents)
      .map(([name, def]) => `- **${name}**: ${def.description}`)
      .join('\n');

    return `You are a code review coordinator. Your job is to analyze changed files and delegate specialized analysis to subagents.

## Available Subagents

You have access to specialized agents via the Agent tool:

${agentList}

## Process

1. **Analyze the diffs** — understand what changed and categorize the changes
2. **Decide which agents are relevant** — skip agents that have nothing to review (e.g., skip security-analyzer for pure CSS/style changes, skip dependency-tracer for isolated single-file changes)
3. **Delegate** — invoke each relevant agent via the Agent tool. Tell each agent which files to focus on and what to look for. Include the file diffs/content in your delegation prompt.
4. **Synthesize** — collect all agent findings, remove obvious duplicates, rank by severity

## Rules

- Only invoke agents that are relevant to the changes
- Each agent returns issues as JSON — include their findings in your output
- If agents find overlapping issues, keep the higher-confidence one
- If no agents are relevant (trivial change), return an empty issues array
- Focus on changed code, not pre-existing issues
- Minimum confidence: 7

${customPrompt ? `## Additional Instructions\n\n${customPrompt}` : ''}`;
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

    return `Review the following ${files.length} changed files. Delegate analysis to the appropriate subagents.

${fileContexts.join('\n\n---\n\n')}`;
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

  private parseIssuesFromText(text: string, files: FileInfo[]): ReviewIssue[] {
    const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const jsonStr = jsonMatch[1] || jsonMatch[0];

    try {
      const parsed = JSON.parse(jsonStr);
      const issueArray = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.issues)
          ? parsed.issues
          : [];

      return issueArray
        .filter((issue: RawIssue) => (issue.confidence || 0) >= 7)
        .map((issue: RawIssue, index: number) => this.normalizeIssue(issue, index, files));
    } catch {
      return [];
    }
  }

  private normalizeIssue(issue: RawIssue, index: number, files: FileInfo[]): ReviewIssue {
    const location = this.parseLocation(issue.location || '');
    const file = location.file || files[0]?.path || 'unknown';
    type IssueType = ReviewIssue['type'];
    type IssueSeverity = ReviewIssue['severity'];

    return {
      id: `agentic-${this.job.name}-${Date.now()}-${index}`,
      file,
      type: (issue.type as IssueType) || 'maintainability',
      severity: (issue.severity as IssueSeverity) || 'medium',
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

    const match = location.match(/^(.+?):(\d+)/);
    if (match) {
      return { file: match[1], line: parseInt(match[2], 10) };
    }

    const lineMatch = location.match(/line:?\s*(\d+)/i);
    if (lineMatch) {
      return { line: parseInt(lineMatch[1], 10) };
    }

    return {};
  }

  private calculatePriority(severity?: string): number {
    const priorities: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };
    return priorities[severity || 'medium'] || 3;
  }
}
