#!/usr/bin/env tsx
/**
 * Run QualOps evals against a Langfuse dataset.
 *
 * Usage:
 *   npx tsx run-eval.ts                                             # qualops dataset, default preset
 *   npx tsx run-eval.ts --preset=thorough --source=crb             # named preset + CRB datasets
 *   npx tsx run-eval.ts --source=all                               # qualops + all CRB datasets
 *   npx tsx run-eval.ts --dataset=qualops/crb-sentry --mode=agentic # specific dataset
 *   npx tsx run-eval.ts --model=claude-opus-4-20250514             # override model
 *   npx tsx run-eval.ts --severity=critical,high                   # only cases with matching severity
 *   npx tsx run-eval.ts --no-judge                                 # skip LLM judge scorer
 *   npx tsx run-eval.ts --list-presets                             # show available presets
 *   npx tsx run-eval.ts --limit=10                                 # cap number of dataset items to run
 *   npx tsx run-eval.ts --concurrency=5                            # parallel eval items (default: 3)
 *   npx tsx run-eval.ts --experiment=my-run                        # override experiment name in Langfuse
 *
 * Presets are qualopsrc config files in evals/qualopsrc/.
 * CLI flags (--model, --mode, --provider) override preset values.
 *
 * Datasets must be uploaded to Langfuse first (one-time setup):
 *   npx tsx upload-datasets.ts --source=all
 * CRB items are read from local slices at run time (no re-upload needed after initial setup).
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api';
import type { Tracer, Span } from '@opentelemetry/api';
import { LangfuseClient } from '@langfuse/client';
import type { FetchedDataset } from '@langfuse/client';

type DatasetItem = FetchedDataset['items'][number];
dotenv.config({ path: path.join(__dirname, '../../.env') });

import {
  QUALOPS_ROOT,
  CRB_DATASETS_DIR,
  PRESETS_DIR,
  parseArgs,
  resolveDatasets,
  buildConfig,
  listPresets,
  readPresetMeta,
  loadCrbItems,
  buildCrbExpectedPair,
  crbDatasetName,
  CRB_REPOS,
} from './config';
import type { CrbSlice } from './config';
import { classifyError, createRunLog } from './run-log';
import { resolveWithinCwd, isPathTraversalSafe } from '@/shared/utils/security';
import { runReviewForItem } from './reviewer';
import type { ItemInput } from './reviewer';
import { runAllScorers } from './scorers/index';
import type { Issue, Score } from './scorers/types';
import type { CrbGoldenCommentDetails } from './scorers/schemas';
import {
  setupTracing,
  getTracer,
  shutdownTracing,
  setTraceAttributes,
  setTokenUsage,
  setObservationIO,
  setTraceIO,
  setGoldenDetails,
  recordSpanError,
  forceFlushTracing,
} from '../../src/observability';

const cliArgs = parseArgs(process.argv);

if (cliArgs['list-presets'] === 'true') {
  const presets = listPresets();
  if (presets.length === 0) {
    console.log('No presets found. Add .json files to evals/qualopsrc/');
  } else {
    console.log('Available presets:\n');
    for (const name of presets) {
      const meta = readPresetMeta(path.join(PRESETS_DIR, `${name}.json`));
      console.log(`  ${name}${meta.model ? ` (${meta.model}, ${meta.mode})` : ''}`);
    }
    console.log('\n  default  (uses .qualops/.qualopsrc.json)');
  }
  process.exit(0);
}

const config = buildConfig(cliArgs);
const runLog = createRunLog(config);

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < tasks.length) {
      const i = nextIndex++;
      try {
        results[i] = { status: 'fulfilled', value: await tasks[i]() };
      } catch (e) {
        results[i] = { status: 'rejected', reason: e };
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

interface NormalizedItem {
  id: string;
  /** Langfuse dataset item ID — present only for items fetched from Langfuse. */
  langfuseItemId?: string;
  input: ItemInput;
  referenceBugs: Issue[];
  referenceExpected: Issue[];
}

function normalizeApiItem(item: DatasetItem): NormalizedItem {
  const itemInput: ItemInput = item.input || {};
  const itemExpected = (item.expectedOutput as Record<string, unknown>) || {};
  return {
    id: item.id as string,
    langfuseItemId: item.id as string,
    input: itemInput,
    referenceBugs: (itemExpected.referenceBugs as Issue[]) || [],
    referenceExpected: (itemExpected.referenceExpected as Issue[]) || [],
  };
}

function attachTraceAttributes(rootSpan: Span, itemInput: ItemInput, caseId: string, datasetName: string): void {
  setTraceAttributes(rootSpan, {
    sessionId: config.experimentName,
    traceName: `eval/${datasetName}/${caseId}`,
    model: config.model,
    tags: ['eval', itemInput.source || 'unknown', config.mode],
    metadata: {
      dataset: datasetName,
      experiment: config.experimentName,
      model: config.model,
      mode: config.mode,
      provider: config.provider,
      caseId,
      source: itemInput.source,
      filePath: itemInput.filePath,
      language: itemInput.language,
    },
  });
  setTraceIO(rootSpan, { input: itemInput });
}

async function runEvalItem(
  langfuse: LangfuseClient,
  item: NormalizedItem,
  itemIndex: number,
  total: number,
  datasetName: string,
  tracer: Tracer,
) {
  const itemInput: ItemInput = item.input;
  const caseId = sanitizeCaseId(itemInput.caseId || item.id);
  sanitizeRepoCwd(itemInput, caseId);

  let issues: unknown[] = [];
  let reviewError: string | null = null;

  // Use ROOT_CONTEXT so concurrent eval items each start a fresh trace.
  // rootSpan stays open until after scoring so we can attach goldenDetails.
  await tracer.startActiveSpan(`eval/${datasetName}/${caseId}`, {}, ROOT_CONTEXT, async (rootSpan: Span) => {
    try {
      attachTraceAttributes(rootSpan, itemInput, caseId, datasetName);
      const traceId = rootSpan.spanContext().traceId;

      const reviewResult = await runReviewSpan(tracer, rootSpan, itemInput, caseId, itemIndex, total, datasetName);
      issues = reviewResult.issues;
      reviewError = reviewResult.reviewError;

      await forceFlushTracing();
      await linkDatasetRunItem(langfuse, item.langfuseItemId ?? item.id, traceId, reviewResult.durationMs, datasetName, caseId);

      if (!reviewError) {
        const goldenDetails = await scoreEvalItem({
          langfuse, traceId, genSpanId: reviewResult.genSpanId, caseId,
          issues, itemInput,
          referenceBugs: item.referenceBugs,
          referenceExpected: item.referenceExpected,
          itemIndex, total, durationMs: reviewResult.durationMs,
        });
        if (goldenDetails) setGoldenDetails(rootSpan, goldenDetails);
      }
    } catch (err) {
      recordSpanError(rootSpan, err);
      const error = err instanceof Error ? err : new Error(String(err));
      const errorCode = classifyError(err);
      console.error(`  [${itemIndex + 1}/${total}] UNCAUGHT ERROR [${errorCode}]: ${error.message}`);
      runLog.add({ level: 'error', event: 'uncaught_error', errorCode, dataset: datasetName, caseId, message: error.message, stack: error.stack || null });
      reviewError = error.message;
    } finally {
      rootSpan.end();
    }
  });

  await forceFlushTracing();
  return { caseId, issues, reviewError };
}

function sanitizeCaseId(raw: string): string {
  return isPathTraversalSafe(raw) ? raw : raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function sanitizeRepoCwd(itemInput: ItemInput, caseId: string): void {
  const git = itemInput.git as Record<string, unknown> | undefined;
  if (!git?.repo_path || typeof git.repo_path !== 'string') return;
  const safe = resolveWithinCwd(QUALOPS_ROOT, git.repo_path);
  if (!safe) {
    console.warn(`  WARN: item ${caseId} has repo_path that escapes QUALOPS_ROOT, clearing it`);
    git.repo_path = null;
  } else {
    git.repo_path = safe;
  }
}

async function runReviewSpan(
  tracer: Tracer,
  rootSpan: Span,
  itemInput: ItemInput,
  caseId: string,
  itemIndex: number,
  total: number,
  datasetName: string,
) {
  let issues: unknown[] = [];
  let reviewError: string | null = null;
  let durationMs = 0;
  let genSpanId: string | undefined;

  await tracer.startActiveSpan('review', async (genSpan: Span) => {
    try {
      setObservationIO(genSpan, {
        input: {
          filePath: itemInput.filePath,
          language: itemInput.language,
          diffLength: ((itemInput.diff as string) || '').length,
          contentLength: (
            (itemInput.fullContent as string) ||
            (itemInput.fileContent as string) ||
            ''
          ).length,
        },
      });
      genSpanId = genSpan.spanContext().spanId;

      const result = await runReviewForItem(itemInput, { config, runLog });

      issues = result.issues || [];
      durationMs = result.durationMs || 0;

      setTokenUsage(genSpan, {
        model: config.model,
        inputTokens: result.tokenUsage?.input,
        outputTokens: result.tokenUsage?.output,
      });
      setObservationIO(genSpan, { output: issues });

      setTraceIO(rootSpan, { output: issues });
    } catch (err) {
      reviewError = err instanceof Error ? err.message : String(err);
      const errorCode = classifyError(err instanceof Error ? err : new Error(String(err)));
      setObservationIO(genSpan, { output: { error: reviewError, errorCode } });
      genSpan.setStatus({ code: SpanStatusCode.ERROR, message: reviewError });

      setTraceIO(rootSpan, { output: { error: reviewError, errorCode } });
      rootSpan.setStatus({ code: SpanStatusCode.ERROR, message: reviewError });

      console.error(`  [${itemIndex + 1}/${total}] ${caseId} ERROR [${errorCode}]: ${reviewError}`);
      runLog.add({
        level: 'error',
        event: 'review_error',
        errorCode,
        dataset: datasetName,
        caseId,
        traceId: rootSpan.spanContext().traceId,
        message: reviewError,
        stack: err instanceof Error ? err.stack || null : null,
      });
    } finally {
      genSpan.end();
    }
  });

  return { issues, reviewError, durationMs, genSpanId };
}

async function linkDatasetRunItem(
  langfuse: LangfuseClient,
  datasetItemId: string,
  traceId: string,
  durationMs: number,
  datasetName: string,
  caseId: string,
) {
  try {
    await langfuse.api.datasetRunItems.create({
      datasetItemId,
      traceId,
      runName: config.experimentName,
      runDescription: `${config.model} · ${config.mode} · ${config.presetLabel}`,
      metadata: {
        model: config.model,
        mode: config.mode,
        provider: config.provider,
        preset: config.presetLabel,
        configPath: config.configPath,
        durationMs,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`  Failed to link dataset run item: ${message}`);
    runLog.add({
      level: 'error',
      event: 'langfuse_link_error',
      errorCode: 'LANGFUSE_API_ERROR',
      dataset: datasetName,
      caseId,
      message,
    });
  }
}

interface ScoreEvalItemOpts {
  langfuse: LangfuseClient;
  traceId: string;
  genSpanId: string | undefined;
  caseId: string;
  issues: unknown[];
  itemInput: ItemInput;
  referenceBugs: Issue[];
  referenceExpected: Issue[];
  itemIndex: number;
  total: number;
  durationMs: number;
}

async function computeScores(
  issues: unknown[],
  referenceBugs: Issue[],
  referenceExpected: Issue[],
  source: string,
): Promise<{ scores: Score[]; goldenDetails: CrbGoldenCommentDetails[] | null }> {
  const scores = await runAllScorers(issues as Issue[], {
    referenceBugs,
    referenceExpected,
    source,
    skipNames: config.skipJudge ? new Set(['judge']) : undefined,
  });
  const recallScore = scores.find((s) => s.name === 'crb_recall');
  const goldenDetails = (recallScore?.metadata?.goldenDetails as CrbGoldenCommentDetails[] | undefined) ?? null;
  return { scores, goldenDetails };
}

function publishScores(
  langfuse: LangfuseClient,
  traceId: string,
  genSpanId: string | undefined,
  caseId: string,
  scores: Score[],
  goldenDetails: CrbGoldenCommentDetails[] | null,
): void {
  for (const score of scores) {
    langfuse.score.create({ traceId, observationId: genSpanId, name: score.name, value: score.value!, comment: score.comment, dataType: 'NUMERIC' });
  }
  if (!goldenDetails) return;
  for (const gd of goldenDetails) {
    langfuse.score.create({
      traceId,
      observationId: genSpanId,
      name: `${caseId}:golden-${gd.goldenIndex}`,
      value: gd.matched ? 1 : 0,
      comment: `${gd.description}${gd.confidence ? ` (conf=${gd.confidence.toFixed(2)})` : ''}`,
      dataType: 'NUMERIC',
    });
  }
}

async function scoreEvalItem({
  langfuse,
  traceId,
  genSpanId,
  caseId,
  issues,
  itemInput,
  referenceBugs,
  referenceExpected,
  itemIndex,
  total,
  durationMs,
}: ScoreEvalItemOpts): Promise<CrbGoldenCommentDetails[] | null> {
  const { scores, goldenDetails } = await computeScores(issues, referenceBugs, referenceExpected, itemInput.source || 'unknown');

  publishScores(langfuse, traceId, genSpanId, caseId, scores, goldenDetails);

  const scoreMap = Object.fromEntries(scores.map((s: Score) => [s.name, s.value]));
  const summary = scores.map((s: Score) => `${s.name}=${s.value!.toFixed(3)}`).join(' ');
  console.log(`  [${itemIndex + 1}/${total}] ${caseId} issues=${issues.length} ${summary}`);

  runLog.add({
    level: 'info',
    event: 'item_complete',
    dataset: itemInput.source || 'unknown',
    caseId,
    traceId,
    issueCount: issues.length,
    durationMs,
    scores: scoreMap,
    goldenDetails,
  });

  return goldenDetails;
}

/** Extract CRB repo slug from a dataset name like 'qualops/crb-sentry' → 'sentry', or null. */
function crbRepoSlugFromDatasetName(datasetName: string): string | null {
  return Object.keys(CRB_REPOS).find((slug) => crbDatasetName(slug) === datasetName) ?? null;
}

/** Build a NormalizedItem from a local CRB slice. */
function crbSliceToItem(slice: CrbSlice): NormalizedItem {
  const { referenceExpected, referenceBugs } = buildCrbExpectedPair(slice);
  return {
    id: slice.id,
    langfuseItemId: slice.id, // slice id is used as the Langfuse item id on upload
    input: {
      caseId: slice.id,
      source: slice.source,
      filePath: slice.prUrl,
      language: slice.language,
      diff: slice.diff,
      git: {
        repo_path: path.join(CRB_DATASETS_DIR, slice.id, 'repo'),
        head_sha: '', // empty = use repo_path directly (no worktree)
        base_sha: slice.baseSha,
      },
    },
    referenceBugs: referenceBugs as Issue[],
    referenceExpected: referenceExpected as Issue[],
  };
}

async function runItems(
  langfuse: LangfuseClient,
  items: NormalizedItem[],
  datasetName: string,
  tracer: Tracer,
) {
  if (config.severityFilter) {
    const severityFilter = config.severityFilter;
    const before = items.length;
    items = items.filter((item) =>
      item.referenceExpected.some((e) =>
        severityFilter.has(((e as { severity?: string }).severity ?? '').toLowerCase()),
      ),
    );
    console.log(`Severity filter: ${[...severityFilter].join(',')} — ${items.length}/${before} items`);
  }

  if (config.limit < Infinity) {
    items = items.slice(0, config.limit);
  }

  console.log(
    `Found ${items.length} items. Running with concurrency=${config.concurrency}...\n`,
  );

  const results = { total: items.length, passed: 0, errors: 0 } as {
    total: number;
    passed: number;
    errors: number;
  };

  const tasks = items.map(
    (item, i) => () => runEvalItem(langfuse, item, i, items.length, datasetName, tracer),
  );
  const runResults = await runWithConcurrency(tasks, config.concurrency);

  for (const r of runResults) {
    if (r.status === 'rejected' || r.value.reviewError) {
      results.errors++;
    } else {
      results.passed++;
    }
  }

  return results;
}

async function runDataset(langfuse: LangfuseClient, datasetName: string, tracer: Tracer) {
  console.log(`\n═══ Dataset: ${datasetName} ═══`);

  // CRB datasets are served from local slices — no Langfuse fetch needed.
  const crbSlug = crbRepoSlugFromDatasetName(datasetName);
  if (crbSlug) {
    if (!CRB_REPOS[crbSlug]) {
      console.error(`Error: unknown CRB repo slug "${crbSlug}" in dataset "${datasetName}"`);
      return { total: 0, errors: 1 };
    }
    const slices = loadCrbItems(crbSlug);
    if (slices.length === 0) {
      console.error(`Error: no slices found for ${crbSlug} under ${CRB_DATASETS_DIR}`);
      return { total: 0, errors: 1 };
    }
    const items = slices.map(crbSliceToItem);
    return runItems(langfuse, items, datasetName, tracer);
  }

  // Non-CRB datasets are fetched from Langfuse.
  let fetchedDataset: Awaited<ReturnType<typeof langfuse.dataset.get>>;
  try {
    fetchedDataset = await langfuse.dataset.get(datasetName);
  } catch (err) {
    const error = err as Error;
    const errorCode = classifyError(error);
    console.error(
      `Error: could not fetch dataset "${datasetName}" [${errorCode}]: ${error.message}`,
    );
    console.error('Make sure to upload the dataset first: npm run eval:upload:all');
    runLog.add({
      level: 'error',
      event: 'dataset_fetch_error',
      errorCode,
      dataset: datasetName,
      message: error.message || String(err),
    });
    return { total: 0, errors: 1 };
  }

  const items = fetchedDataset.items.map(normalizeApiItem);
  return runItems(langfuse, items, datasetName, tracer);
}

function createLangfuseClient(): { langfuse: LangfuseClient; host: string } {
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const host = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';
  if (!secretKey || !publicKey) {
    console.error('Error: LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }
  const langfuse = new LangfuseClient({ secretKey, publicKey, baseUrl: host });
  return { langfuse, host };
}

function printRunConfig(datasets: string[], host: string): void {
  console.log(`Langfuse host: ${host}`);
  console.log(`Preset: ${config.presetLabel} (${config.configPath})`);
  console.log(`Datasets: ${datasets.join(', ')}`);
  console.log(`Experiment: ${config.experimentName}`);
  console.log(`Model: ${config.model} | Mode: ${config.mode} | Provider: ${config.provider}`);
  if (config.severityFilter) console.log(`Severity filter: ${[...config.severityFilter].join(', ')}`);
  if (config.skipJudge) console.log('Judge scorer: disabled');
}

function printRunSummary(datasets: string[], totals: { total: number; errors: number }, logFile: string, host: string): void {
  const logData = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
  const warnCount: number = logData.totals.warnings;
  const breakdownStr = (map: Record<string, unknown>): string =>
    Object.entries(map).map(([k, v]) => `${k}=${v}`).join(' ');

  console.log('\n─── Results ───────────────────────────────────────');
  console.log(`Datasets: ${datasets.length} | Total: ${totals.total} | Errors: ${totals.errors} | Warnings: ${warnCount}`);
  console.log(`Experiment: ${config.experimentName}`);
  console.log(`View at: ${host}`);
  console.log(`Run log: ${logFile}`);
  if (warnCount > 0) console.log(`Warnings: ${breakdownStr(logData.warningBreakdown)}`);
  if (totals.errors > 0) console.log(`Errors: ${breakdownStr(logData.errorBreakdown)}`);
  console.log('──────────────────────────────────────────────────');
}

async function main(): Promise<void> {
  const { langfuse, host } = createLangfuseClient();
  const datasets = resolveDatasets(cliArgs);

  await setupTracing();
  const tracer = getTracer();

  printRunConfig(datasets, host);

  const totals = { total: 0, errors: 0 };
  for (const ds of datasets) {
    const r = await runDataset(langfuse, ds, tracer);
    totals.total += r.total;
    totals.errors += r.errors;
  }

  await shutdownTracing();
  await langfuse.shutdown();

  const logFile = runLog.write();
  printRunSummary(datasets, totals, logFile, host);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  main().catch((err: Error) => {
    runLog.add({
      level: 'error',
      event: 'fatal',
      errorCode: classifyError(err),
      message: err.message || String(err),
      stack: err.stack || null,
    });
    const logFile = runLog.write();
    console.error(`Fatal: ${err.message || err}`);
    console.error(`Run log: ${logFile}`);
    process.exit(1);
  });
}
