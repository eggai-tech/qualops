'use strict';

const path = require('path');
const fs = require('fs');

const { QUALOPS_ROOT } = require('./config');

let _initialized = false;

function loadEnv() {
  try {
    require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
  } catch {}
}

async function ensureInit() {
  if (_initialized) return;
  loadEnv();

  if (!fs.existsSync(path.join(process.cwd(), '.qualops/.qualopsrc.json'))) {
    process.chdir(QUALOPS_ROOT);
  }

  _initialized = true;
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

function resolveRepoCwd(itemInput, runLog) {
  if (!itemInput.git?.repo_path) {
    runLog.add({
      level: 'warn',
      event: 'missing_git_metadata',
      warnCode: 'NO_REPO_PATH',
      caseId: itemInput.caseId,
      message: 'Dataset item has no git.repo_path — agentic tools will use qualops root',
    });
    return { cwd: null, cleanup: null };
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
    return { cwd: null, cleanup: null };
  }
  if (!itemInput.git.head_sha) {
    return { cwd: repoPath, cleanup: null };
  }

  const { spawnSync } = require('child_process');
  const worktreeDir = path.join(
    repoPath, '.worktrees',
    `eval-${itemInput.caseId || Date.now()}-${itemInput.git.head_sha.slice(0, 8)}`,
  );

  const add = spawnSync('git', ['worktree', 'add', '--detach', worktreeDir, itemInput.git.head_sha], {
    cwd: repoPath, encoding: 'utf-8', stdio: 'pipe',
  });
  if (add.status !== 0) {
    console.warn(`  WARN: could not create worktree for ${itemInput.git.head_sha.slice(0, 8)}: ${add.stderr?.trim()}`);
    runLog.add({
      level: 'warn',
      event: 'worktree_failed',
      warnCode: 'WORKTREE_FAILED',
      caseId: itemInput.caseId,
      sha: itemInput.git.head_sha,
      message: add.stderr?.trim() || 'git worktree add failed',
    });
    return { cwd: repoPath, cleanup: null };
  }

  const cleanup = () => {
    try {
      spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
        cwd: repoPath, encoding: 'utf-8', stdio: 'pipe',
      });
    } catch {}
  };

  return { cwd: worktreeDir, cleanup };
}

async function runReviewForItem(itemInput, ctx) {
  const { config, runLog } = ctx;
  await ensureInit();

  const { cwd: repoCwd, cleanup } = resolveRepoCwd(itemInput, runLog);

  const evalConfig = {
    name: `langfuse:${config.model}:${config.mode}`,
    mode: config.mode,
    provider: config.provider,
    configPath: config.configPath,
    ...(config.modelOverride && { model: config.modelOverride }),
    ...(repoCwd && { cwd: repoCwd }),
  };

  try {
    if (itemInput.source === 'crb' || (!itemInput.fullContent && !itemInput.fileContent)) {
      const { runReviewMultiFile } = require('./qualops-bridge/provider');
      const rawDiff = itemInput.diff || '';
      const files = splitMultiFileDiff(rawDiff);
      if (files.length === 0) {
        return { issues: [], durationMs: 0 };
      }
      return await runReviewMultiFile(files, evalConfig);
    }

    const { runReview } = require('./qualops-bridge/provider');
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

    return await runReview(evalCase, evalConfig);
  } finally {
    if (cleanup) cleanup();
  }
}

module.exports = { parseDiffLines, splitMultiFileDiff, resolveRepoCwd, runReviewForItem, ensureInit };
