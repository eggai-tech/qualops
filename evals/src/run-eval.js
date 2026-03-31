#!/usr/bin/env node
'use strict';

/**
 * Run QualOps evals against a Langfuse dataset.
 *
 * Usage:
 *   node run-eval.js                                             # qualops dataset, default preset
 *   node run-eval.js --preset=thorough --source=crb              # named preset + CRB datasets
 *   node run-eval.js --source=all                                # qualops + all CRB datasets
 *   node run-eval.js --dataset=qualops/crb-sentry --mode=agentic # specific dataset
 *   node run-eval.js --model=claude-opus-4-20250514              # override model
 *   node run-eval.js --no-judge                                  # skip LLM judge scorer
 *   node run-eval.js --list-presets                              # show available presets
 *
 * Presets are qualopsrc config files in evals/qualopsrc/.
 * CLI flags (--model, --mode, --provider) override preset values.
 *
 * Datasets must be uploaded first:
 *   node upload-datasets.js --source=all
 */

const path = require('path');
const fs = require('fs');

const { QUALOPS_ROOT, PRESETS_DIR, parseArgs, resolveDatasets, buildConfig, listPresets, readPresetMeta, resolvePreset, CRB_REPOS } = require('./config');
const { classifyError, createRunLog } = require('./run-log');
const { runReviewForItem, parseDiffLines } = require('./reviewer');

try {
  require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
} catch {}

const { Langfuse } = require('langfuse');
const { runAllScorers, scoreFor } = require('./scorers/index');

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

async function runWithConcurrency(tasks, limit) {
  const results = [];
  const running = new Set();
  let index = 0;

  async function runNext() {
    if (index >= tasks.length) return;
    const i = index++;
    const promise = tasks[i]().then((r) => { results[i] = { status: 'fulfilled', value: r }; }).catch((e) => { results[i] = { status: 'rejected', reason: e }; });
    running.add(promise);
    promise.finally(() => running.delete(promise));
    await promise;
    if (running.size < limit && index < tasks.length) await runNext();
  }

  const starters = Array.from({ length: Math.min(limit, tasks.length) }, () => runNext());
  await Promise.all(starters);
  return results;
}

async function runEvalItem(langfuse, item, itemIndex, total, datasetName) {
  try {
    return await _runEvalItem(langfuse, item, itemIndex, total, datasetName);
  } catch (err) {
    const errorCode = classifyError(err);
    console.error(`  [${itemIndex + 1}/${total}] UNCAUGHT ERROR [${errorCode}]: ${err.message || err}`);
    runLog.add({
      level: 'error',
      event: 'uncaught_error',
      errorCode,
      dataset: datasetName,
      caseId: item.input?.caseId || item.id,
      message: err.message || String(err),
      stack: err.stack || null,
    });
    return { caseId: item.id, issues: [], reviewError: err.message || String(err) };
  }
}

async function _runEvalItem(langfuse, item, itemIndex, total, datasetName) {
  const itemInput = item.input;
  const itemExpected = item.expectedOutput || {};
  const referenceBugs = itemExpected.referenceBugs || [];
  const referenceExpected = itemExpected.referenceExpected || [];

  const caseId = itemInput.caseId || item.id;
  const traceName = `eval/${datasetName}/${caseId}`;

  const trace = langfuse.trace({
    name: traceName,
    sessionId: config.experimentName,
    input: itemInput,
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
    tags: ['eval', itemInput.source || 'unknown', config.mode],
  });

  const generation = trace.generation({
    name: 'review',
    model: config.model,
    modelParameters: { mode: config.mode, provider: config.provider },
    input: {
      filePath: itemInput.filePath,
      language: itemInput.language,
      diffLength: (itemInput.diff || '').length,
      contentLength: (itemInput.fullContent || itemInput.fileContent || '').length,
    },
  });

  let issues = [];
  let reviewError = null;
  let durationMs = 0;

  try {
    const result = await runReviewForItem(itemInput, { config, runLog });
    issues = result.issues || [];
    durationMs = result.durationMs || 0;

    generation.end({
      output: issues,
      usage: result.tokenUsage
        ? { input: result.tokenUsage.input, output: result.tokenUsage.output, unit: 'TOKENS' }
        : undefined,
    });

    trace.update({ output: issues });
  } catch (err) {
    reviewError = err.message || String(err);
    const errorCode = classifyError(err);
    generation.end({ output: { error: reviewError, errorCode }, level: 'ERROR', statusMessage: reviewError });
    trace.update({ output: { error: reviewError, errorCode } });
    console.error(`  [${itemIndex + 1}/${total}] ${caseId} ERROR [${errorCode}]: ${reviewError}`);
    runLog.add({
      level: 'error',
      event: 'review_error',
      errorCode,
      dataset: datasetName,
      caseId,
      traceId: trace.id,
      message: reviewError,
      stack: err.stack || null,
    });
  }

  // Langfuse requires flush before linking trace to dataset run item
  await langfuse.flushAsync();

  try {
    await langfuse.api.datasetRunItemsCreate({
      datasetItemId: item.id,
      traceId: trace.id,
      runName: config.experimentName,
      metadata: { durationMs },
    });
  } catch (err) {
    console.error(`  Failed to link dataset run item: ${err.message || JSON.stringify(err)}`);
    runLog.add({
      level: 'error',
      event: 'langfuse_link_error',
      errorCode: 'LANGFUSE_API',
      dataset: datasetName,
      caseId,
      message: err.message || JSON.stringify(err),
    });
  }

  if (!reviewError) {
    const source = itemInput.source;

    let scores;
    if (config.skipJudge) {
      scores = await scoreFor(source, issues, { referenceBugs, referenceExpected, skipNames: new Set(['judge']) });
    } else {
      scores = await runAllScorers(issues, { referenceBugs, referenceExpected, source });
    }

    for (const score of scores) {
      langfuse.score({
        traceId: trace.id,
        observationId: generation.id,
        name: score.name,
        value: score.value,
        comment: score.comment,
        dataType: 'NUMERIC',
      });
    }

    const scoreMap = Object.fromEntries(scores.map((s) => [s.name, s.value]));
    const summary = scores.map((s) => `${s.name}=${s.value.toFixed(3)}`).join(' ');
    console.log(`  [${itemIndex + 1}/${total}] ${caseId} issues=${issues.length} ${summary}`);

    runLog.add({
      level: 'info',
      event: 'item_complete',
      dataset: datasetName,
      caseId,
      traceId: trace.id,
      issueCount: issues.length,
      durationMs,
      scores: scoreMap,
    });
  }

  return { caseId, issues, reviewError };
}

async function runDataset(langfuse, datasetName) {
  console.log(`\n═══ Dataset: ${datasetName} ═══`);

  try {
    await langfuse.api.datasetsGet(encodeURIComponent(datasetName));
  } catch (err) {
    const errorCode = classifyError(err);
    console.error(`Error: could not fetch dataset "${datasetName}" [${errorCode}]: ${err.message}`);
    console.error('Make sure to upload the dataset first: npm run eval:upload:all');
    runLog.add({
      level: 'error',
      event: 'dataset_fetch_error',
      errorCode,
      dataset: datasetName,
      message: err.message || String(err),
    });
    return { total: 0, errors: 1 };
  }

  let allItems = [];
  let page = 1;
  while (true) {
    const resp = await langfuse.api.datasetItemsList({ datasetName, page, limit: 100 });
    allItems.push(...(resp.data || []));
    if (!resp.meta?.totalPages || page >= resp.meta.totalPages) break;
    page++;
  }

  if (config.limit < Infinity) {
    allItems = allItems.slice(0, config.limit);
  }

  console.log(`Found ${allItems.length} items. Running with concurrency=${config.concurrency}...\n`);

  const results = { total: allItems.length, passed: 0, errors: 0 };

  const tasks = allItems.map((item, i) => () => runEvalItem(langfuse, item, i, allItems.length, datasetName));
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

async function main() {
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseHost = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

  if (!langfuseSecretKey || !langfusePublicKey) {
    console.error('Error: LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }

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
  if (config.skipJudge) console.log('Judge scorer: disabled');

  const totals = { total: 0, errors: 0 };

  for (const ds of datasets) {
    const r = await runDataset(langfuse, ds);
    totals.total += r.total;
    totals.errors += r.errors;
  }

  await langfuse.shutdownAsync();

  const logFile = runLog.write();

  const logData = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
  const warnCount = logData.totals.warnings;

  console.log('\n─── Results ───────────────────────────────────────');
  console.log(`Datasets: ${datasets.length} | Total: ${totals.total} | Errors: ${totals.errors} | Warnings: ${warnCount}`);
  console.log(`Experiment: ${config.experimentName}`);
  console.log(`View at: ${langfuseHost}`);
  console.log(`Run log: ${logFile}`);
  if (warnCount > 0) {
    const codes = Object.entries(logData.warningBreakdown).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`Warnings: ${codes}`);
  }
  if (totals.errors > 0) {
    const codes = Object.entries(logData.errorBreakdown).map(([k, v]) => `${k}=${v}`).join(' ');
    console.log(`Errors: ${codes}`);
  }
  console.log('──────────────────────────────────────────────────');
}

if (require.main === module) {
  main().catch((err) => {
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

