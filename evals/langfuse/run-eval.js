#!/usr/bin/env node
'use strict';

/**
 * Run QualOps evals against a Langfuse dataset.
 *
 * Usage:
 *   node run-eval.js                                             # qualops dataset, file-by-file
 *   node run-eval.js --source=crb                                # all CRB per-repo datasets
 *   node run-eval.js --source=all                                # qualops + all CRB datasets
 *   node run-eval.js --dataset=qualops/crb-sentry --mode=agentic # specific dataset
 *   node run-eval.js --dataset=qualops/kodus-python --limit=5
 *   node run-eval.js --model=claude-opus-4-20250514
 *   node run-eval.js --no-judge                                  # skip LLM judge scorer
 *
 * Datasets must be uploaded first:
 *   node upload-datasets.js --source=kodus --lang=tsjs
 */

const path = require('path');
const fs = require('fs');

const QUALOPS_ROOT = path.join(__dirname, '../..');

try {
  require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
} catch {
  // rely on shell env
}

const { Langfuse } = require('langfuse');
const { runAllScorers, scoreParser, scoreLineAccuracy, scoreCoverage, scoreSeverity, scoreJudge } = require('./scorers');

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v || 'true'];
    }),
);

const mode = args.mode || 'file-by-file';
const model = args.model || 'claude-sonnet-4-20250514';
const provider = args.provider || 'anthropic';
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const skipJudge = args['no-judge'] === 'true';
const experimentName = args.experiment || `${model}:${mode}:${new Date().toISOString().slice(0, 16)}`;
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;

const CRB_REPOS = ['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak'];

function resolveDatasets() {
  if (args.dataset) return [args.dataset];
  if (args.source === 'crb') return CRB_REPOS.map((r) => `qualops/crb-${r}`);
  if (args.source === 'qualops') return ['qualops/qualops'];
  if (args.source === 'all') return ['qualops/qualops', ...CRB_REPOS.map((r) => `qualops/crb-${r}`)];
  return ['qualops/qualops'];
}

// ─── QualOps review integration (same as qualops-provider.js) ────────────────

function loadEnv() {
  try {
    require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
  } catch { /* already loaded */ }
}

function parseDiffLines(diffStr) {
  const additions = new Set();
  const deletions = new Set();
  const modifications = new Set();

  if (!diffStr) return { additions, deletions, modifications };

  let newLineNumber = 0;
  for (const line of diffStr.split('\n')) {
    const hunkMatch = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) { newLineNumber = parseInt(hunkMatch[1], 10); continue; }
    if (line.startsWith('+') && !line.startsWith('+++')) { additions.add(newLineNumber); newLineNumber++; }
    else if (line.startsWith('-') && !line.startsWith('---')) { deletions.add(newLineNumber); }
    else if (!line.startsWith('\\')) { newLineNumber++; }
  }

  return { additions, deletions, modifications };
}

let _initialized = false;

async function ensureInit() {
  if (_initialized) return;
  loadEnv();

  try {
    require('ts-node').register({
      transpileOnly: true,
      project: path.join(QUALOPS_ROOT, 'tsconfig.base.json'),
    });
  } catch { /* already registered */ }

  try {
    const { register } = require('tsconfig-paths');
    register({
      baseUrl: QUALOPS_ROOT,
      paths: { '@/*': ['src/*'], '@evals/*': ['evals/src/*'] },
    });
  } catch { /* not available */ }

  if (!fs.existsSync(path.join(process.cwd(), '.qualops/.qualopsrc.json'))) {
    process.chdir(QUALOPS_ROOT);
  }

  _initialized = true;
}

/**
 * Split a multi-file unified diff into per-file FileInfo objects.
 * Used for CRB dataset items which contain full PR diffs.
 */
function splitMultiFileDiff(rawDiff) {
  const files = [];
  const fileHeaderRe = /^diff --git a\/.+ b\/(.+)$/m;
  const chunks = rawDiff.split(/^(?=diff --git )/m).filter(Boolean);

  for (const chunk of chunks) {
    const match = chunk.match(fileHeaderRe);
    if (!match) continue;
    const filePath = match[1];
    const diff = parseDiffLines(chunk);
    files.push({ path: filePath, content: '', diff, rawDiff: chunk });
  }

  return files;
}

async function runReviewForItem(itemInput) {
  await ensureInit();

  const evalConfig = {
    name: `langfuse:${model}:${mode}`,
    model,
    mode,
    provider,
  };

  // CRB items have no fullContent — split the multi-file diff into per-file FileInfos
  if (itemInput.source === 'crb' || (!itemInput.fullContent && !itemInput.fileContent)) {
    const { runReviewMultiFile } = require('../src/provider');
    const rawDiff = itemInput.diff || '';
    const files = splitMultiFileDiff(rawDiff);
    if (files.length === 0) {
      return { issues: [], durationMs: 0 };
    }
    return runReviewMultiFile(files, evalConfig);
  }

  const { runReview } = require('../src/provider');
  const rawContent = itemInput.fullContent || '';
  const rawDiff = itemInput.diff || '';

  const evalCase = {
    id: itemInput.caseId || 'langfuse-case',
    language: itemInput.language || 'typescript',
    filePath: itemInput.filePath || 'unknown.ts',
    diff: rawDiff,
    fullContent: rawContent,
    expected: [],
  };

  return runReview(evalCase, evalConfig);
}

// ─── Concurrency helper ───────────────────────────────────────────────────────

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

// ─── Main eval loop ───────────────────────────────────────────────────────────

async function runEvalItem(langfuse, item, itemIndex, total, datasetName) {
  try {
    return await _runEvalItem(langfuse, item, itemIndex, total, datasetName);
  } catch (err) {
    console.error(`  [${itemIndex + 1}/${total}] UNCAUGHT ERROR: ${err.message || err}`);
    console.error('  Stack:', err.stack || String(err));
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
    input: itemInput,
    metadata: {
      dataset: datasetName,
      experiment: experimentName,
      model,
      mode,
      provider,
      caseId,
      source: itemInput.source,
      filePath: itemInput.filePath,
      language: itemInput.language,
    },
    tags: ['eval', itemInput.source || 'unknown', mode],
  });

  const generation = trace.generation({
    name: 'review',
    model,
    modelParameters: { mode, provider },
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
    const result = await runReviewForItem(itemInput);
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
    generation.end({ output: { error: reviewError }, level: 'ERROR', statusMessage: reviewError });
    trace.update({ output: { error: reviewError } });
    console.error(`  [${itemIndex + 1}/${total}] ${caseId} ERROR: ${reviewError}`);
    console.error('  Stack:', err.stack || err);
  }

  // Flush so the trace/generation exist before linking
  await langfuse.flushAsync();

  // Link trace to dataset run item
  try {
    await langfuse.api.datasetRunItemsCreate({
      datasetItemId: item.id,
      traceId: trace.id,
      runName: experimentName,
      metadata: { durationMs },
    });
  } catch (err) {
    console.error(`  Failed to link dataset run item: ${err.message || JSON.stringify(err)}`);
  }

  // Score
  if (!reviewError) {
    const source = itemInput.source;

    let scores;
    if (skipJudge) {
      const parseResult = scoreParser(issues);
      const lineResult = scoreLineAccuracy(issues, referenceBugs);
      const coverageResult = scoreCoverage(issues, referenceExpected);
      const severityResult = scoreSeverity(issues, referenceExpected);
      scores = [
        { name: 'parse', value: parseResult.score, comment: parseResult.reason },
        { name: 'line_accuracy', value: lineResult.score, comment: lineResult.reason },
        { name: 'coverage', value: coverageResult.score, comment: coverageResult.reason },
        { name: 'severity', value: severityResult.score, comment: severityResult.reason },
      ].filter((s) => s.value !== null);
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

    const summary = scores.map((s) => `${s.name}=${s.value.toFixed(3)}`).join(' ');
    console.log(`  [${itemIndex + 1}/${total}] ${caseId} issues=${issues.length} ${summary}`);
  }

  return { caseId, issues, reviewError };
}

async function runDataset(langfuse, datasetName) {
  console.log(`\n═══ Dataset: ${datasetName} ═══`);

  try {
    await langfuse.api.datasetsGet(encodeURIComponent(datasetName));
  } catch (err) {
    console.error(`Error: could not fetch dataset "${datasetName}": ${err.message}`);
    console.error('Make sure to upload the dataset first: npm run eval:upload:all');
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

  if (limit < Infinity) {
    allItems = allItems.slice(0, limit);
  }

  console.log(`Found ${allItems.length} items. Running with concurrency=${concurrency}...\n`);

  const results = { total: allItems.length, passed: 0, errors: 0 };

  const tasks = allItems.map((item, i) => () => runEvalItem(langfuse, item, i, allItems.length, datasetName));
  const runResults = await runWithConcurrency(tasks, concurrency);

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

  const datasets = resolveDatasets();

  console.log(`Langfuse host: ${langfuseHost}`);
  console.log(`Datasets: ${datasets.join(', ')}`);
  console.log(`Experiment: ${experimentName}`);
  console.log(`Model: ${model} | Mode: ${mode} | Provider: ${provider}`);
  if (skipJudge) console.log('Judge scorer: disabled');

  const totals = { total: 0, errors: 0 };

  for (const ds of datasets) {
    const r = await runDataset(langfuse, ds);
    totals.total += r.total;
    totals.errors += r.errors;
  }

  await langfuse.shutdownAsync();

  console.log('\n─── Results ───────────────────────────────────────');
  console.log(`Datasets: ${datasets.length} | Total: ${totals.total} | Errors: ${totals.errors}`);
  console.log(`Experiment: ${experimentName}`);
  console.log(`View at: ${langfuseHost}`);
  console.log('──────────────────────────────────────────────────');
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
  });
}

module.exports = { parseDiffLines, resolveDatasets, CRB_REPOS };
