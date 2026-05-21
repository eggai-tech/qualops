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
 * Datasets must be uploaded first:
 *   npx tsx upload-datasets.ts --source=all
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { ROOT_CONTEXT, SpanStatusCode } from '@opentelemetry/api';
import type { Tracer, Span } from '@opentelemetry/api';
import { Langfuse } from 'langfuse';
import type { ApiDatasetItem } from 'langfuse';
dotenv.config({ path: path.join(__dirname, '../../.env') });

import {
  QUALOPS_ROOT,
  PRESETS_DIR,
  parseArgs,
  resolveDatasets,
  buildConfig,
  listPresets,
  readPresetMeta,
} from './config';
import { classifyError, createRunLog } from './run-log';
import { resolveWithinCwd, isPathTraversalSafe } from '@/shared/utils/security';
import { runReviewForItem } from './reviewer';
import type { ItemInput } from './reviewer';
import { runAllScorers, scoreFor } from './scorers/index';
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

async function runEvalItem(
  langfuse: Langfuse,
  item: ApiDatasetItem,
  itemIndex: number,
  total: number,
  datasetName: string,
  tracer: Tracer,
) {
  try {
    return await _runEvalItem(langfuse, item, itemIndex, total, datasetName, tracer);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    const errorCode = classifyError(err);
    console.error(
      `  [${itemIndex + 1}/${total}] UNCAUGHT ERROR [${errorCode}]: ${error.message}`,
    );
    runLog.add({
      level: 'error',
      event: 'uncaught_error',
      errorCode,
      dataset: datasetName,
      caseId: item.input?.caseId || item.id,
      message: error.message,
      stack: error.stack || null,
    });
    return { caseId: item.id, issues: [], reviewError: error.message };
  }
}

async function _runEvalItem(
  langfuse: Langfuse,
  item: ApiDatasetItem,
  itemIndex: number,
  total: number,
  datasetName: string,
  tracer: Tracer,
) {
  const itemInput: ItemInput = item.input || {};
  const itemExpected = item.expectedOutput || {};
  const referenceBugs: Issue[] = itemExpected.referenceBugs || [];
  const referenceExpected: Issue[] = itemExpected.referenceExpected || [];

  // Validate untrusted fields at the boundary before they reach internal functions.
  const rawCaseId = itemInput.caseId || item.id;
  const caseId = isPathTraversalSafe(rawCaseId)
    ? rawCaseId
    : rawCaseId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const git = itemInput.git as Record<string, unknown> | undefined;
  if (git?.repo_path && typeof git.repo_path === 'string') {
    const safeRepoPath = resolveWithinCwd(QUALOPS_ROOT, git.repo_path);
    if (!safeRepoPath) {
      console.warn(`  WARN: item ${caseId} has repo_path that escapes QUALOPS_ROOT, clearing it`);
      git.repo_path = null;
    } else {
      git.repo_path = safeRepoPath;
    }
  }
  const traceName = `eval/${datasetName}/${caseId}`;

  let issues: unknown[] = [];
  let reviewError: string | null = null;
  let durationMs = 0;
  let traceId: string | undefined;
  let genSpanId: string | undefined;

  // rootSpan stays open until after scoring so we can attach goldenDetails
  // Use ROOT_CONTEXT so concurrent eval items each start a fresh trace
  await tracer.startActiveSpan(traceName, {}, ROOT_CONTEXT, async (rootSpan: Span) => {
    try {
      setTraceAttributes(rootSpan, {
        sessionId: config.experimentName,
        traceName,
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
      traceId = rootSpan.spanContext().traceId;

      const reviewResult = await runReviewSpan(
        tracer,
        rootSpan,
        itemInput,
        caseId,
        itemIndex,
        total,
        datasetName,
      );
      issues = reviewResult.issues;
      reviewError = reviewResult.reviewError;
      durationMs = reviewResult.durationMs;
      genSpanId = reviewResult.genSpanId;

      // Flush before linking trace to dataset run item
      await forceFlushTracing();

      await linkDatasetRunItem(
        langfuse,
        item.id as string,
        traceId,
        durationMs,
        datasetName,
        caseId,
      );

      if (!reviewError) {
        const scoringResult = await scoreEvalItem({
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
        });
        if (scoringResult.goldenDetails) {
          setGoldenDetails(rootSpan, scoringResult.goldenDetails);
        }
      }
    } catch (error) {
      recordSpanError(rootSpan, error);
      throw error;
    } finally {
      rootSpan.end();
    }
  });

  await forceFlushTracing();
  return { caseId, issues, reviewError };
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
  langfuse: Langfuse,
  datasetItemId: string,
  traceId: string,
  durationMs: number,
  datasetName: string,
  caseId: string,
) {
  try {
    await langfuse.api.datasetRunItemsCreate({
      datasetItemId,
      traceId,
      runName: config.experimentName,
      metadata: { durationMs },
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
  langfuse: Langfuse;
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
}: ScoreEvalItemOpts) {
  const source = itemInput.source || 'unknown';

  let scores;
  if (config.skipJudge) {
    scores = await scoreFor(source, issues as Issue[], {
      referenceBugs,
      referenceExpected,
      skipNames: new Set(['judge']),
      source,
    });
  } else {
    scores = await runAllScorers(issues as Issue[], { referenceBugs, referenceExpected, source });
  }

  for (const score of scores) {
    langfuse.score({
      traceId,
      observationId: genSpanId,
      name: score.name,
      value: score.value!,
      comment: score.comment,
      dataType: 'NUMERIC',
    });
  }

  const recallScore = scores.find((s: { name: string }) => s.name === 'crb_recall');
  const goldenDetails = (recallScore?.metadata?.goldenDetails as CrbGoldenCommentDetails[] | undefined) || null;

  if (goldenDetails) {
    for (const gd of goldenDetails) {
      langfuse.score({
        traceId,
        observationId: genSpanId,
        name: `${caseId}:golden-${gd.goldenIndex}`,
        value: gd.matched ? 1 : 0,
        comment: `${gd.description}${gd.confidence ? ` (conf=${gd.confidence.toFixed(2)})` : ''}`,
        dataType: 'NUMERIC',
      });
    }
  }

  const scoreMap = Object.fromEntries(
    scores.map((s: Score) => [s.name, s.value]),
  );
  const summary = scores
    .map((s: Score) => `${s.name}=${s.value!.toFixed(3)}`)
    .join(' ');
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

  return { goldenDetails };
}

async function runDataset(langfuse: Langfuse, datasetName: string, tracer: Tracer) {
  console.log(`\n═══ Dataset: ${datasetName} ═══`);

  try {
    await langfuse.api.datasetsGet(encodeURIComponent(datasetName));
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

  let allItems: ApiDatasetItem[] = [];
  let page = 1;
  while (true) {
    const resp = await langfuse.api.datasetItemsList({ datasetName, page, limit: 100 });
    allItems.push(...(resp.data || []));
    if (!resp.meta?.totalPages || page >= resp.meta.totalPages) break;
    page++;
  }

  if (config.severityFilter) {
    const before = allItems.length;
    allItems = allItems.filter((item) => {
      const expected: Array<{ severity?: string }> = item.expectedOutput?.referenceExpected || [];
      return expected.some((e) => config.severityFilter.has((e.severity || '').toLowerCase()));
    });
    console.log(
      `Severity filter: ${[...config.severityFilter].join(',')} — ${allItems.length}/${before} items`,
    );
  }

  if (config.limit < Infinity) {
    allItems = allItems.slice(0, config.limit);
  }

  console.log(
    `Found ${allItems.length} items. Running with concurrency=${config.concurrency}...\n`,
  );

  const results = { total: allItems.length, passed: 0, errors: 0 } as {
    total: number;
    passed: number;
    errors: number;
  };

  const tasks = allItems.map(
    (item, i) => () => runEvalItem(langfuse, item, i, allItems.length, datasetName, tracer),
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

async function main(): Promise<void> {
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseHost = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

  if (!langfuseSecretKey || !langfusePublicKey) {
    console.error('Error: LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }

  await setupTracing();
  const tracer = getTracer();

  // Keep Langfuse SDK for dataset management + scoring APIs only
  const langfuse = new Langfuse({
    secretKey: langfuseSecretKey,
    publicKey: langfusePublicKey,
    baseUrl: langfuseHost,
    flushAt: 20,
    flushInterval: 5000,
  });

  const datasets = resolveDatasets(cliArgs);

  console.log(`Langfuse host: ${langfuseHost}`);
  console.log(`Preset: ${config.presetLabel} (${config.configPath})`);
  console.log(`Datasets: ${datasets.join(', ')}`);
  console.log(`Experiment: ${config.experimentName}`);
  console.log(`Model: ${config.model} | Mode: ${config.mode} | Provider: ${config.provider}`);
  if (config.severityFilter)
    console.log(`Severity filter: ${[...config.severityFilter].join(', ')}`);
  if (config.skipJudge) console.log('Judge scorer: disabled');

  const totals = { total: 0, errors: 0 };

  for (const ds of datasets) {
    const r = await runDataset(langfuse, ds, tracer);
    totals.total += r.total;
    totals.errors += r.errors;
  }

  // Shutdown both OTel and Langfuse SDK
  await shutdownTracing();
  await langfuse.shutdownAsync();

  const logFile = runLog.write();

  const logData = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
  const warnCount = logData.totals.warnings;

  console.log('\n─── Results ───────────────────────────────────────');
  console.log(
    `Datasets: ${datasets.length} | Total: ${totals.total} | Errors: ${totals.errors} | Warnings: ${warnCount}`,
  );
  console.log(`Experiment: ${config.experimentName}`);
  console.log(`View at: ${langfuseHost}`);
  console.log(`Run log: ${logFile}`);
  if (warnCount > 0) {
    const codes = Object.entries(logData.warningBreakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`Warnings: ${codes}`);
  }
  if (totals.errors > 0) {
    const codes = Object.entries(logData.errorBreakdown)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`Errors: ${codes}`);
  }
  console.log('──────────────────────────────────────────────────');
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
