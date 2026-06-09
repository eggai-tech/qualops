import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { AIFactory } from '@/ai/providers/factory';
import type { AIProvider } from '@/ai/providers/provider';
import { AgenticExecutor } from '@/stages/review/agentic/agentic-executor';
import { FileReviewer } from '@/stages/review/processors/file-reviewer';
import { PipelineExecutor } from '@/stages/review/processors/pipeline-executor';
import { setCurrentSession } from '@/shared/runtime/session-context';
import { ConfigLoader } from '@/stages/review/loaders/config-loader';
import { ConfigService, defaultModelForProvider } from '@/config/config';
import type { ReviewIssue } from '@/shared/types';
import type { FileInfo, PipelineJob } from '@/shared/types/config';

import type { EvalCase, EvalConfig, DetectedIssue, ReviewResult } from './types.js';

const QUALOPS_ROOT = join(__dirname, '../../..');

// Allowed base directories for agentic cwd. config.cwd must resolve to one of these prefixes.
const ALLOWED_CWD_PREFIXES = [QUALOPS_ROOT];

/**
 * Resolve and validate a cwd value for the agentic executor.
 * Prevents path traversal by asserting the resolved path starts with an allowed prefix.
 * Falls back to QUALOPS_ROOT if cwd is not provided.
 */
function resolveSafeCwd(cwd: string | undefined): string {
  const resolved = resolve(cwd || QUALOPS_ROOT);
  const allowed = ALLOWED_CWD_PREFIXES.some((prefix) => resolved === prefix || resolved.startsWith(prefix + '/'));
  if (!allowed) {
    throw new Error(`Unsafe cwd rejected: "${resolved}" is outside allowed directories`);
  }
  return resolved;
}

const DEFAULT_SYSTEM_PROMPT_PATH = join(
  QUALOPS_ROOT,
  '.qualops/prompts/qualops-self-review/review-system-message.md',
);

/**
 * Load a qualopsrc preset config file. Resets both ConfigService and
 * ConfigLoader so all downstream code reads from the preset.
 * Rejects paths outside the project root to prevent reading arbitrary files.
 */
function loadPresetConfig(configPath: string): void {
  const resolved = resolve(configPath);
  if (resolved !== QUALOPS_ROOT && !resolved.startsWith(QUALOPS_ROOT + '/')) {
    throw new Error(`Unsafe configPath rejected: "${resolved}" is outside the project root`);
  }
  ConfigService.setConfigPath(configPath);
  ConfigLoader.getInstance().reset();
}

export async function runReview(
  evalCase: EvalCase,
  config: EvalConfig,
): Promise<ReviewResult> {
  if (config.configPath) loadPresetConfig(config.configPath);

  const start = Date.now();

  const fileInfo = evalCaseToFileInfo(evalCase);
  let rawIssues: ReviewIssue[];

  if (config.mode === 'pipeline') {
    rawIssues = await runPipelineReview([fileInfo], config);
  } else if (config.mode === 'agentic') {
    rawIssues = await runAgenticReview([fileInfo], config);
  } else {
    rawIssues = await runFileByFileReview(fileInfo, config);
  }

  const issues: DetectedIssue[] = rawIssues.map((issue) => ({
    file: issue.file,
    line: parseLineNumber(issue.location),
    type: issue.type,
    severity: issue.severity,
    description: issue.description,
    confidence: issue.confidence ?? 0,
  }));

  return {
    issues,
    durationMs: Date.now() - start,
  };
}

export async function runReviewMultiFile(
  files: FileInfo[],
  config: EvalConfig,
): Promise<ReviewResult> {
  if (config.configPath) loadPresetConfig(config.configPath);

  const start = Date.now();

  let rawIssues: ReviewIssue[];

  if (config.mode === 'pipeline') {
    rawIssues = await runPipelineReview(files, config);
  } else if (config.mode === 'agentic') {
    rawIssues = await runAgenticReview(files, config);
  } else {
    rawIssues = [];
    for (const file of files) {
      rawIssues.push(...await runFileByFileReview(file, config));
    }
  }

  const issues: DetectedIssue[] = rawIssues.map((issue) => ({
    file: issue.file,
    line: parseLineNumber(issue.location),
    type: issue.type,
    severity: issue.severity,
    description: issue.description,
    confidence: issue.confidence ?? 0,
  }));

  return {
    issues,
    durationMs: Date.now() - start,
  };
}

async function runFileByFileReview(
  fileInfo: FileInfo,
  config: EvalConfig,
): Promise<ReviewIssue[]> {
  const provider = await createProvider(config);
  assertStructuredProvider(provider, config.model);
  const systemPrompt = loadSystemPrompt();
  const reviewer = new FileReviewer(provider, systemPrompt, 'eval');
  return reviewer.reviewFile(fileInfo);
}

// Same code path as `qualops review`, minus git analysis and report/judge.
async function runPipelineReview(
  files: FileInfo[],
  config: EvalConfig,
): Promise<ReviewIssue[]> {
  const sessionName = `eval-pipeline-${Date.now()}`;
  const sessionDir = join(tmpdir(), 'qualops-eval-sessions', sessionName);
  mkdirSync(sessionDir, { recursive: true });
  setCurrentSession(sessionName, join(tmpdir(), 'qualops-eval-sessions'));

  ConfigLoader.getInstance().reset();

  const provider = await createProvider(config);
  assertStructuredProvider(provider, config.model);
  const executor = new PipelineExecutor(provider);
  return executor.execute(files);
}

async function runAgenticReview(
  files: FileInfo[],
  config: EvalConfig,
): Promise<ReviewIssue[]> {
  const configuredJobs = ConfigLoader.getInstance().getEnabledJobs();
  const agenticJobs = configuredJobs.filter((j) => j.job.mode === 'agentic');

  const jobsToRun: PipelineJob[] = agenticJobs.length > 0
    ? agenticJobs.map((j) => j.job)
    : [{
        name: 'eval-agentic',
        enabled: true,
        mode: 'agentic',
        agentic: {
          maxTurns: 50,
          maxBudgetUsd: 5.0,
          contextMode: 'auto',
        },
        passes: [],
      }];

  const cwd = resolveSafeCwd(config.cwd);
  const allIssues: ReviewIssue[] = [];
  for (const job of jobsToRun) {
    const executor = new AgenticExecutor(job, cwd, config.model || defaultModelForProvider(config.provider));
    const issues = await executor.execute(files);
    allIssues.push(...issues);
  }
  return allIssues;
}

function evalCaseToFileInfo(evalCase: EvalCase): FileInfo {
  const diff = parseDiffLines(evalCase.diff);

  return {
    path: evalCase.filePath,
    content: evalCase.fullContent,
    diff,
    rawDiff: evalCase.diff,
  };
}

function parseDiffLines(
  diffStr: string,
): { additions: Set<number>; deletions: Set<number>; modifications: Set<number> } {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  const modifications = new Set<number>();

  if (!diffStr) {
    return { additions, deletions, modifications };
  }

  let newLineNumber = 0;

  for (const line of diffStr.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      newLineNumber = parseInt(hunkMatch[1], 10);
      continue;
    }

    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions.add(newLineNumber);
      newLineNumber++;
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions.add(newLineNumber);
    } else if (!line.startsWith('\\')) {
      newLineNumber++;
    }
  }

  return { additions, deletions, modifications };
}

function parseLineNumber(location: string): number {
  const match = location.match(/\d+/);
  return match ? parseInt(match[0], 10) : 1;
}

async function createProvider(config: EvalConfig): Promise<AIProvider> {
  if (config.provider || config.model) {
    const configService = ConfigService.getInstance();
    try {
      const resolved = configService.getResolvedStageConfig('review');
      configService.set('ai', {
        ...configService.get('ai'),
        reviewStage: {
          ...resolved,
          ...(config.provider && { provider: config.provider }),
          ...(config.model && { model: config.model }),
        },
      });
    } catch {
      configService.set('ai', {
        reviewStage: {
          provider: config.provider ?? 'anthropic',
          model: config.model || 'claude-sonnet-4-6',
          inputPerMillion: 0,
          outputPerMillion: 0,
        },
      });
    }
    AIFactory.clear();
  }

  return AIFactory.createForStage('review');
}

function assertStructuredProvider(provider: AIProvider, model: string | undefined): void {
  if (provider.isUnstructured()) {
    throw new Error(
      `Model "${model ?? 'default'}" uses the unstructured (prose) pipeline and is not ` +
        `compatible with structured evals. Use a model that supports JSON schema output ` +
        `(e.g. gpt-4o, claude-sonnet-4-6, mistral-large).`,
    );
  }
}

function loadSystemPrompt(): string {
  try {
    return readFileSync(DEFAULT_SYSTEM_PROMPT_PATH, 'utf-8');
  } catch {
    throw new Error(
      `System prompt not found at ${DEFAULT_SYSTEM_PROMPT_PATH}. ` +
        'Ensure .qualops/prompts/qualops-self-review/review-system-message.md exists.',
    );
  }
}
