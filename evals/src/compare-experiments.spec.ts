import fs from 'node:fs';
import path from 'node:path';

import { compareEvalLogs } from './compare-experiments';
import { LOGS_DIR } from './config';

function writeLog(name: string, mode: string, model: string, scores: Array<[number, number, number]>): string {
  const entries = scores.map(([p, r, f], i) => ({
    level: 'info',
    event: 'item_complete',
    timestamp: 'x',
    caseId: `c${i}`,
    issueCount: 5,
    durationMs: 1000 * (i + 1),
    scores: { crb_precision: p, crb_recall: r, crb_f1: f },
  }));
  const log = {
    experimentName: name,
    preset: name,
    configPath: `${name}.json`,
    model,
    mode,
    provider: 'anthropic',
    startedAt: 'x',
    finishedAt: 'y',
    totals: { successes: scores.length, errors: 0, warnings: 0 },
    errorBreakdown: {},
    warningBreakdown: {},
    entries,
  };
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  const file = path.join(LOGS_DIR, `${name}-${Date.now()}.json`);
  fs.writeFileSync(file, JSON.stringify(log));
  return file;
}

describe('compareEvalLogs', () => {
  const created: string[] = [];
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
  });
  afterEach(() => {
    logSpy.mockRestore();
    for (const f of created.splice(0)) fs.rmSync(f, { force: true });
  });

  it('computes per-arm mean precision/recall/f1 from item_complete entries', () => {
    const a = writeLog('cmp-A', 'agentic', 'opus', [
      [0.2, 0.4, 0.3],
      [0.4, 0.6, 0.5],
    ]);
    const b = writeLog('cmp-B', 'file-by-file', 'sonnet', [[0.5, 0.5, 0.5]]);
    created.push(a, b);

    const arms = compareEvalLogs([a, b]);
    expect(arms).toHaveLength(2);
    expect(arms[0].meanPrecision).toBeCloseTo(0.3, 5);
    expect(arms[0].meanRecall).toBeCloseTo(0.5, 5);
    expect(arms[0].meanF1).toBeCloseTo(0.4, 5);
    expect(arms[0].items).toBe(2);
    expect(arms[0].model).toBe('opus');
    expect(arms[1].meanPrecision).toBeCloseTo(0.5, 5);
    expect(arms[1].mode).toBe('file-by-file');
  });

  it('supports N>2 arms (one column each)', () => {
    const a = writeLog('cmp3-A', 'agentic', 'm1', [[0.1, 0.1, 0.1]]);
    const b = writeLog('cmp3-B', 'agentic', 'm2', [[0.2, 0.2, 0.2]]);
    const c = writeLog('cmp3-C', 'agentic', 'm3', [[0.3, 0.3, 0.3]]);
    created.push(a, b, c);

    const arms = compareEvalLogs([a, b, c]);
    expect(arms.map((x) => x.model)).toEqual(['m1', 'm2', 'm3']);
    expect(arms[2].meanF1).toBeCloseTo(0.3, 5);
  });

  it('resolves an arg by experiment-label prefix (latest match) when not a path', () => {
    const a = writeLog('cmp-prefix', 'agentic', 'opus', [[0.9, 0.9, 0.9]]);
    const b = writeLog('cmp-other', 'agentic', 'sonnet', [[0.1, 0.1, 0.1]]);
    created.push(a, b);

    const arms = compareEvalLogs(['cmp-prefix', 'cmp-other']);
    expect(arms[0].meanF1).toBeCloseTo(0.9, 5);
    expect(arms[1].meanF1).toBeCloseTo(0.1, 5);
  });

  it('throws for an unresolvable ref', () => {
    expect(() => compareEvalLogs(['definitely-no-such-log-xyz', 'nope-either'])).toThrow(/No log for/);
  });
});
