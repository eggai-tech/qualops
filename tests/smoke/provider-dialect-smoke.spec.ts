/**
 * Provider-dialect smoke spec.
 *
 * Automates the unchecked manual smoke item from PR #145's test plan: exercises
 * each of the 4 AI caller stages migrated to native structured output
 * (file-reviewer, validation-resolver, dedup-resolver, root-cause-extract)
 * against each real provider (anthropic, openai, bedrock, github) using a
 * slice fixture as input. Validates plumbing only — the provider-specific
 * dialect path returns a zod-validated response without throwing.
 *
 * Output quality is out of scope and covered by the deferred per-stage
 * golden-evals follow-up.
 *
 * NOT part of the default Jest run. The base `jest.config.js` constrains
 * `roots` to `tests/unit/`, so this file is unreachable from `npm test`.
 * Run via `npm run test:smoke`, which uses `jest.smoke.config.ts`.
 *
 * A provider is **skipped** when its credential env var is missing; a
 * provider with present-but-malformed credentials is **attempted** so
 * misconfigured CI secrets surface as real failures via the provider class's
 * own validateApiKey() / validateConfiguration().
 */

import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { AIFactory, clearGlobalAIProvider } from '@/ai/providers';
import type { AIProvider } from '@/ai/providers/provider';
import { ConfigService, PROVIDER_DEFAULTS } from '@/config/config';
import { envConfig } from '@/config/env';
import { sessionContext, setCurrentSession } from '@/shared/runtime/session-context';
import type { FileInfo, PipelineJob, ReviewConfig, ReviewIssue } from '@/shared/types';
import { DeduplicationResolver } from '@/stages/review/processors/dedup-resolver';
import { FileReviewer } from '@/stages/review/processors/file-reviewer';
import { ValidationResolver } from '@/stages/review/processors/validation-resolver';
import { extractRootCauses } from '@/stages/root-cause-extract';

// ---------------------------------------------------------------------------
// Constants & types
// ---------------------------------------------------------------------------

const PROVIDERS = ['anthropic', 'openai', 'bedrock', 'github'] as const;
type ProviderName = (typeof PROVIDERS)[number];

// GitHub Models is not in src/config/config.ts PROVIDER_DEFAULTS because it is
// not a default-fallback provider for zero-config mode. A smoke-specific default
// is fine; AIFactory still wires it through OpenAICompatibleProvider correctly.
const GITHUB_DEFAULT = { model: 'gpt-4o-mini', inputPerMillion: 0, outputPerMillion: 0 };

const PROJECT_ROOT = path.resolve(__dirname, '..', '..');
const SLICE_DIR = path.join(PROJECT_ROOT, 'evals', 'datasets', 'inbox', 'smoke-sql-injection');
const TMP_DIR = path.join(PROJECT_ROOT, 'tests', 'smoke', '.tmp');
const PROMPTS_DIR = path.join(PROJECT_ROOT, '.qualops', 'prompts');
const SESSION_ROOT = path.join(PROJECT_ROOT, '.qualops', 'reports', `.smoke-${process.pid}`);
const SMOKE_VALIDATION_PROMPT = '_smoke-validation.md';
const SMOKE_DEDUP_PROMPT = '_smoke-dedup.md';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hasCredentials(provider: ProviderName): boolean {
  switch (provider) {
    case 'anthropic':
      return !!envConfig.get('anthropicApiKey');
    case 'openai':
      return !!envConfig.get('openaiApiKey');
    case 'bedrock':
      return !!(
        envConfig.get('awsRegion') &&
        envConfig.get('awsAccessKeyId') &&
        envConfig.get('awsSecretAccessKey')
      );
    case 'github':
      return !!envConfig.get('githubApiKey');
  }
}

function defaultsFor(provider: ProviderName) {
  return provider === 'github' ? GITHUB_DEFAULT : PROVIDER_DEFAULTS[provider];
}

interface SliceFixture {
  filePath: string;
  content: string;
  language: string;
}

async function loadSlice(): Promise<SliceFixture> {
  const slice = JSON.parse(await readFile(path.join(SLICE_DIR, 'slice.json'), 'utf-8'));
  const filePath = slice.filePath as string;
  const content = await readFile(path.join(SLICE_DIR, 'repo', filePath), 'utf-8');
  return { filePath, content, language: slice.language };
}

async function writeProviderConfig(provider: ProviderName): Promise<string> {
  const d = defaultsFor(provider);
  const cfg = {
    ai: {
      reviewStage: {
        provider,
        model: d.model,
        inputPerMillion: d.inputPerMillion,
        outputPerMillion: d.outputPerMillion,
        temperature: 0,
      },
    },
    review: {
      // root-cause-extract reads only ai.reviewStage; the pipeline is required by
      // the config schema but otherwise unused here. Agentic mode has optional
      // `passes` — minimal schema-valid shape.
      pipeline: [{ name: 'smoke', enabled: true, mode: 'agentic' }],
    },
  };
  const fileRel = path.join('tests', 'smoke', '.tmp', `qualopsrc.${provider}.json`);
  const fileAbs = path.join(PROJECT_ROOT, fileRel);
  await mkdir(path.dirname(fileAbs), { recursive: true });
  await writeFile(fileAbs, JSON.stringify(cfg, null, 2));
  return fileRel;
}

async function setupPrompts(): Promise<{ systemPrompt: string; cleanup: () => Promise<void> }> {
  await mkdir(PROMPTS_DIR, { recursive: true });

  const validationPath = path.join(PROMPTS_DIR, SMOKE_VALIDATION_PROMPT);
  const dedupPath = path.join(PROMPTS_DIR, SMOKE_DEDUP_PROMPT);

  const validationPrompt =
    'You are validating code review findings. For each issue below, decide if it is a true positive. ' +
    'Return a JSON array. Each item has: index (number), is_false_positive (boolean), confidence (1-10), ' +
    'severity (critical|high|medium|low), reasoning (short string).\n';
  const dedupPrompt =
    'You are deduplicating code review findings for a single file. ' +
    'Return the JSON array of indices to KEEP after removing duplicates.\n';

  await writeFile(validationPath, validationPrompt);
  await writeFile(dedupPath, dedupPrompt);

  const bundledSystem = path.join(PROJECT_ROOT, 'src', 'config', 'prompts', 'review', 'quality.md');
  const systemPrompt = existsSync(bundledSystem)
    ? await readFile(bundledSystem, 'utf-8')
    : 'You are a code reviewer. Return findings as a JSON array per the provided schema.';

  return {
    systemPrompt,
    cleanup: async () => {
      await rm(validationPath, { force: true });
      await rm(dedupPath, { force: true });
    },
  };
}

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
  return { minConfidence: 0, pipeline: [buildPipelineJob()] };
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
  ];
}

async function writeSeedIssueMarkdown(issues: ReviewIssue[], issuesDir: string): Promise<void> {
  await mkdir(issuesDir, { recursive: true });
  for (const [idx, issue] of issues.entries()) {
    const md = `# ${issue.description}

**Severity**: ${issue.severity}
**Category**: ${issue.type}

## Reasoning
${issue.reasoning ?? ''}
`;
    await writeFile(path.join(issuesDir, `${idx + 1}-smoke-seed.md`), md);
  }
}

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

let slice: SliceFixture;
let file: FileInfo;
let systemPrompt: string;
let cleanupPrompts: () => Promise<void>;

beforeAll(async () => {
  await mkdir(SESSION_ROOT, { recursive: true });
  slice = await loadSlice();
  file = { path: slice.filePath, content: slice.content };
  const setup = await setupPrompts();
  cleanupPrompts = setup.cleanup;
  systemPrompt = setup.systemPrompt;
});

afterAll(async () => {
  await cleanupPrompts();
  await rm(TMP_DIR, { recursive: true, force: true });
  await rm(SESSION_ROOT, { recursive: true, force: true });
  sessionContext.reset();
  AIFactory.clear();
  clearGlobalAIProvider();
});

// ---------------------------------------------------------------------------
// Matrix: 4 providers × 4 stages
// ---------------------------------------------------------------------------

const reviewConfig = buildReviewConfig();
const job = buildPipelineJob();

for (const provider of PROVIDERS) {
  const _describe = hasCredentials(provider) ? describe : describe.skip;

  _describe(`provider-dialect smoke: ${provider}`, () => {
    let aiProvider: AIProvider;
    let observedIssues: ReviewIssue[] = [];

    beforeAll(async () => {
      const configPath = await writeProviderConfig(provider);
      ConfigService.setConfigPath(configPath);
      AIFactory.clear();
      clearGlobalAIProvider();
      aiProvider = await AIFactory.createForStage('review');
    });

    it('file-reviewer: structured response validates against ReviewIssuesSchema', async () => {
      const reviewer = new FileReviewer(aiProvider, systemPrompt, 'smoke');
      observedIssues = await reviewer.reviewFile(file);
      expect(Array.isArray(observedIssues)).toBe(true);
    });

    it('validation-resolver: structured response validates against ValidationResultsSchema', async () => {
      // Seed inputs ensure the resolver actually invokes the provider even if
      // file-reviewer returned an empty array.
      const input =
        observedIssues.length > 0
          ? [...observedIssues, ...seedIssues(slice.filePath)]
          : seedIssues(slice.filePath);
      const resolver = new ValidationResolver(reviewConfig, aiProvider);
      const result = await resolver.validate(input, job);
      expect(Array.isArray(result)).toBe(true);
    });

    it('dedup-resolver: structured response validates against DedupIndicesSchema', async () => {
      // Dedup short-circuits on input.length <= 1, so we need at least 2 issues.
      const input = seedIssues(slice.filePath);
      const resolver = new DeduplicationResolver(reviewConfig, aiProvider);
      const result = await resolver.deduplicate(input, job);
      expect(Array.isArray(result)).toBe(true);
    });

    it('root-cause-extract: structured response validates against RootCauseClassificationsSchema', async () => {
      // root-cause-extract reads from session-context paths and uses
      // AIFactory.createForStage('review') internally — the per-provider
      // ConfigService.setConfigPath() in this describe's beforeAll already
      // points the factory at the current provider. The stage swallows
      // provider errors and returns synthetic `{rootCause: 'other',
      // confidence: 0}` per input, so we cross-check token stats and the
      // classification distribution to detect silent failures.
      setCurrentSession('smoke-session', SESSION_ROOT);
      const seeded = seedIssues(slice.filePath);
      await writeSeedIssueMarkdown(seeded, path.join(SESSION_ROOT, 'issues'));

      const metadata = await extractRootCauses();

      const stats = (await AIFactory.createForStage('review')).getTokenStats();
      expect(stats.invocationCount).toBeGreaterThan(0);
      expect(stats.totalOutputTokens).toBeGreaterThan(0);

      const classifications = Object.values(metadata.classifications);
      expect(classifications.length).toBeGreaterThan(0);
      const allFallback = classifications.every(
        (c) => c.rootCause === 'other' && c.confidence === 0,
      );
      expect(allFallback).toBe(false);
    });
  });
}
