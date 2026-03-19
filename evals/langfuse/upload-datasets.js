#!/usr/bin/env node
'use strict';

/**
 * Upload QualOps eval datasets to Langfuse.
 *
 * Usage:
 *   node upload-datasets.js --source=all            # Upload all datasets (qualops + crb)
 *   node upload-datasets.js --source=qualops       # Upload qualops only
 *   node upload-datasets.js --source=crb            # Upload all CRB per-repo datasets
 *   node upload-datasets.js --source=crb --repo=sentry
 *   node upload-datasets.js --limit=10
 *
 * Fetch CRB data first:
 *   npm run eval:fetch:crb
 */

const fs = require('fs');
const path = require('path');

const QUALOPS_ROOT = path.join(__dirname, '../..');

try {
  require('dotenv').config({ path: path.join(QUALOPS_ROOT, '.env') });
} catch {
  // rely on shell env
}

const { Langfuse } = require('langfuse');

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
const CRB_DATASETS_DIR = path.join(__dirname, '../datasets/crb');

const CRB_REPOS = {
  sentry: 'python',
  grafana: 'go',
  cal_dot_com: 'typescript',
  discourse: 'ruby',
  keycloak: 'java',
};

function readJsonlLines(filePath, maxLines) {
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

function buildQualOpsItem(data, index) {
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

function buildCrbItem(data, index, repoName) {
  const referenceExpected = (data.expected || []).map((e) => ({
    line: e.line,
    lineEnd: e.lineEnd,
    type: e.type || 'bug',
    severity: e.severity || 'medium',
    description: e.description || '',
  }));

  const referenceBugs = referenceExpected.map((e) => ({
    relevantFile: data.pr_url,
    relevantLinesStart: e.line,
    relevantLinesEnd: e.lineEnd,
    type: e.type,
    severity: e.severity,
    description: e.description,
  }));

  return {
    id: data.id || `crb-${repoName}-${index + 1}`,
    input: {
      caseId: data.id || `crb-${repoName}-${index + 1}`,
      source: 'crb',
      filePath: data.pr_url || 'unknown',
      language: data.language || CRB_REPOS[repoName] || 'unknown',
      fullContent: '',
      diff: data.diff || '',
      prTitle: data.pr_title,
      prUrl: data.pr_url,
      sourceRepo: data.source_repo,
    },
    expectedOutput: { referenceBugs, referenceExpected },
    metadata: {
      source: 'crb',
      repo: repoName,
      prUrl: data.pr_url,
      prTitle: data.pr_title,
      language: data.language || CRB_REPOS[repoName],
    },
  };
}

async function ensureDataset(langfuse, name, description) {
  try {
    await langfuse.api.datasetsCreate({ name, description, metadata: { uploadedAt: new Date().toISOString() } });
    console.log(`  Created dataset: ${name}`);
  } catch (err) {
    if (err?.status === 409 || err?.message?.includes('already exists') || err?.message?.includes('Conflict')) {
      console.log(`  Dataset exists: ${name}`);
    } else {
      throw err;
    }
  }
}

async function uploadBatch(langfuse, datasetName, items) {
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
      const msg = err?.message || JSON.stringify(err?.error || err);
      console.warn(`\n  Warning: failed to upload item ${item.id}: ${msg}`);
      failed++;
    }
  }
  console.log(`\n  Done: ${uploaded} uploaded, ${failed} failed`);
}

async function uploadQualOps(langfuse) {
  const datasetName = 'qualops/qualops';
  console.log(`\nUploading qualops dataset → ${datasetName}`);
  await ensureDataset(langfuse, datasetName, 'QualOps native eval dataset');

  const files = fs.readdirSync(QUALOPS_DATASETS_DIR).filter((f) => f.endsWith('.jsonl'));
  const items = [];
  for (const file of files) {
    const lines = readJsonlLines(path.join(QUALOPS_DATASETS_DIR, file), limit);
    items.push(...lines.map((l, i) => buildQualOpsItem(JSON.parse(l), i)));
  }
  console.log(`  Found ${items.length} items`);
  await uploadBatch(langfuse, datasetName, items);
}

async function uploadCrb(langfuse) {
  const repos =
    repo === 'all'
      ? Object.keys(CRB_REPOS)
      : CRB_REPOS[repo]
        ? [repo]
        : (() => { console.error(`Unknown repo: ${repo}. Options: ${Object.keys(CRB_REPOS).join(', ')}, all`); process.exit(1); })();

  for (const r of repos) {
    const filePath = path.join(CRB_DATASETS_DIR, `${r}.jsonl`);
    const lines = readJsonlLines(filePath, limit);
    const items = lines.map((l, i) => buildCrbItem(JSON.parse(l), i, r));

    const datasetName = `qualops/crb-${r}`;
    console.log(`\nUploading crb/${r} → ${datasetName}`);
    await ensureDataset(langfuse, datasetName, `Code Review Bench: ${r} (${CRB_REPOS[r]})`);
    console.log(`  Found ${items.length} items`);
    await uploadBatch(langfuse, datasetName, items);
  }
}

async function main() {
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
  main().catch((err) => {
    console.error('Fatal:', err.message || err);
    process.exit(1);
  });
}

module.exports = { buildQualOpsItem, buildCrbItem, readJsonlLines, CRB_REPOS };
