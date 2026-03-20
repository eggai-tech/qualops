#!/usr/bin/env node

/**
 * Fetch Code Review Bench (CRB) dataset from GitHub and convert to JSONL.
 *
 * Usage:
 *   node fetch-crb-dataset.js                          # all 50 PRs
 *   node fetch-crb-dataset.js --repo=sentry            # one repo subset
 *   node fetch-crb-dataset.js --repo=grafana --limit=3 # limit per repo
 *
 * Repos: sentry (python), grafana (go), cal_dot_com (typescript),
 *        discourse (ruby), keycloak (java)
 *
 * Requires: gh CLI authenticated (gh auth login)
 *
 * Output: evals/datasets/crb/<repo>.jsonl (one file per repo)
 *
 * Each JSONL line matches the shape expected by convert-dataset.js source=crb:
 * {
 *   id, pr_url, pr_title, source_repo, language,
 *   diff,         // unified diff string fetched from GitHub
 *   expected: [{ line, lineEnd, type, severity, description }]
 * }
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const QUALOPS_ROOT = path.join(SCRIPT_DIR, '../..');
const OUT_DIR = path.join(QUALOPS_ROOT, 'evals/datasets/crb');

// Golden comments are fetched directly from the upstream CRB repo
const CRB_GITHUB_REPO = 'withmartian/code-review-benchmark';
const CRB_GOLDEN_PATH = 'offline/golden_comments';

const REPO_LANGUAGE = {
  sentry: 'python',
  grafana: 'go',
  cal_dot_com: 'typescript',
  discourse: 'ruby',
  keycloak: 'java',
};

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v || 'true'];
    }),
);

const filterRepo = args.repo || null;
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

fs.mkdirSync(OUT_DIR, { recursive: true });

function ghFetchDiff(prUrl) {
  // Extract owner/repo/pull-number from URL
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  const [, owner, repo, number] = m;

  const result = spawnSync(
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${number}`, '--header', 'Accept: application/vnd.github.diff'],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024, env: process.env },
  );

  if (result.status !== 0) {
    console.warn(`  WARN: gh api failed for ${prUrl}: ${result.stderr?.trim()}`);
    return null;
  }
  return result.stdout;
}

function fetchGoldenComments(repoSlug) {
  const result = spawnSync(
    'gh',
    ['api', `repos/${CRB_GITHUB_REPO}/contents/${CRB_GOLDEN_PATH}/${repoSlug}.json`,
      '--jq', '.content',
    ],
    { encoding: 'utf-8', env: process.env },
  );
  if (result.status !== 0) {
    console.warn(`  WARN: could not fetch golden comments for ${repoSlug}: ${result.stderr?.trim()}`);
    return null;
  }
  // GitHub API returns base64-encoded content
  const content = Buffer.from(result.stdout.trim().replace(/\n/g, ''), 'base64').toString('utf-8');
  return JSON.parse(content);
}

function processRepo(repoSlug) {
  console.log(`\n[${repoSlug}] Fetching golden comments from ${CRB_GITHUB_REPO}...`);
  const entries = fetchGoldenComments(repoSlug);
  if (!entries) {
    console.warn(`  SKIP: no golden comments for ${repoSlug}`);
    return;
  }
  const language = REPO_LANGUAGE[repoSlug] || 'unknown';
  const outFile = path.join(OUT_DIR, `${repoSlug}.jsonl`);
  const lines = [];
  const toProcess = entries.slice(0, limit);

  console.log(`\n[${repoSlug}] ${toProcess.length} PRs → ${outFile}`);

  for (let i = 0; i < toProcess.length; i++) {
    const entry = toProcess[i];
    const { pr_title, url, comments = [] } = entry;
    console.log(`  [${i + 1}/${toProcess.length}] ${pr_title}`);

    const diff = ghFetchDiff(url);
    if (!diff) {
      console.warn(`  SKIP: could not fetch diff for ${url}`);
      continue;
    }

    const expected = comments.map((c) => ({
      // No line numbers in CRB golden comments — line matching is N/A for this dataset.
      // Line accuracy assertion will skip gracefully when line=null.
      line: null,
      lineEnd: null,
      type: 'bug',
      severity: (c.severity || 'medium').toLowerCase(),
      description: c.comment,
    }));

    lines.push(
      JSON.stringify({
        id: `crb-${repoSlug}-${i + 1}`,
        pr_url: url,
        pr_title,
        source_repo: repoSlug,
        language,
        diff,
        expected,
      }),
    );
  }

  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  console.log(`  Written ${lines.length} records.`);
}

const repos = filterRepo ? [filterRepo] : Object.keys(REPO_LANGUAGE);

// Check gh is available
const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', env: process.env });
if (ghCheck.status !== 0) {
  console.error('ERROR: gh CLI not authenticated. Run: gh auth login');
  process.exit(1);
}

// Fetch benchmark_data.json (tool reviews + golden comments combined).
// Too large for the contents API — use raw download instead.
function fetchBenchmarkData() {
  const outFile = path.join(OUT_DIR, 'benchmark_data.json');
  if (fs.existsSync(outFile)) {
    console.log('\n[benchmark_data] Already exists, skipping (delete to re-fetch)');
    return;
  }
  console.log('\n[benchmark_data] Downloading from GitHub raw...');
  const result = spawnSync(
    'gh',
    ['api', `repos/${CRB_GITHUB_REPO}/git/blobs/:tree_sha`,
      '--header', 'Accept: application/vnd.github.raw',
    ],
    { encoding: 'utf-8', env: process.env },
  );
  // Use curl via gh auth token as fallback for large files
  const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf-8', env: process.env });
  if (token.status !== 0) {
    console.warn('  WARN: could not get gh token, skipping benchmark_data.json');
    return;
  }
  const rawUrl = `https://raw.githubusercontent.com/${CRB_GITHUB_REPO}/main/offline/results/benchmark_data.json`;
  const dl = spawnSync(
    'curl',
    ['-fsSL', '-H', `Authorization: Bearer ${token.stdout.trim()}`, rawUrl, '-o', outFile],
    { encoding: 'utf-8', env: process.env },
  );
  if (dl.status !== 0) {
    console.warn(`  WARN: could not download benchmark_data.json: ${dl.stderr?.trim()}`);
    return;
  }
  console.log(`  Written ${outFile}`);
}

console.log(`Fetching CRB dataset (repos: ${repos.join(', ')})...`);
for (const repo of repos) {
  processRepo(repo);
}
fetchBenchmarkData();
console.log('\nDone.');
