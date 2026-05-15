'use strict';

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

import {
  generateReport,
  collateGoldenData,
  computeSummary,
  formatMarkdown,
  formatJson,
  parseCliArgs,
  type LogFile,
  type LogItem,
} from './recall-report';

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recall-report-test-'));
}

function makeLogData({ model = 'claude-sonnet-4-6', preset = 'fast', items = [] as LogItem[] }) {
  return {
    experiment: 'test-run',
    preset,
    model,
    mode: 'agentic',
    provider: 'anthropic',
    startedAt: '2026-03-30T10:00:00Z',
    finishedAt: '2026-03-30T10:05:00Z',
    totals: { items: items.length, successes: items.length, errors: 0, warnings: 0 },
    errorBreakdown: {},
    warningBreakdown: {},
    entries: items,
  };
}

function makeItem({ caseId, dataset, goldenDetails = null, scores = {} }: {
  caseId: string;
  dataset: string;
  goldenDetails?: unknown[] | null;
  scores?: Record<string, unknown>;
}): LogItem {
  return {
    timestamp: '2026-03-30T10:01:00Z',
    level: 'info',
    event: 'item_complete',
    dataset,
    caseId,
    traceId: 'trace-1',
    issueCount: 2,
    durationMs: 5000,
    scores,
    goldenDetails,
  };
}

describe('parseCliArgs', () => {
  it('parses --key=value flags', () => {
    const args = parseCliArgs(['node', 'script', '--preset=fast', '--model=sonnet', '--format=json']);
    expect(args.preset).toBe('fast');
    expect(args.model).toBe('sonnet');
    expect(args.format).toBe('json');
  });

  it('parses --flag without value as "true"', () => {
    const args = parseCliArgs(['node', 'script', '--verbose']);
    expect(args.verbose).toBe('true');
  });
});

describe('collateGoldenData', () => {
  it('collates goldenDetails from logs with per-golden data', () => {
    const logs: LogFile[] = [{
      file: 'run1.json',
      meta: { model: 'sonnet' },
      items: [makeItem({
        caseId: 'crb-sentry-1',
        dataset: 'qualops/crb-sentry',
        goldenDetails: [
          { goldenIndex: 0, description: 'Bug A', type: 'bug', severity: 'high', matched: true, confidence: 0.9, matchedCandidate: 'Found bug' },
          { goldenIndex: 1, description: 'Bug B', type: 'style', severity: 'low', matched: false, confidence: 0, matchedCandidate: null },
        ],
      })],
    }];

    const { goldenMap, runsWithDetails, runsWithoutDetails } = collateGoldenData(logs, new Map());
    expect(runsWithDetails).toBe(1);
    expect(runsWithoutDetails).toBe(0);
    expect(goldenMap.size).toBe(2);

    const g0 = goldenMap.get('crb-sentry-1:golden-0')!;
    expect(g0.runs).toHaveLength(1);
    expect(g0.runs[0].matched).toBe(true);

    const g1 = goldenMap.get('crb-sentry-1:golden-1')!;
    expect(g1.runs[0].matched).toBe(false);
  });

  it('creates stub entries for old logs without goldenDetails', () => {
    const datasetGoldens = new Map([
      ['crb-sentry-1', [
        { goldenIndex: 0, description: 'Bug A', type: 'bug', severity: 'high' },
      ]],
    ]);

    const logs: LogFile[] = [{
      file: 'old-run.json',
      meta: { model: 'sonnet' },
      items: [makeItem({
        caseId: 'crb-sentry-1',
        dataset: 'qualops/crb-sentry',
        goldenDetails: null,
      })],
    }];

    const { goldenMap, runsWithDetails, runsWithoutDetails } = collateGoldenData(logs, datasetGoldens);
    expect(runsWithDetails).toBe(0);
    expect(runsWithoutDetails).toBe(1);
    expect(goldenMap.size).toBe(1);

    const g0 = goldenMap.get('crb-sentry-1:golden-0')!;
    expect(g0.runs[0].matched).toBeNull();
  });

  it('falls back to stub when goldenDetails fail validation', () => {
    const datasetGoldens = new Map([
      ['crb-sentry-1', [
        { goldenIndex: 0, description: 'Bug A', type: 'bug', severity: 'high' },
      ]],
    ]);

    const logs: LogFile[] = [{
      file: 'bad-run.json',
      meta: { model: 'sonnet' },
      items: [makeItem({
        caseId: 'crb-sentry-1',
        dataset: 'qualops/crb-sentry',
        goldenDetails: [{ goldenIndex: 0, description: 'Bug A' }], // missing required fields
      })],
    }];

    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { goldenMap, runsWithDetails, runsWithoutDetails } = collateGoldenData(logs, datasetGoldens);
    warnSpy.mockRestore();

    expect(runsWithDetails).toBe(0);
    expect(runsWithoutDetails).toBe(1);
    expect(goldenMap.size).toBe(1);
    expect(goldenMap.get('crb-sentry-1:golden-0')!.runs[0].matched).toBeNull();
  });

  it('merges runs from multiple log files', () => {
    const goldenDetails = [
      { goldenIndex: 0, description: 'Bug A', type: 'bug', severity: 'high', matched: true, confidence: 0.9, matchedCandidate: 'x' },
    ];

    const logs: LogFile[] = [
      { file: 'run1.json', meta: {}, items: [makeItem({ caseId: 'crb-sentry-1', dataset: 'qualops/crb-sentry', goldenDetails })] },
      { file: 'run2.json', meta: {}, items: [makeItem({ caseId: 'crb-sentry-1', dataset: 'qualops/crb-sentry', goldenDetails: [{ ...goldenDetails[0], matched: false, confidence: 0 }] })] },
    ];

    const { goldenMap } = collateGoldenData(logs, new Map());
    const g0 = goldenMap.get('crb-sentry-1:golden-0')!;
    expect(g0.runs).toHaveLength(2);
    expect(g0.runs[0].matched).toBe(true);
    expect(g0.runs[1].matched).toBe(false);
  });
});

describe('computeSummary', () => {
  it('classifies always/never/flaky correctly', () => {
    const goldenMap = new Map([
      ['a:golden-0', { caseId: 'a', goldenIndex: 0, description: '', type: null, severity: null, runs: [{ matched: true, confidence: 1, runFile: 'r1' }, { matched: true, confidence: 1, runFile: 'r2' }] }],
      ['a:golden-1', { caseId: 'a', goldenIndex: 1, description: '', type: null, severity: null, runs: [{ matched: false, confidence: 0, runFile: 'r1' }, { matched: false, confidence: 0, runFile: 'r2' }] }],
      ['a:golden-2', { caseId: 'a', goldenIndex: 2, description: '', type: null, severity: null, runs: [{ matched: true, confidence: 1, runFile: 'r1' }, { matched: false, confidence: 0, runFile: 'r2' }] }],
    ]);

    const summary = computeSummary(goldenMap);
    expect(summary.alwaysDetected).toBe(1);
    expect(summary.neverDetected).toBe(1);
    expect(summary.flaky).toBe(1);
    expect(summary.total).toBe(3);
  });

  it('ignores stub runs (matched=null) in classification', () => {
    const goldenMap = new Map([
      ['a:golden-0', { caseId: 'a', goldenIndex: 0, description: '', type: null, severity: null, runs: [{ matched: null, confidence: null, runFile: 'r1' }, { matched: true, confidence: 1, runFile: 'r2' }] }],
    ]);

    const summary = computeSummary(goldenMap);
    expect(summary.alwaysDetected).toBe(1);
    expect(summary.neverDetected).toBe(0);
  });

  it('skips entries with only stub runs', () => {
    const goldenMap = new Map([
      ['a:golden-0', { caseId: 'a', goldenIndex: 0, description: '', type: null, severity: null, runs: [{ matched: null, confidence: null, runFile: 'r1' }] }],
    ]);

    const summary = computeSummary(goldenMap);
    expect(summary.total).toBe(0);
  });
});

describe('formatMarkdown', () => {
  it('produces valid markdown output', () => {
    const goldenMap = new Map([
      ['crb-sentry-1:golden-0', {
        caseId: 'crb-sentry-1',
        goldenIndex: 0,
        description: 'Django querysets do not support negative slicing',
        type: 'bug',
        severity: 'high',
        runs: [{ matched: true, confidence: 0.9, runFile: 'r1.json' }, { matched: false, confidence: 0, runFile: 'r2.json' }],
      }],
    ]);

    const logs: LogFile[] = [{ file: 'r1.json', meta: { model: 'sonnet' }, items: [] }, { file: 'r2.json', meta: { model: 'sonnet' }, items: [] }];
    const summary = computeSummary(goldenMap);
    const md = formatMarkdown(logs, goldenMap, summary, 2, 0);

    expect(md).toContain('# CRB Recall Report');
    expect(md).toContain('Runs: 2');
    expect(md).toContain('sonnet');
    expect(md).toContain('## Goldens');
    expect(md).toContain('| Case');
    expect(md).toContain('| crb-sentry-1');
    expect(md).toContain('| Sev');
    expect(md).toContain('high');
    expect(md).toContain('1/2');
    expect(md).toContain('✓✗');
  });

  it('shows stub markers for old runs', () => {
    const goldenMap = new Map([
      ['crb-sentry-1:golden-0', {
        caseId: 'crb-sentry-1',
        goldenIndex: 0,
        description: 'Bug',
        type: 'bug',
        severity: 'high',
        runs: [{ matched: null, confidence: null, runFile: 'r1.json' }, { matched: true, confidence: 0.9, runFile: 'r2.json' }],
      }],
    ]);

    const logs: LogFile[] = [{ file: 'r1.json', meta: { model: 'sonnet' }, items: [] }];
    const summary = computeSummary(goldenMap);
    const md = formatMarkdown(logs, goldenMap, summary, 1, 1);

    expect(md).toContain(' ✓');
    expect(md).toContain('stubs from older runs');
  });

  it('aligns run slots across goldens present in different runs', () => {
    const goldenMap = new Map([
      ['case-1:golden-0', {
        caseId: 'case-1',
        goldenIndex: 0,
        description: 'Bug A',
        type: 'bug',
        severity: 'high',
        runs: [{ matched: true, confidence: 0.9, runFile: 'r1.json' }],
      }],
      ['case-1:golden-1', {
        caseId: 'case-1',
        goldenIndex: 1,
        description: 'Bug B',
        type: 'bug',
        severity: 'low',
        runs: [{ matched: false, confidence: 0, runFile: 'r2.json' }],
      }],
    ]);

    const logs: LogFile[] = [{ file: 'r1.json', meta: { model: 'sonnet' }, items: [] }, { file: 'r2.json', meta: { model: 'sonnet' }, items: [] }];
    const summary = computeSummary(goldenMap);
    const md = formatMarkdown(logs, goldenMap, summary, 2, 0);

    const lines = md.split('\n').filter((l) => l.includes('| case-1'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('✓ ');
    expect(lines[1]).toContain(' ✗');
  });
});

describe('formatJson', () => {
  it('produces valid JSON with summary and goldens', () => {
    const goldenMap = new Map([
      ['crb-sentry-1:golden-0', {
        caseId: 'crb-sentry-1',
        goldenIndex: 0,
        description: 'Bug A',
        type: 'bug',
        severity: 'high',
        runs: [{ matched: true, confidence: 0.9, runFile: 'r1' }, { matched: false, confidence: 0, runFile: 'r2' }],
      }],
    ]);

    const summary = computeSummary(goldenMap);
    const json = formatJson(goldenMap, summary, 2, 0);
    const parsed = JSON.parse(json);

    expect(parsed.summary.flaky).toBe(1);
    expect(parsed.goldens).toHaveLength(1);
    expect(parsed.goldens[0].matchRate).toBe(0.5);
    expect(parsed.goldens[0].matchCount).toBe(1);
    expect(parsed.goldens[0].totalRuns).toBe(2);
  });
});
