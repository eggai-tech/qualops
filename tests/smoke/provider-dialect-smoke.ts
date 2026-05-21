#!/usr/bin/env tsx
/**
 * Provider-dialect smoke test for the 4 AI caller stages migrated in PR #145.
 *
 * Exercises each migrated stage (file-reviewer, validation-resolver, dedup-resolver,
 * root-cause-extract) against each real provider (anthropic, openai, bedrock, github)
 * using one tiny dataset entry as input. Validates plumbing only — that the structured-
 * output dialect path returns a zod-validated response without throwing. Output quality
 * is intentionally out of scope; that is covered by the per-stage golden evals follow-up.
 *
 * Not a Jest spec. Real provider calls cost money, so this runs as a standalone tsx
 * script via `npm run test:smoke`, gated on API key env vars, with a dedicated CI lane.
 *
 * Usage:
 *   npm run test:smoke                                       # all 4 providers, defaults
 *   npm run test:smoke -- --providers=anthropic              # subset
 *   npm run test:smoke -- --providers=anthropic,openai
 *   npm run test:smoke -- --model=claude-sonnet-4-6          # override model per provider
 *   npm run test:smoke -- --input=evals/datasets/typescript-bugs.jsonl:1
 *
 * Exit code: 0 if every attempted stage × provider call passed (or was skipped for
 * missing credentials); 1 if any attempted call failed.
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AIFactory, clearGlobalAIProvider } from '@/ai/providers';
import { AnthropicProvider } from '@/ai/providers/anthropic';
import { BedrockProvider } from '@/ai/providers/bedrock';
import { GitHubModelsProvider } from '@/ai/providers/github';
import { OpenAIProvider } from '@/ai/providers/openai';
import type { AIProvider } from '@/ai/providers/provider';
import { ConfigService } from '@/config/config';
import { envConfig } from '@/config/env';
import {
  getCurrentSessionPaths,
  sessionContext,
  setCurrentSession,
} from '@/shared/runtime/session-context';
import type {
  FileInfo,
  PipelineJob,
  ReviewConfig,
  ReviewIssue,
  ResolvedStageConfig,
} from '@/shared/types';
import { DeduplicationResolver } from '@/stages/review/processors/dedup-resolver';
import { FileReviewer } from '@/stages/review/processors/file-reviewer';
import { ValidationResolver } from '@/stages/review/processors/validation-resolver';
import { extractRootCauses } from '@/stages/root-cause-extract';

// run-log is shared CommonJS in evals/; reuse it instead of duplicating the format.

const { classifyError, createRunLog } = require('../../evals/src/run-log');

const PROVIDERS = ['anthropic', 'openai', 'bedrock', 'github'] as const;
type ProviderName = (typeof PROVIDERS)[number];
const STAGES = [
  'file-reviewer',
  'validation-resolver',
  'dedup-resolver',
  'root-cause-extract',
] as const;
type StageName = (typeof STAGES)[number];

const PROVIDER_DEFAULTS: Record<
  ProviderName,
  { model: string; inputPerMillion: number; outputPerMillion: number }
> = {
  anthropic: { model: 'claude-sonnet-4-6', inputPerMillion: 3, outputPerMillion: 15 },
  openai: { model: 'gpt-4o-mini', inputPerMillion: 0.15, outputPerMillion: 0.6 },
  bedrock: {
    model: 'us.anthropic.claude-sonnet-4-6-v1:0',
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
  github: { model: 'gpt-4o-mini', inputPerMillion: 0, outputPerMillion: 0 },
};

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const TMP_ROOT = path.join(PROJECT_ROOT, 'tests', 'smoke', '.tmp');
const PROJECT_PROMPTS_DIR = path.join(PROJECT_ROOT, '.qualops', 'prompts');
const SMOKE_VALIDATION_PROMPT = '_smoke-validation.md';
const SMOKE_DEDUP_PROMPT = '_smoke-dedup.md';
const DEFAULT_INPUT = 'evals/datasets/typescript-bugs.jsonl:1';

interface DatasetEntry {
  id: string;
  filePath: string;
  fullContent: string;
  diff?: string;
}

interface CliArgs {
  providers: ProviderName[];
  model?: string;
  input: string;
}

function parseArgs(argv: string[]): CliArgs {
  const out: Record<string, string> = {};
  for (const a of argv) {
    if (!a.startsWith('--')) continue;
    const [k, v] = a.slice(2).split('=');
    out[k] = v ?? 'true';
  }
  const providers = out.providers
    ? out.providers
        .split(',')
        .filter((p): p is ProviderName => (PROVIDERS as readonly string[]).includes(p))
    : [...PROVIDERS];
  return { providers, model: out.model, input: out.input ?? DEFAULT_INPUT };
}

/**
 * Decides whether to *attempt* a provider. Checks only env-var presence — format
 * validation is deferred to each provider's validateApiKey()/validateConfiguration()
 * (anthropic.ts, openai.ts, github.ts), so a malformed-but-present key surfaces as a
 * real failure with a classified errorCode rather than being silently skipped.
 *
 * Env-var names match what `src/config/env.ts` reads at runtime, which in turn matches
 * the GitHub Actions repo-secret names the workflow exposes.
 */
function providerHasCredentials(provider: ProviderName): { available: boolean; reason?: string } {
  switch (provider) {
    case 'anthropic':
      return envConfig.get('anthropicApiKey')
        ? { available: true }
        : { available: false, reason: 'ANTHROPIC_API_KEY missing' };
    case 'openai':
      return envConfig.get('openaiApiKey')
        ? { available: true }
        : { available: false, reason: 'OPENAI_API_KEY missing' };
    case 'bedrock': {
      const region = envConfig.get('awsRegion');
      const id = envConfig.get('awsAccessKeyId');
      const secret = envConfig.get('awsSecretAccessKey');
      return region && id && secret
        ? { available: true }
        : {
            available: false,
            reason:
              'AWS credentials incomplete (AWS_REGION/AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY)',
          };
    }
    case 'github':
      return envConfig.get('githubApiKey')
        ? { available: true }
        : { available: false, reason: 'GITHUB_API_KEY missing' };
  }
}

async function loadDatasetEntry(input: string): Promise<DatasetEntry> {
  const [filePathRaw, lineRaw] = input.split(':');
  const line = lineRaw ? parseInt(lineRaw, 10) : 1;
  const abs = path.isAbsolute(filePathRaw) ? filePathRaw : path.join(PROJECT_ROOT, filePathRaw);
  const text = await readFile(abs, 'utf-8');
  const lines = text.split('\n').filter((l) => l.trim().length > 0);
  if (line < 1 || line > lines.length) {
    throw new Error(`Dataset line ${line} out of range (1..${lines.length}) for ${abs}`);
  }
  const parsed = JSON.parse(lines[line - 1]);
  if (!parsed.filePath || !parsed.fullContent) {
    throw new Error(`Dataset entry at ${abs}:${line} missing filePath or fullContent`);
  }
  return parsed as DatasetEntry;
}

function buildResolvedStageConfig(
  provider: ProviderName,
  modelOverride?: string,
): ResolvedStageConfig {
  const d = PROVIDER_DEFAULTS[provider];
  return {
    provider,
    model: modelOverride ?? d.model,
    inputPerMillion: d.inputPerMillion,
    outputPerMillion: d.outputPerMillion,
    temperature: 0,
  };
}

async function buildProvider(provider: ProviderName, modelOverride?: string): Promise<AIProvider> {
  const cfg = buildResolvedStageConfig(provider, modelOverride);
  let instance: AIProvider;
  switch (provider) {
    case 'anthropic':
      instance = new AnthropicProvider(cfg);
      break;
    case 'openai':
      instance = new OpenAIProvider(cfg);
      break;
    case 'bedrock':
      instance = new BedrockProvider(cfg);
      break;
    case 'github':
      instance = new GitHubModelsProvider(cfg);
      break;
  }
  await instance.initialize();
  return instance;
}

async function writeProviderConfigFile(
  provider: ProviderName,
  modelOverride?: string,
): Promise<string> {
  const d = PROVIDER_DEFAULTS[provider];
  const cfg = {
    ai: {
      reviewStage: {
        provider,
        model: modelOverride ?? d.model,
        inputPerMillion: d.inputPerMillion,
        outputPerMillion: d.outputPerMillion,
        temperature: 0,
      },
    },
    review: {
      // root-cause-extract reads only ai.reviewStage; the pipeline is required by schema
      // but otherwise unused here. Agentic mode has optional passes — minimal valid shape.
      pipeline: [{ name: 'smoke', enabled: true, mode: 'agentic' }],
    },
  };
  const fileRel = path.join('tests', 'smoke', '.tmp', `qualopsrc.${provider}.json`);
  const fileAbs = path.join(PROJECT_ROOT, fileRel);
  await mkdir(path.dirname(fileAbs), { recursive: true });
  await writeFile(fileAbs, JSON.stringify(cfg, null, 2));
  return fileRel;
}

function buildFileInfo(entry: DatasetEntry): FileInfo {
  return { path: entry.filePath, content: entry.fullContent };
}

// Agentic mode is used because its `passes` field is optional — the file-by-file
// schema variant requires at least one pass, which the smoke harness has no need to
// supply. The validation/dedup resolvers only read job.validation / job.deduplication
// (see resolveConfig() in each file), so the mode value itself does not matter here.
function buildPipelineJob(): PipelineJob {
  return {
    name: 'smoke',
    enabled: true,
    mode: 'agentic',
    validation: { enabled: true, minConfidence: 0, prompt: SMOKE_VALIDATION_PROMPT },
    deduplication: { enabled: true, prompt: SMOKE_DEDUP_PROMPT },
  };
}

function buildReviewConfig(): ReviewConfig {
  return {
    minConfidence: 0,
    pipeline: [buildPipelineJob()],
  };
}

function seedIssues(filePath: string): ReviewIssue[] {
  const now = Date.now();
  return [
    {
      id: `${filePath}-L6-${now}-a`,
      file: filePath,
      type: 'security',
      severity: 'critical',
      description: 'Smoke seed: potential SQL injection via string interpolation',
      location: '6',
      reasoning: 'String interpolation in SQL query allows injection.',
      suggestion: 'Use parameterized queries.',
      context: 'db.query(`SELECT ... ${userId}`)',
      confidence: 9,
      knowledge_source: 'smoke',
      priority: 1,
      estimatedEffort: 'low',
      tags: ['security', 'critical', 'ts'],
    },
    {
      id: `${filePath}-L6-${now}-b`,
      file: filePath,
      type: 'security',
      severity: 'high',
      description: 'Smoke seed: same SQL injection (duplicate of A)',
      location: '6',
      reasoning: 'Restated finding for dedup exercise.',
      suggestion: 'Parameterize.',
      context: 'db.query template literal',
      confidence: 8,
      knowledge_source: 'smoke',
      priority: 2,
      estimatedEffort: 'low',
      tags: ['security', 'high', 'ts'],
    },
  ] as ReviewIssue[];
}

async function writeSeedIssueMarkdown(issues: ReviewIssue[]): Promise<void> {
  const issuesDir = getCurrentSessionPaths().issues();
  await mkdir(issuesDir, { recursive: true });
  for (const [idx, issue] of issues.entries()) {
    const file = path.join(issuesDir, `${idx + 1}-smoke-seed.md`);
    const md = `# ${issue.description}

**Severity**: ${issue.severity}
**Category**: ${issue.type}

## Reasoning
${issue.reasoning ?? ''}
`;
    await writeFile(file, md);
  }
}

async function setupSmokeArtifacts(): Promise<{
  systemPrompt: string;
  cleanup: () => Promise<void>;
}> {
  await mkdir(PROJECT_PROMPTS_DIR, { recursive: true });
  await mkdir(TMP_ROOT, { recursive: true });

  const validationPromptPath = path.join(PROJECT_PROMPTS_DIR, SMOKE_VALIDATION_PROMPT);
  const dedupPromptPath = path.join(PROJECT_PROMPTS_DIR, SMOKE_DEDUP_PROMPT);

  const validationPrompt = `You are validating code review findings. For each issue below, decide if it is a true positive.

Return a JSON array. Each item has: index (number, matching the input), is_false_positive (boolean), confidence (1-10), severity (critical|high|medium|low), reasoning (short string).
`;
  const dedupPrompt = `You are deduplicating code review findings for a single file.

Return the JSON array of indices to KEEP after removing duplicates.
`;

  const validationExisted = existsSync(validationPromptPath);
  const dedupExisted = existsSync(dedupPromptPath);
  if (!validationExisted) await writeFile(validationPromptPath, validationPrompt);
  if (!dedupExisted) await writeFile(dedupPromptPath, dedupPrompt);

  let systemPrompt: string;
  const bundled = path.join(PROJECT_ROOT, 'src', 'config', 'prompts', 'review', 'quality.md');
  if (existsSync(bundled)) {
    systemPrompt = await readFile(bundled, 'utf-8');
  } else {
    systemPrompt =
      'You are a code reviewer. Return findings as a JSON array per the provided schema.';
  }

  const cleanup = async () => {
    if (!validationExisted) await rm(validationPromptPath, { force: true });
    if (!dedupExisted) await rm(dedupPromptPath, { force: true });
    await rm(TMP_ROOT, { recursive: true, force: true });
  };

  return { systemPrompt, cleanup };
}

interface RunResult {
  status: 'pass' | 'fail';
  durationMs: number;
  errorCode?: string;
  errorMessage?: string;
  model: string;
}

async function runStage(model: string, fn: () => Promise<void>): Promise<RunResult> {
  const started = Date.now();
  try {
    await fn();
    return { status: 'pass', durationMs: Date.now() - started, model };
  } catch (err) {
    const error = err as Error;
    return {
      status: 'fail',
      durationMs: Date.now() - started,
      errorCode: classifyError(error),
      errorMessage: error.message,
      model,
    };
  }
}

async function runProviderMatrix(
  provider: ProviderName,
  args: CliArgs,
  entry: DatasetEntry,
  systemPrompt: string,
  runLog: { add: (e: Record<string, unknown>) => void },
  sessionRoot: string,
): Promise<{ attempted: number; failed: number }> {
  const file = buildFileInfo(entry);
  const reviewConfig = buildReviewConfig();
  const job = buildPipelineJob();

  let aiProvider: AIProvider;
  try {
    aiProvider = await buildProvider(provider, args.model);
  } catch (err) {
    const error = err as Error;
    for (const stage of STAGES) {
      runLog.add({
        level: 'error',
        event: 'stage_failed',
        stage,
        provider,
        status: 'fail',
        errorCode: classifyError(error),
        message: `provider init failed: ${error.message}`,
      });
    }
    return { attempted: STAGES.length, failed: STAGES.length };
  }
  const model = aiProvider.getModelName();

  let attempted = 0;
  let failed = 0;
  const record = (stage: StageName, result: RunResult) => {
    attempted += 1;
    if (result.status === 'fail') failed += 1;
    runLog.add({
      level: result.status === 'pass' ? 'info' : 'error',
      event: result.status === 'pass' ? 'item_complete' : 'stage_failed',
      stage,
      provider,
      status: result.status,
      durationMs: result.durationMs,
      model: result.model,
      ...(result.errorCode ? { errorCode: result.errorCode } : {}),
      ...(result.errorMessage ? { message: result.errorMessage } : {}),
    });
  };

  // Stage 1: file-reviewer (constructor injection)
  let observedIssues: ReviewIssue[] = [];
  const fileReviewerResult = await runStage(model, async () => {
    const reviewer = new FileReviewer(aiProvider, systemPrompt, 'smoke');
    observedIssues = await reviewer.reviewFile(file);
  });
  record('file-reviewer', fileReviewerResult);

  // Synthetic seeding so downstream stages always have non-empty input.
  const seeded = seedIssues(entry.filePath);
  const issuesForValidation = observedIssues.length > 0 ? [...observedIssues, ...seeded] : seeded;

  // Stage 2: validation-resolver
  let validatedIssues: ReviewIssue[] = issuesForValidation;
  const validationResult = await runStage(model, async () => {
    const resolver = new ValidationResolver(reviewConfig, aiProvider);
    validatedIssues = await resolver.validate(issuesForValidation, job);
  });
  record('validation-resolver', validationResult);

  // Stage 3: dedup-resolver
  const issuesForDedup = validatedIssues.length >= 2 ? validatedIssues : seeded;
  const dedupResult = await runStage(model, async () => {
    const resolver = new DeduplicationResolver(reviewConfig, aiProvider);
    await resolver.deduplicate(issuesForDedup, job);
  });
  record('dedup-resolver', dedupResult);

  // Stage 4: root-cause-extract — uses AIFactory internally; swap config + clear cache.
  // The stage swallows provider errors and returns synthetic "other" classifications,
  // so we cross-check token stats post-call to surface silent failures as real fails.
  const rootCauseResult = await runStage(model, async () => {
    const tempConfigPath = await writeProviderConfigFile(provider, args.model);
    ConfigService.setConfigPath(tempConfigPath);
    AIFactory.clear();
    clearGlobalAIProvider();

    setCurrentSession('smoke-session', sessionRoot);
    await writeSeedIssueMarkdown(seeded);

    const metadata = await extractRootCauses();
    const factoryProvider = await AIFactory.createForStage('review');
    const stats = factoryProvider.getTokenStats();
    if (stats.invocationCount === 0 || stats.totalOutputTokens === 0) {
      throw new Error(
        `root-cause-extract: provider returned no output tokens (invocations=${stats.invocationCount}, outputTokens=${stats.totalOutputTokens}) — likely a silent API failure`,
      );
    }
    const classifications = Object.values(metadata.classifications);
    if (
      classifications.length > 0 &&
      classifications.every((c) => c.rootCause === 'other' && c.confidence === 0)
    ) {
      throw new Error(
        'root-cause-extract: all classifications fell back to "other" with confidence 0 — provider call likely failed silently',
      );
    }
  });
  record('root-cause-extract', rootCauseResult);

  return { attempted, failed };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const startedAt = new Date();
  const experimentName = `smoke_${startedAt.toISOString().replace(/[:.]/g, '-')}`;

  // Session root must live under .qualops/reports/ (enforced by buildSessionPath).
  const sessionRoot = path.join(PROJECT_ROOT, '.qualops', 'reports', `.smoke-${process.pid}`);
  await mkdir(sessionRoot, { recursive: true });

  const entry = await loadDatasetEntry(args.input);
  const { systemPrompt, cleanup } = await setupSmokeArtifacts();

  const runLog = createRunLog({
    experimentName,
    presetLabel: 'smoke',
    configPath: '',
    model: args.model ?? '',
    mode: 'smoke',
    provider: args.providers.join(','),
  });

  let totalAttempted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  try {
    for (const provider of args.providers) {
      const creds = providerHasCredentials(provider);
      if (!creds.available) {
        totalSkipped += STAGES.length;
        for (const stage of STAGES) {
          runLog.add({
            level: 'warn',
            event: 'provider_skipped',
            warnCode: 'NO_CREDENTIALS',
            stage,
            provider,
            status: 'skip',
            message: creds.reason,
          });
        }

        console.warn(`[smoke] skip ${provider}: ${creds.reason}`);
        continue;
      }

      console.log(`[smoke] running ${provider}…`);
      const { attempted, failed } = await runProviderMatrix(
        provider,
        args,
        entry,
        systemPrompt,
        runLog,
        sessionRoot,
      );
      totalAttempted += attempted;
      totalFailed += failed;
    }
  } finally {
    await cleanup();
    await rm(sessionRoot, { recursive: true, force: true });
    sessionContext.reset();
    AIFactory.clear();
    clearGlobalAIProvider();
  }

  const logFile = runLog.write();

  console.log(
    `[smoke] done — attempted=${totalAttempted} failed=${totalFailed} skipped=${totalSkipped} log=${logFile}`,
  );

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('[smoke] fatal:', err);
  process.exit(2);
});
