#!/usr/bin/env tsx

/**
 * Check whether the upstream CRB (withmartian/code-review-benchmark) has added
 * new benchmark PRs that are not yet captured in our local JSONL files.
 *
 * Exits with code 1 if any repo has more upstream entries than we have locally.
 * Exits with code 0 if all repos are up to date (or if network is unavailable).
 *
 * Usage:
 *   npx tsx evals/scripts/check-crb-staleness.ts
 *
 * Requires: gh CLI authenticated (gh auth login)
 */

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SCRIPT_DIR = __dirname;
const QUALOPS_ROOT = path.join(SCRIPT_DIR, '../..');
const CRB_DIR = path.join(QUALOPS_ROOT, 'evals/datasets/crb');

const CRB_GITHUB_REPO = 'withmartian/code-review-benchmark';
const CRB_GOLDEN_PATH = 'offline/golden_comments';

const REPOS = ['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak'];

interface UpstreamEntry {
  url: string;
  pr_title?: string;
}

function fetchUpstreamEntries(repoSlug: string): UpstreamEntry[] | null {
  const result = spawnSync(
    'gh',
    ['api', `repos/${CRB_GITHUB_REPO}/contents/${CRB_GOLDEN_PATH}/${repoSlug}.json`],
    { encoding: 'utf-8', stdio: 'pipe' },
  );
  if (result.status !== 0) {
    console.warn(`  WARN: could not fetch upstream ${repoSlug}: ${result.stderr?.trim()}`);
    return null;
  }
  try {
    const raw = JSON.parse(result.stdout) as { content: string };
    const content = Buffer.from(raw.content.replace(/\n/g, ''), 'base64').toString('utf-8');
    return JSON.parse(content) as UpstreamEntry[];
  } catch {
    console.warn(`  WARN: could not parse upstream ${repoSlug}`);
    return null;
  }
}

function localPrUrls(repoSlug: string): Set<string> {
  const urls = new Set<string>();
  if (!fs.existsSync(CRB_DIR)) return urls;
  for (const entry of fs.readdirSync(CRB_DIR)) {
    if (!entry.startsWith(`crb-${repoSlug}-`)) continue;
    const sliceJsonPath = path.join(CRB_DIR, entry, 'slice.json');
    if (!fs.existsSync(sliceJsonPath)) continue;
    const sj = JSON.parse(fs.readFileSync(sliceJsonPath, 'utf-8')) as { prUrl?: string };
    if (sj.prUrl) urls.add(sj.prUrl);
  }
  return urls;
}

function checkRepo(repo: string): boolean {
  const upstreamEntries = fetchUpstreamEntries(repo);
  if (upstreamEntries === null) {
    console.log(`  ${repo}: upstream unavailable`);
    return false;
  }

  const localUrls = localPrUrls(repo);
  const missing = upstreamEntries.filter((e) => !localUrls.has(e.url));
  const extra = [...localUrls].filter((u) => !upstreamEntries.some((e) => e.url === u));

  if (missing.length === 0 && extra.length === 0) {
    console.log(`  OK    ${repo}: ${localUrls.size}/${upstreamEntries.length} PRs match`);
    return false;
  }

  if (missing.length > 0) {
    console.warn(`  STALE ${repo}: ${missing.length} upstream PR(s) not in local slices:`);
    for (const e of missing) console.warn(`    + ${e.url}  (${e.pr_title ?? ''})`);
  }
  if (extra.length > 0) {
    console.warn(`  EXTRA ${repo}: ${extra.length} local slice(s) not in upstream:`);
    for (const u of extra) console.warn(`    - ${u}`);
  }
  return true;
}

function main(): void {
  const ghCheck = spawnSync('gh', ['auth', 'status'], { encoding: 'utf-8', stdio: 'pipe' });
  if (ghCheck.status !== 0) {
    console.warn('WARN: gh CLI not authenticated — skipping CRB staleness check');
    process.exit(0);
  }

  console.log('Checking CRB staleness against upstream withmartian/code-review-benchmark...\n');

  const stale = REPOS.some(checkRepo);

  if (stale) {
    console.error(
      '\nUpstream CRB has new benchmark PRs not captured in our slices.' +
      '\nNew slices must be added manually — see docs/tdr/0002-evals-from-real-prs.md for the slice format.',
    );
    process.exit(1);
  } else {
    console.log('\nAll CRB repos are up to date.');
  }
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  main();
}
