/**
 * A/B (or A/B/C/…) harness for QualOps config changes: run N config files against
 * the same dataset and compare quality (precision/recall/F1) and cost/latency —
 * for testing per-stage model choices, budgets, prompts, or pipeline modes.
 *
 * Each arm runs the exact pipeline in its config file (no `--mode` override), so
 * configs should differ only in the knob under test. Run-logs go to `evals/logs/`,
 * where the comparison reads them. Flags mirror run-eval (`--dataset`/`--limit`/
 * `--repeats`, env vars as fallbacks); see the usage string in `main()`.
 *
 *   npx tsx evals/src/run-ab.ts --config=<A.json> --config=<B.json> \
 *     [--dataset=<name> --limit=5 --repeats=3]
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { compareEvalLogs } from './compare-experiments';
import { resolveConfigFile } from './config';

const REPO_ROOT = path.join(__dirname, '../..');

/** Experiment label for a config file = its basename without extension, no leading dot. */
function labelOf(configPath: string): string {
  return path.basename(configPath, '.json').replace(/^\./, '');
}

/** Invoke run-eval.ts as a subprocess with the given args, inheriting stdio. */
function evalRun(args: string[]): void {
  const res = spawnSync('npx', ['tsx', 'evals/src/run-eval.ts', ...args], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (res.status !== 0) {
    throw new Error(`run-eval failed (exit ${res.status}) for args: ${args.join(' ')}`);
  }
}

/** Collect all values of a repeatable `--flag=value`. */
function multiFlag(argv: string[], flag: string): string[] {
  const p = `--${flag}=`;
  return argv.filter((a) => a.startsWith(p)).map((a) => a.slice(p.length)).filter(Boolean);
}
/** Read the last value of a `--flag=value`, or undefined. */
function singleFlag(argv: string[], flag: string): string | undefined {
  return multiFlag(argv, flag).at(-1);
}

function main(): void {
  const argv = process.argv.slice(2);

  const configs = multiFlag(argv, 'config');

  if (configs.length < 2) {
    console.error(
      'Usage: run-ab.ts --config=<A.json> --config=<B.json> [--config=<C.json> ...]\n' +
        '            [--dataset=<name>] [--limit=<N>] [--repeats=<N>]\n' +
        '  e.g. run-ab.ts --config=.qualops/.qualopsrc.json --config=.qualops/.qualopsrc-cheap.json\n' +
        '  Defaults: full CRB suite (--dataset=qualops/crb-sentry), all items, 1 repeat.\n' +
        '  Run-logs are written to evals/logs/ and compared from there.',
    );
    process.exit(2);
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      'ERROR: no provider key in the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY).\n' +
        'Use `npm run eval:ab -- --config=<A> --config=<B>` (loads .env), or export the key first.',
    );
    process.exit(1);
  }

  // Validate all configs before any arm runs, so a bad path fails fast rather than
  // after an earlier arm has already completed a costly review.
  for (const config of configs) {
    try {
      resolveConfigFile(config);
    } catch (err) {
      console.error(`ERROR: ${(err as Error).message}`);
      process.exit(2);
    }
  }

  const dataset = singleFlag(argv, 'dataset') || process.env.DATASET || 'qualops/crb-sentry';
  const limit = singleFlag(argv, 'limit') ?? process.env.LIMIT; // undefined -> all items
  const repeatsRaw = singleFlag(argv, 'repeats') || process.env.REPEATS || '1';
  const repeats = parseInt(repeatsRaw, 10);
  if (!Number.isInteger(repeats) || repeats < 1) {
    console.error(`ERROR: --repeats must be a positive integer (got: "${repeatsRaw}").`);
    process.exit(2);
  }
  const limitArg = limit ? [`--limit=${limit}`] : [];
  const labels = configs.map(labelOf);

  console.log(
    `=== A/B on ${dataset} — ${configs.length} arm(s), ${repeats} repeat(s)` +
      `${limit ? `, limit=${limit}` : ', full suite'} ===`,
  );

  for (let r = 1; r <= repeats; r++) {
    configs.forEach((config, i) => {
      // Distinct experiment label per repeat so compareEvalLogs picks the latest.
      const experiment = repeats > 1 ? [`--experiment=${labels[i]}-run${r}`] : [];
      console.log(
        `--- arm ${String.fromCharCode(65 + i)}${repeats > 1 ? ` run ${r}/${repeats}` : ''}: ${config} ---`,
      );
      evalRun([`--config=${config}`, `--dataset=${dataset}`, '--no-judge', ...limitArg, ...experiment]);
    });
  }

  console.log('\n=== COMPARISON (latest run per arm) ===');
  compareEvalLogs(labels);
  console.log('\nAll run logs: evals/logs/');
}

main();
