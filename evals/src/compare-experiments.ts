/**
 * Compare two eval experiment run-logs side by side — the A/B primitive for
 * QualOps config changes (per-stage model, budgets, prompts, pipeline mode).
 * Reads the structured JSON logs written by run-log.ts under evals/logs/ and
 * reports mean precision / recall / F1, issue counts, and duration per arm, plus
 * the headline deltas.
 *
 * Usage:
 *   npx tsx evals/src/compare-experiments.ts <baselineLabel> <candidateLabel>
 *   # labels are the presetLabel prefix of the log filename; the latest log
 *   # matching each label is used.
 *
 *   npx tsx evals/src/compare-experiments.ts --a=<path-to-log.json> --b=<path-to-log.json>
 */
import fs from 'node:fs';
import path from 'node:path';

import { LOGS_DIR } from './config';

interface LogEntry {
  level: string;
  event: string;
  caseId?: string;
  issueCount?: number;
  durationMs?: number;
  scores?: Record<string, number | null>;
}

interface RunLogFile {
  experimentName: string;
  preset: string;
  model: string;
  mode: string;
  startedAt: string;
  finishedAt: string;
  totals: { successes: number; errors: number; warnings: number };
  entries: LogEntry[];
}

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

/** Latest log file whose name starts with `<label>` (the run-log naming scheme). */
function latestLogForLabel(label: string): string {
  if (!fs.existsSync(LOGS_DIR)) throw new Error(`No logs dir at ${LOGS_DIR}`);
  const matches = fs
    .readdirSync(LOGS_DIR)
    .filter((f) => f.endsWith('.json') && f.startsWith(label))
    .map((f) => path.join(LOGS_DIR, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  if (matches.length === 0) {
    throw new Error(`No log file found in ${LOGS_DIR} starting with "${label}"`);
  }
  return matches[0];
}

function loadArm(label: string, explicitPath?: string): ArmStats {
  const file = explicitPath ?? latestLogForLabel(label);
  const log = JSON.parse(fs.readFileSync(file, 'utf-8')) as RunLogFile;
  const completed = log.entries.filter((e) => e.level === 'info' && e.event === 'item_complete');

  const precision = completed.map((e) => e.scores?.crb_precision).filter((v): v is number => v != null);
  const recall = completed.map((e) => e.scores?.crb_recall).filter((v): v is number => v != null);
  const f1 = completed.map((e) => e.scores?.crb_f1).filter((v): v is number => v != null);

  return {
    label,
    file: path.relative(process.cwd(), file),
    mode: log.mode,
    model: log.model,
    items: completed.length,
    errors: log.totals.errors,
    meanPrecision: mean(precision),
    meanRecall: mean(recall),
    meanF1: mean(f1),
    meanIssues: mean(completed.map((e) => e.issueCount ?? 0)) ?? 0,
    meanDurationMs: mean(completed.map((e) => e.durationMs ?? 0)) ?? 0,
  };
}

function fmt(x: number | null, digits = 3): string {
  return x == null ? '  n/a' : x.toFixed(digits);
}

function delta(a: number | null, b: number | null): string {
  if (a == null || b == null) return '  n/a';
  const d = b - a;
  const sign = d > 0 ? '+' : '';
  return `${sign}${d.toFixed(3)}`;
}

function main(): void {
  const args = process.argv.slice(2);
  const aFlag = args.find((a) => a.startsWith('--a='))?.slice(4);
  const bFlag = args.find((a) => a.startsWith('--b='))?.slice(4);
  const positional = args.filter((a) => !a.startsWith('--'));

  let baseline: ArmStats;
  let candidate: ArmStats;

  if (aFlag && bFlag) {
    baseline = loadArm(path.basename(aFlag, '.json'), aFlag);
    candidate = loadArm(path.basename(bFlag, '.json'), bFlag);
  } else {
    const [baseLabel, candLabel] = positional;
    if (!baseLabel || !candLabel) {
      throw new Error(
        'Provide two experiment labels (or --a=<log> --b=<log>): compare-experiments <baseline> <candidate>',
      );
    }
    baseline = loadArm(baseLabel);
    candidate = loadArm(candLabel);
  }

  const rows: Array<[string, string, string, string]> = [
    ['metric', 'baseline (A)', 'candidate (B)', 'delta (B-A)'],
    ['mode', baseline.mode, candidate.mode, ''],
    ['model', baseline.model, candidate.model, ''],
    ['items', String(baseline.items), String(candidate.items), ''],
    ['errors', String(baseline.errors), String(candidate.errors), ''],
    ['precision', fmt(baseline.meanPrecision), fmt(candidate.meanPrecision), delta(baseline.meanPrecision, candidate.meanPrecision)],
    ['recall', fmt(baseline.meanRecall), fmt(candidate.meanRecall), delta(baseline.meanRecall, candidate.meanRecall)],
    ['f1', fmt(baseline.meanF1), fmt(candidate.meanF1), delta(baseline.meanF1, candidate.meanF1)],
    ['mean issues', fmt(baseline.meanIssues, 1), fmt(candidate.meanIssues, 1), delta(baseline.meanIssues, candidate.meanIssues)],
    ['mean ms', String(Math.round(baseline.meanDurationMs)), String(Math.round(candidate.meanDurationMs)), delta(baseline.meanDurationMs, candidate.meanDurationMs)],
  ];

  const widths = [0, 1, 2, 3].map((col) => Math.max(...rows.map((r) => r[col].length)));
  const line = (r: [string, string, string, string]) =>
    r.map((c, i) => c.padEnd(widths[i])).join('  │  ');

  console.log(`\nBaseline (A): ${baseline.file}`);
  console.log(`Candidate (B): ${candidate.file}\n`);
  console.log(line(rows[0]));
  console.log(widths.map((w) => '─'.repeat(w)).join('──┼──'));
  for (const r of rows.slice(1)) console.log(line(r));

  const dp = candidate.meanPrecision != null && baseline.meanPrecision != null
    ? candidate.meanPrecision - baseline.meanPrecision : null;
  const dr = candidate.meanRecall != null && baseline.meanRecall != null
    ? candidate.meanRecall - baseline.meanRecall : null;
  console.log('');
  if (dp != null && dr != null) {
    const precisionUp = dp >= 0;
    const recallHeld = dr >= -0.001;
    console.log(
      precisionUp && recallHeld
        ? '✅ Candidate improves (or holds) precision and recall vs baseline.'
        : '⚠️  Candidate regresses on precision and/or recall vs baseline.',
    );
    console.log(`   Δprecision=${dp.toFixed(3)}  Δrecall=${dr.toFixed(3)}`);
  } else {
    console.log('⚠️  Precision/recall not available on one or both arms (CRB scorers only run on CRB datasets).');
  }
  console.log('\nNote: small-N runs are noisy — confirm with N>=3 repeats before concluding.');
}

try {
  main();
} catch (err) {
  console.error(`\ncompare-experiments: ${(err as Error).message}`);
  process.exit(1);
}
