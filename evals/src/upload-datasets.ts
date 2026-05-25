#!/usr/bin/env tsx
'use strict';

/**
 * Upload QualOps eval datasets to Langfuse.
 *
 * Usage:
 *   npx tsx upload-datasets.ts --source=all            # Upload all datasets (qualops + crb)
 *   npx tsx upload-datasets.ts --source=qualops        # Upload qualops only
 *   npx tsx upload-datasets.ts --source=crb            # Upload all CRB per-repo datasets
 *   npx tsx upload-datasets.ts --source=crb --repo=sentry
 *   npx tsx upload-datasets.ts --limit=10
 */

import fs from 'node:fs';
import path from 'node:path';
import { CRB_DATASETS_DIR, QUALOPS_ROOT, loadCrbItems, buildCrbExpectedPair } from './config';
import type { CrbSlice } from './config';

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
} catch {
  // rely on shell env
}

import { Langfuse } from 'langfuse';

const args = Object.fromEntries(
  process.argv
    .filter((a) => a.startsWith('--'))
    .map((a) => {
      const [k, v] = a.slice(2).split('=');
      return [k, v || 'true'];
    }),
);

const source = args.source || 'all';
const repo = args.repo || 'all';
const limit = args.limit ? parseInt(args.limit, 10) : Infinity;

const QUALOPS_DATASETS_DIR = path.join(__dirname, '../datasets');

import { CRB_REPOS } from './crb-repos';

interface RawExpected {
  line?: number | null;
  lineEnd?: number | null;
  type?: string;
  severity?: string;
  description?: string;
}

interface RawDataItem {
  id?: string;
  filePath?: string;
  language?: string;
  fullContent?: string;
  diff?: string;
  expected?: RawExpected[];
  pr_url?: string;
  pr_title?: string;
  source_repo?: string;
  git?: unknown;
}

export interface QualOpsItem {
  id: string;
  input: {
    caseId: string;
    source: 'qualops';
    filePath: string;
    language: string;
    fullContent: string;
    diff: string;
  };
  expectedOutput: {
    referenceBugs: unknown[];
    referenceExpected: RawExpected[];
  };
  metadata: {
    source: 'qualops';
    filePath?: string;
    language?: string;
  };
}

export interface CrbItem {
  id: string;
  input: {
    caseId: string;
    source: 'crb';
    filePath: string;
    language: string;
    fullContent: string;
    diff: string;
    prTitle?: string;
    prUrl?: string;
    sourceRepo?: string;
    git: unknown;
  };
  expectedOutput: {
    referenceBugs: unknown[];
    referenceExpected: RawExpected[];
  };
  metadata: {
    source: 'crb';
    repo: string;
    prUrl?: string;
    prTitle?: string;
    language?: string;
  };
}

export function readJsonlLines(filePath: string, maxLines: number): string[] {
  if (!fs.existsSync(filePath)) {
    console.warn(`Warning: ${filePath} not found, skipping`);
    return [];
  }
  return fs
    .readFileSync(filePath, 'utf-8')
    .split('\n')
    .filter(Boolean)
    .filter((line) => {
      try { JSON.parse(line); return true; } catch { return false; }
    })
    .slice(0, maxLines);
}

export function buildQualOpsItem(data: RawDataItem, index: number): QualOpsItem {
  const referenceBugs = (data.expected || []).map((e) => ({
    relevantFile: data.filePath,
    relevantLinesStart: e.line,
    relevantLinesEnd: e.lineEnd || e.line,
    type: e.type,
    severity: e.severity,
    description: e.description,
  }));

  return {
    id: data.id || `qualops-${index + 1}`,
    input: {
      caseId: data.id || `qualops-${index + 1}`,
      source: 'qualops',
      filePath: data.filePath || 'unknown.ts',
      language: data.language || 'typescript',
      fullContent: data.fullContent || '',
      diff: data.diff || '',
    },
    expectedOutput: {
      referenceBugs,
      referenceExpected: data.expected || [],
    },
    metadata: {
      source: 'qualops',
      filePath: data.filePath,
      language: data.language,
    },
  };
}


async function ensureDataset(langfuse: Langfuse, name: string, description: string): Promise<void> {
  try {
    await langfuse.api.datasetsCreate({ name, description, metadata: { uploadedAt: new Date().toISOString() } });
    console.log(`  Created dataset: ${name}`);
  } catch (err) {
    const e = err as { status?: number };
    if (e?.status === 409) {
      console.log(`  Dataset exists: ${name}`);
    } else {
      throw err;
    }
  }
}

async function uploadBatch(langfuse: Langfuse, datasetName: string, items: (QualOpsItem | CrbItem)[]): Promise<void> {
  let uploaded = 0;
  let failed = 0;
  for (const item of items) {
    try {
      await langfuse.api.datasetItemsCreate({
        datasetName,
        id: item.id,
        input: item.input,
        expectedOutput: item.expectedOutput,
        metadata: { ...item.metadata, caseId: item.id },
      });
      uploaded++;
      process.stdout.write(`\r  Uploading items: ${uploaded}/${items.length}`);
    } catch (err) {
      const e = err as { message?: string; error?: unknown };
      const msg = e?.message || JSON.stringify(e?.error || e);
      console.warn(`\n  Warning: failed to upload item ${item.id}: ${msg}`);
      failed++;
    }
  }
  console.log(`\n  Done: ${uploaded} uploaded, ${failed} failed`);
}

async function uploadQualOps(langfuse: Langfuse): Promise<void> {
  const datasetName = 'qualops/qualops';
  console.log(`\nUploading qualops dataset → ${datasetName}`);
  await ensureDataset(langfuse, datasetName, 'QualOps native eval dataset');

  const files = fs.readdirSync(QUALOPS_DATASETS_DIR).filter((f) => f.endsWith('.jsonl'));
  const items: QualOpsItem[] = [];
  for (const file of files) {
    const lines = readJsonlLines(path.join(QUALOPS_DATASETS_DIR, file), limit);
    items.push(...lines.map((l, i) => buildQualOpsItem(JSON.parse(l) as RawDataItem, i)));
  }
  console.log(`  Found ${items.length} items`);
  await uploadBatch(langfuse, datasetName, items);
}

export function crbSliceToCrbItem(slice: CrbSlice, repoSlug: string): CrbItem {
  const { referenceExpected, referenceBugs } = buildCrbExpectedPair(slice);
  const repoDir = path.join(CRB_DATASETS_DIR, slice.id, 'repo');
  return {
    id: slice.id,
    input: {
      caseId: slice.id,
      source: 'crb',
      filePath: slice.prUrl,
      language: slice.language || CRB_REPOS[repoSlug] || 'unknown',
      fullContent: '',
      diff: slice.diff,
      prTitle: slice.prTitle,
      prUrl: slice.prUrl,
      sourceRepo: slice.sourceRepo,
      git: {
        repo_path: repoDir,
        head_sha: '',
        base_sha: slice.baseSha,
      },
    },
    expectedOutput: { referenceBugs, referenceExpected },
    metadata: {
      source: 'crb',
      repo: repoSlug,
      prUrl: slice.prUrl,
      prTitle: slice.prTitle,
      language: slice.language || CRB_REPOS[repoSlug],
    },
  };
}

async function uploadCrb(langfuse: Langfuse): Promise<void> {
  const repos = resolveCrbRepos(repo);
  for (const r of repos) {
    let slices = loadCrbItems(r);
    if (limit < Infinity) slices = slices.slice(0, limit);
    const items = slices.map((s) => crbSliceToCrbItem(s, r));
    const datasetName = `qualops/crb-${r}`;
    console.log(`\nUploading crb/${r} → ${datasetName}`);
    await ensureDataset(langfuse, datasetName, `Code Review Bench: ${r} (${CRB_REPOS[r]})`);
    console.log(`  Found ${items.length} items`);
    await uploadBatch(langfuse, datasetName, items);
  }
}

function resolveCrbRepos(repoArg: string): string[] {
  if (repoArg === 'all') return Object.keys(CRB_REPOS);
  if (CRB_REPOS[repoArg]) return [repoArg];
  console.error(`Unknown repo: ${repoArg}. Options: ${Object.keys(CRB_REPOS).join(', ')}, all`);
  process.exit(1);
}

async function main(): Promise<void> {
  const langfuseSecretKey = process.env.LANGFUSE_SECRET_KEY;
  const langfusePublicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const langfuseHost = process.env.LANGFUSE_BASE_URL || 'https://cloud.langfuse.com';

  if (!langfuseSecretKey || !langfusePublicKey) {
    console.error('Error: LANGFUSE_SECRET_KEY and LANGFUSE_PUBLIC_KEY must be set in .env');
    process.exit(1);
  }

  const langfuse = new Langfuse({
    secretKey: langfuseSecretKey,
    publicKey: langfusePublicKey,
    baseUrl: langfuseHost,
  });

  console.log(`Langfuse host: ${langfuseHost}`);

  if (source === 'all') {
    await uploadQualOps(langfuse);
    await uploadCrb(langfuse);
  } else if (source === 'qualops') {
    await uploadQualOps(langfuse);
  } else if (source === 'crb') {
    await uploadCrb(langfuse);
  } else {
    console.error(`Unknown source: ${source}. Options: all, qualops, crb`);
    process.exit(1);
  }

  await langfuse.shutdownAsync();
  console.log('\nDone. View datasets at: ' + langfuseHost);
}

if (require.main === module) {
  main().catch((err: Error) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
  });
}
