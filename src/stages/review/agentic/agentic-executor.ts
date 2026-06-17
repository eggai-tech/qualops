import { context } from '@opentelemetry/api';

import { createAgentAdapter } from './adapters';
import type { AgentErrorSubtype } from './adapters/agent-adapter';
import { AgentLoader } from './loaders/agent-loader';
import { buildUserPrompt } from './prompt-builder';
import { normalizeIssue, parseIssuesFromResult } from './result-parser';
import {
  createSubagentDefinitions,
  type AgentDefinition,
  type ResolvedAgentDefinition,
} from './subagents/definitions';
import { detectCapabilities } from '../../../ai/providers/capabilities';
import { ConfigService } from '../../../config/config';
import {
  getTracer,
  setAgenticSpanAttributes,
  setAgenticTurns,
  setObservationIO,
  setTokenUsage,
} from '../../../observability';
import type { ReviewIssue, ResolvedStageConfig } from '../../../shared/types';
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
  private model: string;
  private agentLoader: AgentLoader;

  constructor(job: PipelineJob, cwd: string | undefined, model: string) {
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

    const builtInAgents = createSubagentDefinitions(this.config);
    const customAgents = this.agentLoader.loadCustomAgents(this.config);

    // Merge all agents (custom agents can override built-in) then apply model overrides
    const mergedAgents: Record<string, AgentDefinition> = { ...builtInAgents, ...customAgents };
    const allAgents = this.applyModelOverrides(mergedAgents);

    const agentNames = Object.keys(allAgents);
    logger.info(`[Agentic] Available agents: ${agentNames.join(', ')}`);
    logger.info(`[Agentic] Custom agents: ${Object.keys(customAgents).join(', ') || 'none'}`);

    const systemPrompt = await this.buildSystemPrompt(allAgents);
    const userPrompt = buildUserPrompt(files, this.config);

    const issues: ReviewIssue[] = [];
    const tracer = getTracer();
    const reviewCtx = context.active();
    // startSpan (not startActiveSpan) is intentional: the async generator requires
    // manually captured context; propagating via startActiveSpan would not work correctly here.
    const agenticSpan = tracer.startSpan('agentic', {}, reviewCtx);
    setAgenticSpanAttributes(agenticSpan, {
      model: this.model,
      jobName: this.job.name,
      config: this.config,
    });

    const allToolCalls: { turn: number; name: string; input: unknown }[] = [];
    let turnIndex = 0;

    try {
      const stageConfig = ConfigService.getInstance().getResolvedStageConfig('review');
      const { structuredDialect } = detectCapabilities(stageConfig.provider, this.model);
      const adapter = createAgentAdapter(stageConfig.provider);

      logger.info(
        `[Agentic] Using adapter for provider: ${stageConfig.provider}, structuredDialect: ${structuredDialect}`,
      );

      const result = await adapter.run({
        systemPrompt,
        userPrompt,
        agents: allAgents,
        model: this.model,
        cwd: this.cwd,
        maxTurns: this.config.maxTurns || 100,
        maxBudgetUsd: this.config.maxBudgetUsd,
        skipPatterns: ConfigService.getInstance().get('skipPatterns') ?? [],
        toolConfig: {
          bash: {
            ...this.config.bash,
            workspaceRoot: this.config.bash?.workspaceRoot ?? this.cwd,
          },
        },
        baseUrl: stageConfig.baseUrl,
        structuredDialect,
        onToolCall: (turn, name, input) => {
          turnIndex = turn;
          allToolCalls.push({ turn, name, input });
        },
      });

      setTokenUsage(agenticSpan, {
        model: this.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
      });
      setObservationIO(agenticSpan, {
        input: { systemPrompt, userPrompt, toolCalls: allToolCalls },
        output: result.errorSubtype ? { error: result.errorSubtype } : result.output,
      });

      // Hard failures: errors where the response cannot be trusted even partially.
      // Add new unrecoverable error subtypes here.
      const HARD_FAILURES = new Set<AgentErrorSubtype>([
        'error_rate_limit_tokens',
        'error_max_tokens',
      ]);

      if (result.errorSubtype && HARD_FAILURES.has(result.errorSubtype)) {
        throw new Error(
          `[Agentic] Job "${this.job.name}" failed: ${result.errorSubtype}. ` +
            `Reduce the number of files reviewed per job or check your model configuration.`,
        );
      }

      if (result.errorSubtype) {
        logger.warn(
          `[Agentic] Job "${this.job.name}" completed with error: ${result.errorSubtype}`,
        );
      }

      if (result.structuredOutput !== undefined) {
        const rawIssues = Array.isArray(result.structuredOutput) ? result.structuredOutput : [];
        const parsed = (rawIssues as Record<string, unknown>[])
          .filter((i) => ((i?.confidence as number) ?? 0) >= 7)
          .map((i, idx) => normalizeIssue(i, idx, files, this.job.name, this.cwd));
        issues.push(...parsed);
        logger.info(`[Agentic] Parsed ${parsed.length} issues from structured output`);
      } else if (result.output) {
        logger.info(`[Agentic] Result (first 500 chars): ${result.output.substring(0, 500)}`);
        const parsed = parseIssuesFromResult(result.output, files, this.job.name, this.cwd);
        // Only throw when output is non-empty but contains no extractable JSON at all.
        // An empty array [] is a valid model response (no issues found) — not an error.
        const hasJsonContent = result.output.includes('[') || result.output.includes('{');
        if (parsed.length === 0 && result.output.trim().length > 0 && !hasJsonContent) {
          logger.warn(
            `[Agentic] No parseable issues from text output. Raw output preview:\n${result.output.substring(0, 2000)}`,
          );
          throw new Error(
            `[Agentic] Job "${this.job.name}" returned non-empty output but no parseable JSON issues (${result.output.length} chars).`,
          );
        }
        issues.push(...parsed);
        logger.info(`[Agentic] Parsed ${parsed.length} issues from result`);
      } else if (result.errorSubtype) {
        logger.warn(`[Agentic] Job "${this.job.name}" returned no output — review incomplete`);
      }
    } catch (error) {
      logger.error(
        `[Agentic] Execution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      setAgenticTurns(agenticSpan, turnIndex);
      agenticSpan.end();
    }

    logger.info(`[Agentic] Review completed: ${issues.length} total issues`);
    return issues;
  }

  private applyModelOverrides(
    agents: Record<string, AgentDefinition>,
  ): Record<string, ResolvedAgentDefinition> {
    const configService = ConfigService.getInstance();
    let stageConfig: ResolvedStageConfig | undefined;
    try {
      stageConfig = configService.getResolvedStageConfig('review');
    } catch {
      // no review stage config — resolveAgentModel falls back to defaults
    }

    return Object.fromEntries(
      Object.entries(agents).map(([name, def]) => {
        const { model } = configService.resolveAgentModel(name, this.config, stageConfig);
        return [name, { ...def, model }];
      }),
    );
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

    return parts.join('\n\n');
  }
}
