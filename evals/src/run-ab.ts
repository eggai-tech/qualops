/**
 * A/B (or A/B/C/…) harness for QualOps config changes: run N config files against
 * the same dataset and compare quality (precision/recall/F1) and cost/latency. Use
 * it to test per-stage model choices, budgets, prompts, or pipeline modes.
 *
 * Each arm runs the exact pipeline defined in its config file — no `--mode` is
 * passed, so model/budgets/prompts/mode all come from the config. Make configs that
 * differ only in the knob under test to isolate its effect.
 *
 * Run-logs are written to `evals/logs/`; the comparison reads them from there.
 *
 * Usage:
 *   npx tsx evals/src/run-ab.ts <A.json> <B.json> [<C.json> ...]     # smoke: 1 item/arm
 *   npx tsx evals/src/run-ab.ts --full <A.json> <B.json> [...]       # REPEATS runs/arm
 *
 * Env: DATASET (default qualops/crb-sentry), REPEATS (full mode, default 1),
 *      LIMIT (items/run). Requires the provider key your configs use (loaded via
 *      the `eval:ab` npm alias's --env-file=.env).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { compareEvalLogs } from './compare-experiments';

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

function main(): void {
  const argv = process.argv.slice(2);
  const full = argv[0] === '--full';
  const configs = (full ? argv.slice(1) : argv).filter((a) => !a.startsWith('--'));

  if (configs.length < 2) {
    console.error(
      'Usage: run-ab.ts [--full] <A.json> <B.json> [<C.json> ...]\n' +
        '  e.g. run-ab.ts .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json\n' +
        '  Run-logs are written to evals/logs/ and compared from there.',
    );
    process.exit(2);
  }

  if (!process.env.ANTHROPIC_API_KEY && !process.env.OPENAI_API_KEY) {
    console.error(
      'ERROR: no provider key in the environment (ANTHROPIC_API_KEY / OPENAI_API_KEY).\n' +
        'Use `npm run eval:ab -- <A> <B>` (loads .env), or export the key first.',
    );
    process.exit(1);
  }

  const dataset = process.env.DATASET || 'qualops/crb-sentry';
  const repeats = full ? parseInt(process.env.REPEATS || '1', 10) : 1;
  const limitArg = process.env.LIMIT ? [`--limit=${process.env.LIMIT}`] : full ? [] : ['--limit=1'];
  const labels = configs.map(labelOf);

  console.log(
    `=== ${full ? 'FULL' : 'SMOKE'} A/B on ${dataset} — ${configs.length} arm(s)` +
      `${full ? `, ${repeats} repeat(s)` : ''} ===`,
  );

  for (let r = 1; r <= repeats; r++) {
    configs.forEach((config, i) => {
      const experiment = full ? [`--experiment=${labels[i]}-run${r}`] : [];
      console.log(`--- arm ${String.fromCharCode(65 + i)}${full ? ` run ${r}/${repeats}` : ''}: ${config} ---`);
      evalRun([`--config=${config}`, `--dataset=${dataset}`, '--no-judge', ...limitArg, ...experiment]);
    });
  }

  console.log('\n=== COMPARISON (latest run per arm) ===');
  compareEvalLogs(labels);
  console.log('\nAll run logs: evals/logs/');
}

main();
