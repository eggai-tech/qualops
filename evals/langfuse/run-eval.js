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

const CRB_REPOS = ['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak'];

// ─── Preset resolution ──────────────────────────────────────────────────────

const PRESETS_DIR = path.join(QUALOPS_ROOT, 'evals/qualopsrc');
const DEFAULT_QUALOPSRC = '.qualops/.qualopsrc.json';

function resolvePreset(name) {
  if (!name || name === 'default') return null; // use default .qualopsrc.json
  const presetFile = path.join(PRESETS_DIR, `${name}.json`);
  if (!fs.existsSync(presetFile)) {
    const available = listPresets().join(', ') || '(none)';
    throw new Error(`Unknown preset: "${name}". Available: ${available}`);
  }
  return presetFile;
}

function listPresets() {
  if (!fs.existsSync(PRESETS_DIR)) return [];
  return fs.readdirSync(PRESETS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''));
}

function readPresetMeta(presetFile) {
  try {
    const config = JSON.parse(fs.readFileSync(presetFile, 'utf-8'));
    return {
      model: config.ai?.reviewStage?.model,
      mode: config.review?.pipeline?.find((j) => j.enabled)?.mode || 'file-by-file',
    };
  } catch {
    return {};
  }
}

if (args['list-presets'] === 'true') {
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

const presetName = args.preset || null;
const presetFile = resolvePreset(presetName);

// Read model/mode defaults from preset if available
let presetMeta = {};
if (presetFile) {
  presetMeta = readPresetMeta(presetFile);
}

// CLI flags override preset values
const mode = args.mode || presetMeta.mode || 'file-by-file';
const model = args.model || presetMeta.model || 'claude-sonnet-4-20250514';
const provider = args.provider || 'anthropic';
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;
const skipJudge = args['no-judge'] === 'true';
const presetLabel = presetName || 'default';
const experimentName = args.experiment || `${presetLabel}:${model}:${mode}:${new Date().toISOString().slice(0, 16)}`;
const concurrency = args.concurrency ? parseInt(args.concurrency, 10) : 3;

// Relative path from qualops root for ConfigService.setConfigPath()
const configPath = presetFile ? path.relative(QUALOPS_ROOT, presetFile) : DEFAULT_QUALOPSRC;

const LOGS_DIR = path.join(QUALOPS_ROOT, 'evals/langfuse/logs');

// ─── Run log collector ───────────────────────────────────────────────────────

function createRunLog() {
  const startedAt = new Date().toISOString();
  const entries = [];

  return {
    add(entry) {
      entries.push({ timestamp: new Date().toISOString(), ...entry });
    },
    write() {
      fs.mkdirSync(LOGS_DIR, { recursive: true });

      const errors = entries.filter((e) => e.level === 'error');
      const warnings = entries.filter((e) => e.level === 'warn');
      const successes = entries.filter((e) => e.level === 'info' && e.event === 'item_complete');

      const summary = {
        experiment: experimentName,
        preset: presetLabel,
        configPath,
        model,
        mode,
        provider,
        startedAt,
        finishedAt: new Date().toISOString(),
        totals: {
          items: successes.length + errors.length,
          successes: successes.length,
          errors: errors.length,
          warnings: warnings.length,
        },
        errorBreakdown: {},
        warningBreakdown: {},
        entries,
      };

      for (const e of errors) {
        const code = e.errorCode || 'UNKNOWN';
        summary.errorBreakdown[code] = (summary.errorBreakdown[code] || 0) + 1;
      }

      for (const w of warnings) {
        const code = w.warnCode || 'UNKNOWN';
        summary.warningBreakdown[code] = (summary.warningBreakdown[code] || 0) + 1;
      }

      const slug = experimentName.replace(/[/:]/g, '_');
      const logFile = path.join(LOGS_DIR, `${slug}.json`);
      fs.writeFileSync(logFile, JSON.stringify(summary, null, 2) + '\n');
      return logFile;
    },
  };
}

function classifyError(err) {
  const msg = (err.message || String(err)).toLowerCase();
  if (msg.includes('rate') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('401') || msg.includes('403') || msg.includes('auth') || msg.includes('credentials')) return 'AUTH_FAILED';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('aborted')) return 'TIMEOUT';
  if (msg.includes('budget')) return 'BUDGET_EXHAUSTED';
  if (msg.includes('parse') || msg.includes('json') || msg.includes('unexpected token')) return 'PARSE_ERROR';
  if (msg.includes('econnrefused') || msg.includes('enotfound') || msg.includes('fetch failed')) return 'NETWORK_ERROR';
  if (msg.includes('500') || msg.includes('502') || msg.includes('503') || msg.includes('overloaded')) return 'API_ERROR';
  return 'UNKNOWN';
}

const runLog = createRunLog();

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

function resolveRepoCwd(itemInput) {
  if (!itemInput.git?.repo_path) {
    runLog.add({
      level: 'warn',
      event: 'missing_git_metadata',
      warnCode: 'NO_REPO_PATH',
      caseId: itemInput.caseId,
      message: 'Dataset item has no git.repo_path — agentic tools will use qualops root',
    });
    return null;
  }
  const repoPath = path.resolve(QUALOPS_ROOT, itemInput.git.repo_path);
  if (!fs.existsSync(repoPath)) {
    console.warn(`  WARN: repo path not found: ${repoPath} (run npm run eval:fetch:crb to clone repos)`);
    runLog.add({
      level: 'warn',
      event: 'repo_not_found',
      warnCode: 'REPO_NOT_CLONED',
      caseId: itemInput.caseId,
      repoPath: itemInput.git.repo_path,
      message: `Repo not cloned at ${repoPath} — agentic tools will use qualops root`,
    });
    return null;
  }
  // Checkout the PR head commit so agentic tools see the right code
  if (itemInput.git.head_sha) {
    const { spawnSync } = require('child_process');
    const result = spawnSync('git', ['checkout', '--quiet', itemInput.git.head_sha], {
      cwd: repoPath, encoding: 'utf-8', stdio: 'pipe',
    });
    if (result.status !== 0) {
      console.warn(`  WARN: could not checkout ${itemInput.git.head_sha.slice(0, 8)}: ${result.stderr?.trim()}`);
      runLog.add({
        level: 'warn',
        event: 'checkout_failed',
        warnCode: 'CHECKOUT_FAILED',
        caseId: itemInput.caseId,
        sha: itemInput.git.head_sha,
        message: result.stderr?.trim() || 'git checkout failed',
      });
    }
  }
  return repoPath;
}

async function runReviewForItem(itemInput) {
  await ensureInit();

  const repoCwd = resolveRepoCwd(itemInput);

  const evalConfig = {
    name: `langfuse:${model}:${mode}`,
    model,
    mode,
    provider,
    configPath,
    ...(repoCwd && { cwd: repoCwd }),
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
    runLog.add({
      level: 'error',
      event: 'langfuse_link_error',
      errorCode: 'LANGFUSE_API',
      dataset: datasetName,
      caseId,
      message: err.message || JSON.stringify(err),
    });
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
  console.log(`Preset: ${presetLabel} (${configPath})`);
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

  const logFile = runLog.write();

  const logData = JSON.parse(fs.readFileSync(logFile, 'utf-8'));
  const warnCount = logData.totals.warnings;

  console.log('\n─── Results ───────────────────────────────────────');
  console.log(`Datasets: ${datasets.length} | Total: ${totals.total} | Errors: ${totals.errors} | Warnings: ${warnCount}`);
  console.log(`Experiment: ${experimentName}`);
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

module.exports = { parseDiffLines, resolveDatasets, classifyError, createRunLog, resolvePreset, listPresets, CRB_REPOS };
