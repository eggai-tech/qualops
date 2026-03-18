#!/usr/bin/env node

/**
 * Usage:
 *   node run-eval.js                                          # QualOps dataset
 *   node run-eval.js --source=kodus --lang=tsjs               # Kodus TS/JS only
 *   node run-eval.js --source=kodus --lang=all --limit=5      # All Kodus, 5 per lang
 *   node run-eval.js --source=kodus --dataset-type=normal     # Kodus non-crossfile
 *   node run-eval.js --source=crb                             # Code Review Bench (all repos)
 *   node run-eval.js --source=crb --repo=sentry               # CRB sentry (python) only
 *   node run-eval.js --source=crb --repo=grafana --limit=3    # CRB grafana, 3 PRs
 *   node run-eval.js --source=crb --repo=keycloak             # CRB keycloak (java) only
 *
 * CRB repos: sentry (python), grafana (go), cal_dot_com (typescript),
 *            discourse (ruby), keycloak (java)
 *
 * Fetch CRB dataset first (requires gh CLI):
 *   npm run eval:fetch-crb
 *   npm run eval:fetch-crb -- --repo=sentry
 */

const { execSync } = require('child_process');
const { existsSync, mkdirSync, copyFileSync } = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const QUALOPS_ROOT = path.join(SCRIPT_DIR, '../..');

try {
  require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
} catch {
  // dotenv not installed; rely on shell env
}

const CONVERT_FLAGS = ['--source', '--lang', '--limit', '--dir', '--dataset-type', '--repo'];
const convertArgs = [];
const promptfooArgs = [];

for (const arg of process.argv.slice(2)) {
  const flag = arg.split('=')[0];
  if (CONVERT_FLAGS.includes(flag)) {
    convertArgs.push(arg);
  } else {
    promptfooArgs.push(arg);
  }
}

mkdirSync(path.join(SCRIPT_DIR, 'datasets'), { recursive: true });
mkdirSync(path.join(SCRIPT_DIR, 'results'), { recursive: true });

const ts = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
const outputFile = path.join(SCRIPT_DIR, `results/output-${ts}.json`);

function run(cmd) {
  console.log(`> ${cmd}\n`);
  execSync(cmd, { cwd: SCRIPT_DIR, stdio: 'inherit' });
}

console.log('Converting dataset...');
run(`node convert-dataset.js ${convertArgs.join(' ')}`);

console.log('\nRunning promptfoo eval...');
try {
  run(
    `npx promptfoo eval -c promptfoo.yaml -o ${outputFile} ${promptfooArgs.join(' ')}`,
  );
} catch {
  // promptfoo exits non-zero on assertion failures
}

if (existsSync(outputFile)) {
  console.log(`\nResults saved: results/${path.basename(outputFile)}`);
}

console.log('\nDone. View results with: npm run eval:view');
