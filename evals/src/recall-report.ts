#!/usr/bin/env node
'use strict';

/**
 * Per-golden-comment recall report across eval runs.
 *
 * Usage:
 *   node evals/src/recall-report.js                           # all CRB logs
 *   node evals/src/recall-report.js --preset=fast             # filter by preset
 *   node evals/src/recall-report.js --model=claude-sonnet-4-6 # filter by model
 *   node evals/src/recall-report.js --dataset=crb-sentry      # filter by dataset/repo
 *   node evals/src/recall-report.js --severity=critical,high   # filter by severity
 *   node evals/src/recall-report.js --format=json             # JSON output
 */

import path from 'node:path';
import fs from 'node:fs';

import { LOGS_DIR } from './config';
import { parseCrbGoldenCommentDetails, parseRecallReport, type RecallReportEntry } from './scorers/schemas';
import type { CrbGoldenCommentDetails, RecallReportSummary } from './scorers/schemas';

interface CliArgs {
  preset?: string;
  model?: string;
  dataset?: string;
  severity?: string;
  format?: string;
  [key: string]: string | undefined;
}

interface RunMeta {
  model?: string;
  preset?: string;
  [key: string]: unknown;
}

export interface LogItem {
  event?: string;
  dataset?: string;
  caseId?: string;
  goldenDetails?: unknown[];
  [key: string]: unknown;
}

export interface LogFile {
  file: string;
  meta: RunMeta;
  items: LogItem[];
}

interface GoldenEntry {
  caseId: string;
  goldenIndex: number;
  description: string;
  type: string | null;
  severity: string | null;
  runs: { matched: boolean | null; confidence: number | null; runFile: string }[];
}

interface CollatedResult {
  goldenMap: Map<string, GoldenEntry>;
  runsWithDetails: number;
  runsWithoutDetails: number;
}

export function parseCliArgs(argv: string[]): CliArgs {
  const args: CliArgs = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) args[m[1]] = m[2] !== undefined ? m[2] : 'true';
  }
  return args;
}

export function loadCrbDatasets(): Map<string, { goldenIndex: number; description: string; type: string | null; severity: string | null }[]> {
  const crbDir = path.join(path.dirname(__dirname), 'datasets', 'crb');
  const datasetGoldens = new Map<string, { goldenIndex: number; description: string; type: string | null; severity: string | null }[]>();
  if (!fs.existsSync(crbDir)) return datasetGoldens;

  for (const file of fs.readdirSync(crbDir).filter((f) => f.endsWith('.jsonl'))) {
    const lines = fs.readFileSync(path.join(crbDir, file), 'utf-8').trim().split('\n');
    for (const line of lines) {
      const entry = JSON.parse(line) as { id?: string; expected?: { description?: string; type?: string; severity?: string }[] };
      const caseId = entry.id ?? '';
      const expected = entry.expected || [];
      datasetGoldens.set(caseId, expected.map((e, i) => ({
        goldenIndex: i,
        description: e.description || '',
        type: e.type || null,
        severity: e.severity || null,
      })));
    }
  }
  return datasetGoldens;
}

export function loadLogFiles(filters: { preset?: string | null; model?: string | null; dataset?: string | null }): LogFile[] {
  if (!fs.existsSync(LOGS_DIR)) return [];
  const files = fs.readdirSync(LOGS_DIR).filter((f) => f.endsWith('.json'));
  const logs: LogFile[] = [];

  for (const file of files) {
    let data: RunMeta & { entries?: LogItem[] };
    try {
      data = JSON.parse(fs.readFileSync(path.join(LOGS_DIR, file), 'utf-8'));
    } catch {
      console.warn(`[recall-report] Skipping malformed log file: ${file}`);
      continue;
    }

    if (filters.preset && data.preset !== filters.preset) continue;
    if (filters.model && !String(data.model ?? '').includes(filters.model)) continue;

    const crbItems = (data.entries || []).filter(
      (e) => e.event === 'item_complete' && e.dataset && String(e.dataset).includes('crb'),
    );
    if (crbItems.length === 0) continue;

    if (filters.dataset) {
      const filtered = crbItems.filter((e) => String(e.dataset).includes(filters.dataset!) || String(e.caseId ?? '').includes(filters.dataset!));
      if (filtered.length === 0) continue;
      logs.push({ file, meta: data, items: filtered });
    } else {
      logs.push({ file, meta: data, items: crbItems });
    }
  }

  return logs;
}

function truncate(str: string | undefined, len = 120): string {
  if (!str || str.length <= len) return str || '';
  return str.slice(0, len - 1) + '…';
}

export function collateGoldenData(
  logs: LogFile[],
  datasetGoldens: Map<string, { goldenIndex: number; description: string; type: string | null; severity: string | null }[]>,
): CollatedResult {
  const goldenMap = new Map<string, GoldenEntry>();
  let runsWithDetails = 0;
  let runsWithoutDetails = 0;

  for (const log of logs) {
    for (const item of log.items) {
      const caseId = String(item.caseId ?? '');
      const hasDetails = Array.isArray(item.goldenDetails) && item.goldenDetails.length > 0;

      if (hasDetails) {
        let validated: CrbGoldenCommentDetails[] | null;
        try {
          validated = (item.goldenDetails as unknown[]).map((gd) => parseCrbGoldenCommentDetails(gd));
        } catch (err) {
          console.warn(`[recall-report] Invalid goldenDetails in ${log.file} case ${caseId}, treating as stub: ${(err as Error).message}`);
          validated = null;
        }

        if (validated) {
          runsWithDetails++;
          for (const gd of validated) {
            const key = `${caseId}:golden-${gd.goldenIndex}`;
            if (!goldenMap.has(key)) {
              goldenMap.set(key, {
                caseId,
                goldenIndex: gd.goldenIndex,
                description: gd.description,
                type: gd.type,
                severity: gd.severity,
                runs: [],
              });
            }
            goldenMap.get(key)!.runs.push({
              matched: gd.matched,
              confidence: gd.confidence,
              runFile: log.file,
            });
          }
        } else {
          runsWithoutDetails++;
          const goldens = datasetGoldens.get(caseId);
          if (goldens) {
            for (const g of goldens) {
              const key = `${caseId}:golden-${g.goldenIndex}`;
              if (!goldenMap.has(key)) {
                goldenMap.set(key, {
                  caseId,
                  goldenIndex: g.goldenIndex,
                  description: truncate(g.description, 120),
                  type: g.type,
                  severity: g.severity,
                  runs: [],
                });
              }
              goldenMap.get(key)!.runs.push({ matched: null, confidence: null, runFile: log.file });
            }
          }
        }
      } else {
        runsWithoutDetails++;
        const goldens = datasetGoldens.get(caseId);
        if (goldens) {
          for (const g of goldens) {
            const key = `${caseId}:golden-${g.goldenIndex}`;
            if (!goldenMap.has(key)) {
              goldenMap.set(key, {
                caseId,
                goldenIndex: g.goldenIndex,
                description: truncate(g.description, 120),
                type: g.type,
                severity: g.severity,
                runs: [],
              });
            }
            goldenMap.get(key)!.runs.push({ matched: null, confidence: null, runFile: log.file });
          }
        }
      }
    }
  }

  return { goldenMap, runsWithDetails, runsWithoutDetails };
}

export function computeSummary(goldenMap: Map<string, GoldenEntry>): RecallReportSummary {
  let alwaysDetected = 0;
  let neverDetected = 0;
  let flaky = 0;

  for (const [, entry] of goldenMap) {
    const knownRuns = entry.runs.filter((r) => r.matched !== null);
    if (knownRuns.length === 0) continue;
    const matchCount = knownRuns.filter((r) => r.matched).length;
    if (matchCount === knownRuns.length) alwaysDetected++;
    else if (matchCount === 0) neverDetected++;
    else flaky++;
  }

  const total = alwaysDetected + neverDetected + flaky;
  return { alwaysDetected, neverDetected, flaky, total };
}

function collectRunFiles(goldenMap: Map<string, GoldenEntry>): string[] {
  const set = new Set<string>();
  for (const [, entry] of goldenMap) {
    for (const r of entry.runs) set.add(r.runFile);
  }
  return [...set];
}

function groupByCaseId(goldenMap: Map<string, GoldenEntry>): Map<string, (GoldenEntry & { key: string })[]> {
  const byCaseId = new Map<string, (GoldenEntry & { key: string })[]>();
  for (const [key, entry] of goldenMap) {
    if (!byCaseId.has(entry.caseId)) byCaseId.set(entry.caseId, []);
    byCaseId.get(entry.caseId)!.push({ key, ...entry });
  }
  return byCaseId;
}

function buildRunMarks(entryRuns: GoldenEntry['runs'], runFiles: string[]): string {
  const byFile = new Map<string, { matched: boolean | null }>();
  for (const r of entryRuns) byFile.set(r.runFile, r);

  return runFiles.map((f) => {
    const r = byFile.get(f);
    if (!r) return ' ';
    if (r.matched === null) return ' ';
    return r.matched ? '✓' : '✗';
  }).join('');
}

function formatAlignedTable(headers: string[], rows: string[][]): string[] {
  const colWidths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map((r) => r[i].length)),
  );
  const pad = (s: string, w: number): string => s + ' '.repeat(w - s.length);
  const fmtRow = (cols: string[]): string => '| ' + cols.map((c, i) => pad(c, colWidths[i])).join(' | ') + ' |';
  const sepRow = '|' + colWidths.map((w) => '-'.repeat(w + 2)).join('|') + '|';

  return [fmtRow(headers), sepRow, ...rows.map(fmtRow)];
}

export function formatMarkdown(
  logs: LogFile[],
  goldenMap: Map<string, GoldenEntry>,
  summary: RecallReportSummary,
  runsWithDetails: number,
  runsWithoutDetails: number,
): string {
  const models = [...new Set(logs.map((l) => l.meta.model).filter(Boolean))];
  const lines: string[] = [];

  lines.push('# CRB Recall Report');
  lines.push(`Runs: ${logs.length} | Models: ${models.join(', ') || 'unknown'}`);
  if (runsWithoutDetails > 0) {
    lines.push(`Note: ${runsWithDetails} item-runs have per-golden data, ${runsWithoutDetails} are stubs from older runs`);
  }
  lines.push('');

  const pct = (n: number): string => summary.total > 0 ? `${Math.round((n / summary.total) * 100)}%` : '0%';
  lines.push('## Summary');
  lines.push('| Always detected | Never detected | Flaky |');
  lines.push('|-----------------|----------------|-------|');
  lines.push(`| ${summary.alwaysDetected} (${pct(summary.alwaysDetected)}) | ${summary.neverDetected} (${pct(summary.neverDetected)}) | ${summary.flaky} (${pct(summary.flaky)}) |`);
  lines.push('');

  const runFiles = collectRunFiles(goldenMap);
  const byCaseId = groupByCaseId(goldenMap);
  const sortedCaseIds = [...byCaseId.keys()].sort();

  const headers = ['Case', '#', 'Sev', 'Golden Comment', 'Rate', 'Runs'];
  const rows: string[][] = [];

  for (const caseId of sortedCaseIds) {
    const entries = byCaseId.get(caseId)!;
    entries.sort((a, b) => a.goldenIndex - b.goldenIndex);

    for (const entry of entries) {
      const knownRuns = entry.runs.filter((r) => r.matched !== null);
      const matchCount = knownRuns.filter((r) => r.matched).length;
      const totalKnown = knownRuns.length;

      const rate = totalKnown > 0 ? `${matchCount}/${totalKnown}` : '—';
      const desc = truncate(entry.description, 50);
      rows.push([caseId, String(entry.goldenIndex), entry.severity || '', desc, rate, buildRunMarks(entry.runs, runFiles)]);
    }
  }

  lines.push('## Goldens');
  lines.push(...formatAlignedTable(headers, rows));
  lines.push('');

  return lines.join('\n');
}

export function formatJson(
  goldenMap: Map<string, GoldenEntry>,
  summary: RecallReportSummary,
  runsWithDetails: number,
  runsWithoutDetails: number,
): string {
  const entries: RecallReportEntry[] = [];
  for (const [key, entry] of goldenMap) {
    const knownRuns = entry.runs.filter((r) => r.matched !== null);
    const matchCount = knownRuns.filter((r) => r.matched).length;
    entries.push({
      key,
      caseId: entry.caseId,
      goldenIndex: entry.goldenIndex,
      description: entry.description,
      type: entry.type,
      severity: entry.severity,
      matchRate: knownRuns.length > 0 ? matchCount / knownRuns.length : null,
      matchCount,
      totalRuns: knownRuns.length,
      stubRuns: entry.runs.length - knownRuns.length,
    });
  }

  const report = {
    summary,
    runsWithDetails,
    runsWithoutDetails,
    goldens: entries,
  };

  parseRecallReport(report);

  return JSON.stringify(report, null, 2);
}

export function generateReport(args: CliArgs): string {
  const filters = {
    preset: args.preset || null,
    model: args.model || null,
    dataset: args.dataset || null,
  };
  const format = args.format || 'markdown';

  const logs = loadLogFiles(filters);
  if (logs.length === 0) {
    return 'No CRB log files found matching filters.';
  }

  const datasetGoldens = loadCrbDatasets();
  const { goldenMap, runsWithDetails, runsWithoutDetails } = collateGoldenData(logs, datasetGoldens);

  if (args.severity) {
    const allowed = new Set(args.severity.split(',').map((s) => s.trim().toLowerCase()));
    for (const [key, entry] of goldenMap) {
      if (!allowed.has((entry.severity || '').toLowerCase())) {
        goldenMap.delete(key);
      }
    }
  }

  if (goldenMap.size === 0) {
    return 'No golden comment data found in matching logs.';
  }

  const summary = computeSummary(goldenMap);

  if (format === 'json') {
    return formatJson(goldenMap, summary, runsWithDetails, runsWithoutDetails);
  }
  return formatMarkdown(logs, goldenMap, summary, runsWithDetails, runsWithoutDetails);
}

if (require.main === module) {
  const args = parseCliArgs(process.argv);
  console.log(generateReport(args));
}
