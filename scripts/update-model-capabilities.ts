#!/usr/bin/env tsx

/**
 * Sync the bundled litellm model capability snapshot.
 *
 * Fetches BerriAI/litellm's model_prices_and_context_window.json, extracts chat
 * models, and diffs against the committed snapshot in
 * src/ai/providers/model-capabilities.json.
 *
 * Usage:
 *   npx tsx scripts/update-model-capabilities.ts          # check only, show diff
 *   npx tsx scripts/update-model-capabilities.ts --write  # apply changes
 *
 * Exit codes:
 *   0  No changes detected (or --write applied successfully)
 *   1  Changes detected (without --write)
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const UPSTREAM_URL =
  'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json';
const SNAPSHOT_PATH = join(__dirname, '../src/ai/providers/model-capabilities.json');

interface CatalogEntry {
  supportsResponseSchema: boolean;
  supportsToolUse: boolean;
}

interface Snapshot {
  _source: string;
  _fetched: string;
  models: Record<string, CatalogEntry>;
}

interface UpstreamEntry {
  mode?: string;
  supports_response_schema?: boolean;
  supports_function_calling?: boolean;
  supports_tool_choice?: boolean;
  [key: string]: unknown;
}

async function fetchUpstream(): Promise<Record<string, CatalogEntry>> {
  console.log(`Fetching ${UPSTREAM_URL} ...`);
  const res = await fetch(UPSTREAM_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching upstream catalog`);
  const raw = (await res.json()) as Record<string, UpstreamEntry>;

  const models: Record<string, CatalogEntry> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (val && typeof val === 'object' && val.mode === 'chat') {
      models[key] = {
        supportsResponseSchema: val.supports_response_schema === true,
        supportsToolUse:
          val.supports_function_calling === true || val.supports_tool_choice === true,
      };
    }
  }
  return models;
}

function loadSnapshot(): Snapshot {
  return JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8')) as Snapshot;
}

function diffModels(
  current: Record<string, CatalogEntry>,
  incoming: Record<string, CatalogEntry>,
): { added: string[]; removed: string[]; changed: string[] } {
  const currentKeys = new Set(Object.keys(current));
  const incomingKeys = new Set(Object.keys(incoming));

  const added = [...incomingKeys].filter((k) => !currentKeys.has(k));
  const removed = [...currentKeys].filter((k) => !incomingKeys.has(k));
  const changed = [...currentKeys]
    .filter((k) => incomingKeys.has(k))
    .filter(
      (k) =>
        current[k].supportsResponseSchema !== incoming[k].supportsResponseSchema ||
        current[k].supportsToolUse !== incoming[k].supportsToolUse,
    );

  return { added, removed, changed };
}

async function main(): Promise<void> {
  const doWrite = process.argv.includes('--write');

  const upstream = await fetchUpstream();
  console.log(`Upstream: ${Object.keys(upstream).length} chat models`);

  const snapshot = loadSnapshot();
  console.log(`Snapshot (_fetched: ${snapshot._fetched}): ${Object.keys(snapshot.models).length} models`);

  const { added, removed, changed } = diffModels(snapshot.models, upstream);

  if (added.length === 0 && removed.length === 0 && changed.length === 0) {
    console.log('\nNo changes detected. Snapshot is up to date.');
    process.exit(0);
  }

  console.log(`\nChanges detected:`);
  if (added.length > 0) {
    console.log(`  Added:   ${added.length}`);
    for (const k of added.slice(0, 10)) console.log(`    + ${k}`);
    if (added.length > 10) console.log(`    ... and ${added.length - 10} more`);
  }
  if (removed.length > 0) {
    console.log(`  Removed: ${removed.length}`);
    for (const k of removed.slice(0, 10)) console.log(`    - ${k}`);
    if (removed.length > 10) console.log(`    ... and ${removed.length - 10} more`);
  }
  if (changed.length > 0) {
    console.log(`  Changed: ${changed.length}`);
    for (const k of changed.slice(0, 10)) {
      console.log(`    ~ ${k}: ${JSON.stringify(snapshot.models[k])} → ${JSON.stringify(upstream[k])}`);
    }
    if (changed.length > 10) console.log(`    ... and ${changed.length - 10} more`);
  }

  if (!doWrite) {
    console.log('\nRun with --write to apply changes.');
    process.exit(1);
  }

  const updated: Snapshot = {
    _source: UPSTREAM_URL,
    _fetched: new Date().toISOString().slice(0, 10),
    models: upstream,
  };
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(updated, null, 2), 'utf-8');
  console.log(`\nSnapshot updated: ${SNAPSHOT_PATH}`);
  console.log(`  ${Object.keys(upstream).length} models, fetched ${updated._fetched}`);
  process.exit(0);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
if (require.main === module) {
  main().catch((err: unknown) => {
    console.error('Error:', (err as Error).message);
    process.exit(1);
  });
}
