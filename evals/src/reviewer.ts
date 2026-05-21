'use strict';

import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

import { QUALOPS_ROOT } from './config';
import type { RunLog } from './run-log';
import type { ReviewResult } from './qualops-bridge/types';

let _initialized = false;

function loadEnv(): void {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
  } catch {}
}

export async function ensureInit(): Promise<void> {
  if (_initialized) return;
  loadEnv();

  if (!fs.existsSync(path.join(process.cwd(), '.qualops/.qualopsrc.json'))) {
    process.chdir(QUALOPS_ROOT);
  }

  _initialized = true;
}

export interface DiffLineResult {
  additions: Set<number>;
  deletions: Set<number>;
  modifications: Set<number>;
}

export function parseDiffLines(diffStr: string): DiffLineResult {
  const additions = new Set<number>();
  const deletions = new Set<number>();
  const modifications = new Set<number>();

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

interface FileDiff {
  path: string;
  content: string;
  diff: DiffLineResult;
  rawDiff: string;
}

export function splitMultiFileDiff(rawDiff: string): FileDiff[] {
  const files: FileDiff[] = [];
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

interface GitMeta {
  repo_path?: string;
  head_sha?: string;
  base_sha?: string;
  [key: string]: unknown;
}

export interface ItemInput {
  caseId?: string;
  git?: GitMeta;
  source?: string;
  diff?: string;
  fullContent?: string;
  fileContent?: string;
  language?: string;
  filePath?: string;
}

interface RepoCwd {
  cwd: string | null;
  cleanup: (() => void) | null;
}

interface RunConfig {
  model: string;
  mode: string;
  provider: string | null;
  configPath: string;
}

interface RunContext {
  config: RunConfig;
  runLog: RunLog;
}

export function resolveRepoCwd(itemInput: ItemInput, runLog: RunLog): RepoCwd {
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
  // repo_path is already resolved and validated to be within QUALOPS_ROOT at the entry boundary.
  const repoPath = itemInput.git.repo_path;
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

  const cleanup = (): void => {
    try {
      spawnSync('git', ['worktree', 'remove', '--force', worktreeDir], {
        cwd: repoPath, encoding: 'utf-8', stdio: 'pipe',
      });
    } catch {}
  };

  return { cwd: worktreeDir, cleanup };
}

export async function runReviewForItem(itemInput: ItemInput, ctx: RunContext): Promise<ReviewResult> {
  const { config, runLog } = ctx;
  await ensureInit();

  const { cwd: repoCwd, cleanup } = resolveRepoCwd(itemInput, runLog);

  const evalConfig = {
    name: `langfuse:${config.model}:${config.mode}`,
    mode: config.mode,
    model: config.model,
    provider: config.provider,
    configPath: config.configPath,
    ...(repoCwd && { cwd: repoCwd }),
  };

  try {
    if (itemInput.source === 'crb' || (!itemInput.fullContent && !itemInput.fileContent)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { runReviewMultiFile } = require('./qualops-bridge/provider') as { runReviewMultiFile: (files: FileDiff[], config: typeof evalConfig) => Promise<ReviewResult> };
      const rawDiff = itemInput.diff || '';
      const files = splitMultiFileDiff(rawDiff);
      if (files.length === 0) {
        return { issues: [], durationMs: 0 };
      }
      return await runReviewMultiFile(files, evalConfig);
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { runReview } = require('./qualops-bridge/provider') as { runReview: (evalCase: unknown, config: typeof evalConfig) => Promise<ReviewResult> };
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
