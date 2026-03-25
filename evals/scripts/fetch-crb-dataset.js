#!/usr/bin/env node

/**
 * Fetch Code Review Bench (CRB) dataset from GitHub and convert to JSONL.
 * Also clones source repos so agentic evals can access the full codebase.
 *
 * Usage:
 *   node fetch-crb-dataset.js                          # all 50 PRs
 *   node fetch-crb-dataset.js --repo=sentry            # one repo subset
 *   node fetch-crb-dataset.js --repo=grafana --limit=3 # limit per repo
 *   node fetch-crb-dataset.js --skip-repos             # skip repo cloning
 *
 * Repos: sentry (python), grafana (go), cal_dot_com (typescript),
 *        discourse (ruby), keycloak (java)
 *
 * Requires: gh CLI authenticated (gh auth login)
 *
 * Output:
 *   evals/datasets/crb/<repo>.jsonl  — dataset with diffs, golden comments, git refs
 *   evals/repos/<owner>/<repo>/      — shallow-cloned source repos (cached)
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SCRIPT_DIR = __dirname;
const QUALOPS_ROOT = path.join(SCRIPT_DIR, '../..');
const OUT_DIR = path.join(QUALOPS_ROOT, 'evals/datasets/crb');
const REPOS_DIR = path.join(OUT_DIR, 'repos');

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
const skipRepos = args['skip-repos'] === 'true';

fs.mkdirSync(OUT_DIR, { recursive: true });

function ghFetchDiff(prUrl) {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  const [, owner, repo, number] = m;

  const result = spawnSync(
    'gh',
    ['api', `repos/${owner}/${repo}/pulls/${number}`, '--header', 'Accept: application/vnd.github.diff'],
    { encoding: 'utf-8', maxBuffer: 10 * 1024 * 1024 },
  );

  if (result.status !== 0) {
    console.warn(`  WARN: gh api failed for ${prUrl}: ${result.stderr?.trim()}`);
    return null;
  }
  return result.stdout;
}

function parsePrUrl(prUrl) {
  const m = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!m) return null;
  return { owner: m[1], repo: m[2], number: parseInt(m[3], 10) };
}

function ghFetchPrRefs(prUrl) {
  const pr = parsePrUrl(prUrl);
  if (!pr) return null;

  const result = spawnSync(
    'gh',
    ['api', `repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`,
      '--jq', '{base_sha: .base.sha, head_sha: .head.sha, base_ref: .base.ref, head_ref: .head.ref, clone_url: .head.repo.clone_url}',
    ],
    { encoding: 'utf-8', env: ghEnv },
  );

  if (result.status !== 0) {
    console.warn(`  WARN: could not fetch PR refs for ${prUrl}: ${result.stderr?.trim()}`);
    return null;
  }

  try {
    return JSON.parse(result.stdout.trim());
  } catch {
    console.warn(`  WARN: invalid JSON from PR refs for ${prUrl}`);
    return null;
  }
}


function ensureRepoCloned(owner, repo, cloneUrl) {
  const repoDir = path.join(REPOS_DIR, owner, repo);
  if (fs.existsSync(path.join(repoDir, '.git'))) {
    return repoDir;
  }

  console.log(`  Cloning ${owner}/${repo} (shallow)...`);
  fs.mkdirSync(path.join(REPOS_DIR, owner), { recursive: true });

  const url = cloneUrl || `https://github.com/${owner}/${repo}.git`;
  const result = spawnSync(
    'git',
    ['clone', '--depth=1', '--no-single-branch', '--filter=blob:none', url, repoDir],
    { encoding: 'utf-8', stdio: 'pipe', env: ghEnv },
  );

  if (result.status !== 0) {
    console.warn(`  WARN: clone failed for ${owner}/${repo}: ${result.stderr?.trim()}`);
    return null;
  }

  return repoDir;
}

function fetchCommit(repoDir, sha) {
  // Check if commit already exists locally
  const check = spawnSync('git', ['cat-file', '-t', sha], { cwd: repoDir, encoding: 'utf-8', stdio: 'pipe' });
  if (check.status === 0) return true;

  // Fetch the specific commit
  const result = spawnSync(
    'git',
    ['fetch', '--depth=1', 'origin', sha],
    { cwd: repoDir, encoding: 'utf-8', stdio: 'pipe', env: ghEnv },
  );

  if (result.status !== 0) {
    console.warn(`  WARN: could not fetch commit ${sha.slice(0, 8)}: ${result.stderr?.trim()}`);
    return false;
  }
  return true;
}

function fetchGoldenComments(repoSlug) {
  const result = spawnSync(
    'gh',
    ['api', `repos/${CRB_GITHUB_REPO}/contents/${CRB_GOLDEN_PATH}/${repoSlug}.json`,
      '--jq', '.content',
    ],
    { encoding: 'utf-8', env: ghEnv },
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

    // Fetch PR git refs (base/head SHAs) for repo checkout
    const prRefs = ghFetchPrRefs(url);
    const pr = parsePrUrl(url);

    // Clone repo and fetch commits (unless --skip-repos)
    let repoPath = null;
    if (!skipRepos && pr && prRefs) {
      repoPath = ensureRepoCloned(pr.owner, pr.repo, prRefs.clone_url);
      if (repoPath) {
        fetchCommit(repoPath, prRefs.base_sha);
        fetchCommit(repoPath, prRefs.head_sha);
      }
    }

    const expected = comments.map((c) => ({
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
        git: prRefs ? {
          base_sha: prRefs.base_sha,
          head_sha: prRefs.head_sha,
          base_ref: prRefs.base_ref,
          head_ref: prRefs.head_ref,
          owner: pr?.owner,
          repo: pr?.repo,
          repo_path: repoPath ? path.relative(QUALOPS_ROOT, repoPath) : null,
        } : null,
      }),
    );
  }

  fs.writeFileSync(outFile, lines.join('\n') + '\n');
  console.log(`  Written ${lines.length} records.`);
}

const repos = filterRepo ? [filterRepo] : Object.keys(REPO_LANGUAGE);

// Check gh is available
const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', env: ghEnv });
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
    { encoding: 'utf-8', env: ghEnv },
  );
  // Use curl via gh auth token as fallback for large files
  const token = spawnSync('gh', ['auth', 'token'], { encoding: 'utf-8', env: ghEnv });
  if (token.status !== 0) {
    console.warn('  WARN: could not get gh token, skipping benchmark_data.json');
    return;
  }
  const rawUrl = `https://raw.githubusercontent.com/${CRB_GITHUB_REPO}/main/offline/results/benchmark_data.json`;
  const dl = spawnSync(
    'curl',
    ['-fsSL', '-H', `Authorization: Bearer ${token.stdout.trim()}`, rawUrl, '-o', outFile],
    { encoding: 'utf-8', env: ghEnv },
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
