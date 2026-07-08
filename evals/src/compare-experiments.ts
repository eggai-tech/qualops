/**
 * Compare N eval run-logs side by side — the A/B (or A/B/C/…) primitive for QualOps
 * config changes. Reads the JSON logs written by run-log.ts under evals/logs/ and
 * reports mean precision / recall / F1, issue counts, and duration per arm.
 *
 * Each `--eval-log` is a log path or an experiment-label prefix (latest match wins):
 *   npx tsx evals/src/compare-experiments.ts --eval-log=qualopsrc --eval-log=qualopsrc-cheap
 */
import fs from 'node:fs';
import path from 'node:path';

import { LOGS_DIR } from './config';
import type { ItemCompleteEntry, RunLogFile } from './run-log';

interface ArmStats {
  label: string;
  file: string;
  mode: string;
  model: string;
  items: number;
  errors: number;
  meanPrecision: number | null;
  meanRecall: number | null;
  meanF1: number | null;
  meanIssues: number;
  meanDurationMs: number;
}

function mean(xs: number[]): number | null {
  const vals = xs.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/**
 * Resolve an `--eval-log` value to a log file: a path inside LOGS_DIR, or an
 * experiment-label prefix matching the latest `<label>-<ts>.json` there.
 * Reads are confined to LOGS_DIR — paths outside it, or prefixes with path
 * separators, are rejected.
 */
function resolveLog(ref: string): string {
  // A direct path is accepted only inside LOGS_DIR.
  const resolved = path.resolve(process.cwd(), ref);
  if (resolved.startsWith(LOGS_DIR + path.sep)) {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  // Otherwise treat ref as a label prefix — which must not itself be a path.
  if (ref.includes('/') || ref.includes(path.sep)) {
    throw new Error(
      `Unsafe --eval-log "${ref}": must be a file inside ${LOGS_DIR} or a bare label prefix.`,
    );
  }
  if (!fs.existsSync(LOGS_DIR)) {
    throw new Error(`"${ref}" is not a log in ${LOGS_DIR} and no logs dir exists there.`);
  }
  const matches = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.json') && f.startsWith(ref))
    .map((f) => path.join(LOGS_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (matches.length === 0) {
    throw new Error(
      `No log for "${ref}": not a file in ${LOGS_DIR}, and no ${LOGS_DIR}/${ref}*.json found.`,
    );
  }
  return matches[0];
}

function loadArm(ref: string): ArmStats {
  const file = resolveLog(ref);
  const log = JSON.parse(fs.readFileSync(file, 'utf-8')) as RunLogFile;
  const completed = log.entries.filter(
    (e): e is ItemCompleteEntry & { timestamp: string } =>
      e.level === 'info' && e.event === 'item_complete',
  );
  const num = (k: 'crb_precision' | 'crb_recall' | 'crb_f1') =>
    completed.map((e) => e.scores?.[k]).filter((v): v is number => v != null);

  return {
    label: path.basename(file).replace(/-\d+\.json$/, '').replace(/\.json$/, ''),
    file: path.relative(process.cwd(), file),
    mode: log.mode,
    model: log.model,
    items: completed.length,
    errors: log.totals.errors,
    meanPrecision: mean(num('crb_precision')),
    meanRecall: mean(num('crb_recall')),
    meanF1: mean(num('crb_f1')),
    meanIssues: mean(completed.map((e) => e.issueCount ?? 0)) ?? 0,
    meanDurationMs: mean(completed.map((e) => e.durationMs ?? 0)) ?? 0,
  };
}

function fmt(x: number | null, digits = 3): string {
  return x == null ? 'n/a' : x.toFixed(digits);
}

/** Compare N run-logs and print a metric × arm table (+ a 2-arm delta column). */
export function compareEvalLogs(refs: string[]): ArmStats[] {
  const arms = refs.map(loadArm);

  const header = ['metric', ...arms.map((_, i) => `arm ${String.fromCharCode(65 + i)}`)];
  if (arms.length === 2) header.push('Δ (B-A)');

  const metricRow = (
    name: string,
    pick: (a: ArmStats) => string,
    deltaOf?: (a: ArmStats) => number | null,
  ): string[] => {
    const row = [name, ...arms.map(pick)];
    if (arms.length === 2 && deltaOf) {
      const a = deltaOf(arms[0]);
      const b = deltaOf(arms[1]);
      row.push(a == null || b == null ? 'n/a' : (b - a >= 0 ? '+' : '') + (b - a).toFixed(3));
    } else if (arms.length === 2) {
      row.push('');
    }
    return row;
  };

  const rows: string[][] = [
    header,
    metricRow('mode', (a) => a.mode),
    metricRow('model', (a) => a.model),
    metricRow('items', (a) => String(a.items)),
    metricRow('errors', (a) => String(a.errors)),
    metricRow('precision', (a) => fmt(a.meanPrecision), (a) => a.meanPrecision),
    metricRow('recall', (a) => fmt(a.meanRecall), (a) => a.meanRecall),
    metricRow('f1', (a) => fmt(a.meanF1), (a) => a.meanF1),
    metricRow('mean issues', (a) => fmt(a.meanIssues, 1), (a) => a.meanIssues),
    metricRow('mean ms', (a) => String(Math.round(a.meanDurationMs)), (a) => a.meanDurationMs),
  ];

  const cols = rows[0].length;
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(...rows.map((r) => (r[c] ?? '').length)),
  );
  const line = (r: string[]) => r.map((c, i) => (c ?? '').padEnd(widths[i])).join('  │  ');

  console.log('');
  arms.forEach((a, i) => console.log(`arm ${String.fromCharCode(65 + i)}: ${a.file}`));
  console.log('');
  console.log(line(rows[0]));
  console.log(widths.map((w) => '─'.repeat(w)).join('──┼──'));
  for (const r of rows.slice(1)) console.log(line(r));

  if (arms.length === 2) {
    const dp =
      arms[1].meanPrecision != null && arms[0].meanPrecision != null
        ? arms[1].meanPrecision - arms[0].meanPrecision
        : null;
    const dr =
      arms[1].meanRecall != null && arms[0].meanRecall != null
        ? arms[1].meanRecall - arms[0].meanRecall
        : null;
    console.log('');
    if (dp != null && dr != null) {
      console.log(
        dp >= 0 && dr >= -0.001
          ? '✅ Arm B improves (or holds) precision and recall vs arm A.'
          : '⚠️  Arm B regresses on precision and/or recall vs arm A.',
      );
      console.log(`   Δprecision=${dp.toFixed(3)}  Δrecall=${dr.toFixed(3)}`);
    } else {
      console.log('⚠️  Precision/recall unavailable (CRB scorers only run on CRB datasets).');
    }
  }
  console.log('\nNote: small-N runs are noisy — confirm with N>=3 repeats before concluding.');
  return arms;
}

function main(): void {
  const refs = process.argv
    .slice(2)
    .filter((a) => a.startsWith('--eval-log='))
    .map((a) => a.slice('--eval-log='.length));

  if (refs.length < 2) {
    throw new Error(
      'Provide at least two --eval-log=<path-or-label> args.\n' +
        'Run-logs live in evals/logs/ — pass a file path or an experiment-label prefix.\n' +
        'e.g. compare-experiments --eval-log=qualopsrc --eval-log=qualopsrc-cheap',
    );
  }
  compareEvalLogs(refs);
}

// Only run as a CLI (allow importing compareEvalLogs from tests).
if (process.argv[1] && process.argv[1].endsWith('compare-experiments.ts')) {
  try {
    main();
  } catch (err) {
    console.error(`\ncompare-experiments: ${(err as Error).message}`);
    process.exit(1);
  }
}
