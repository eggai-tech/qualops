import { readFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

import { AnthropicProvider } from '@/ai/providers/anthropic';
import { OpenAIProvider } from '@/ai/providers/openai';
import { BedrockProvider } from '@/ai/providers/bedrock';
import type { AIProvider } from '@/ai/providers/provider';
import { FileReviewer } from '@/stages/review/processors/file-reviewer';
import { PipelineExecutor } from '@/stages/review/processors/pipeline-executor';
import { setCurrentSession } from '@/shared/runtime/session-context';
import { ConfigLoader } from '@/stages/review/loaders/config-loader';
import { ConfigService } from '@/config/config';
import type { ReviewIssue } from '@/shared/types';
import type { AIStageConfig } from '@/shared/types';
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
  const executor = new PipelineExecutor(provider);
  return executor.execute(files);
}

// Only works with anthropic provider (requires Claude Agent SDK).
async function runAgenticReview(
  files: FileInfo[],
  config: EvalConfig,
): Promise<ReviewIssue[]> {
  if (config.provider && config.provider !== 'anthropic') {
    throw new Error(
      `Agentic mode requires anthropic provider, got: ${config.provider}. ` +
        'The Claude Agent SDK only supports Anthropic models.',
    );
  }

  // Try to load an agentic job from the qualopsrc config
  const configuredJobs = ConfigLoader.getInstance().getEnabledJobs();
  const agenticJob = configuredJobs.find((j) => j.mode === 'agentic');

  const job: PipelineJob = agenticJob || {
    name: 'eval-agentic',
    enabled: true,
    mode: 'agentic',
    agentic: {
      maxTurns: 50,
      maxBudgetUsd: 5.0,
      contextMode: 'auto',
    },
    passes: [],
  };

  const { AgenticExecutor } = await import('@/stages/review/agentic/agentic-executor');
  const cwd = resolveSafeCwd(config.cwd);

  // Resolve model: CLI override > qualopsrc > undefined (SDK default)
  let model = config.model;
  if (!model) {
    try {
      model = ConfigService.getInstance().getAIStageConfig('review').model;
    } catch {
      // catch is required because createProvider crashes when no .qualopsrc.json exists
      // The config-missing warning is already emitted by ConfigService.loadRawConfig
      // this get's run for every eval
    }
  }

  const executor = new AgenticExecutor(job, cwd, model);
  return executor.execute(files);
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
  // Use AI config from qualopsrc if loaded, with EvalConfig as override
  let stageConfig: AIStageConfig;
  try {
    const fromRc = ConfigService.getInstance().getAIStageConfig('review');
    stageConfig = {
      ...fromRc,
      provider: config.provider ?? fromRc.provider,
      model: config.model || fromRc.model,
    };
  } catch {
    stageConfig = {
      provider: config.provider ?? 'anthropic',
      model: config.model || 'claude-sonnet-4-6',
      inputPerMillion: 0,
      outputPerMillion: 0,
      temperature: 0,
    };
  }

  let provider: AIProvider;

  switch (stageConfig.provider) {
    case 'anthropic':
      provider = new AnthropicProvider(stageConfig);
      break;
    case 'openai':
      provider = new OpenAIProvider(stageConfig);
      break;
    case 'bedrock':
      provider = new BedrockProvider(stageConfig);
      break;
    default:
      throw new Error(`Unknown provider: ${stageConfig.provider}`);
  }

  await provider.initialize();
  return provider;
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
