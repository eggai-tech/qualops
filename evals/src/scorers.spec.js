'use strict';

const { scoreParser, scoreLineAccuracy, scoreCoverage, scoreSeverity } = require('./scorers');

describe('scoreParser', () => {
  it('returns 0 for non-array input', () => {
    expect(scoreParser('not an array').score).toBe(0);
    expect(scoreParser(null).score).toBe(0);
    expect(scoreParser({}).score).toBe(0);
  });

  it('returns 0.5 for empty array', () => {
    const r = scoreParser([]);
    expect(r.score).toBe(0.5);
    expect(r.pass).toBe(true);
  });

  it('returns 1 for fully valid issues', () => {
    const issues = [
      { type: 'bug', severity: 'high', description: 'desc', line: 10 },
      { type: 'style', severity: 'low', description: 'desc', line: 20 },
    ];
    const r = scoreParser(issues);
    expect(r.score).toBe(1);
    expect(r.pass).toBe(true);
  });

  it('returns 0.5 for issues missing required fields', () => {
    const issues = [{ type: 'bug', line: 10 }]; // missing severity, description
    const r = scoreParser(issues);
    expect(r.score).toBe(0.5);
    expect(r.reason).toContain('missing severity');
    expect(r.reason).toContain('missing description');
  });

  it('detects missing line', () => {
    const issues = [{ type: 'bug', severity: 'high', description: 'desc' }];
    const r = scoreParser(issues);
    expect(r.reason).toContain('missing line');
  });
});

describe('scoreLineAccuracy', () => {
  it('returns 1 when no reference bugs', () => {
    const r = scoreLineAccuracy([], []);
    expect(r.score).toBe(1);
  });

  it('returns 0 when no issues match reference bugs', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 15 }];
    const r = scoreLineAccuracy([], refs);
    expect(r.score).toBe(0);
  });

  it('returns 1 for exact line match', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 10 }];
    const issues = [{ file: 'a.ts', line: 10 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });

  it('scores partial overlap correctly', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 20 }];
    const issues = [{ file: 'a.ts', line: 15, lineEnd: 25 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it('matches issues to correct file', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 10 }];
    const issues = [
      { file: 'b.ts', line: 10 },
      { file: 'a.ts', line: 10 },
    ];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });

  it('merges overlapping reference ranges', () => {
    const refs = [
      { relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 15 },
      { relevantFile: 'a.ts', relevantLinesStart: 14, relevantLinesEnd: 20 },
    ];
    const issues = [{ file: 'a.ts', line: 10, lineEnd: 20 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });
});

describe('scoreCoverage', () => {
  it('returns 1 when no expected issues', () => {
    const r = scoreCoverage([], []);
    expect(r.score).toBe(1);
  });

  it('returns 0 when no issues detected', () => {
    const expected = [{ line: 10, category: 'bug' }];
    const r = scoreCoverage([], expected);
    expect(r.score).toBe(0);
  });

  it('returns 1 when all expected issues matched', () => {
    const expected = [
      { line: 10, category: 'bug' },
      { line: 20, category: 'style' },
    ];
    const issues = [
      { type: 'bug', line: 10 },
      { type: 'style', line: 20 },
    ];
    const r = scoreCoverage(issues, expected);
    expect(r.score).toBe(1);
  });

  it('returns partial score for partial coverage', () => {
    const expected = [
      { line: 10, category: 'bug' },
      { line: 50, category: 'security' },
    ];
    const issues = [{ type: 'bug', line: 10 }];
    const r = scoreCoverage(issues, expected);
    expect(r.score).toBe(0.5);
  });

  it('matches within line tolerance', () => {
    const expected = [{ line: 10, category: 'bug' }];
    const issues = [{ type: 'bug', line: 13 }]; // within ±3 tolerance
    const r = scoreCoverage(issues, expected);
    expect(r.score).toBe(1);
  });

  it('does not match beyond line tolerance', () => {
    const expected = [{ line: 10, category: 'bug' }];
    const issues = [{ type: 'bug', line: 20 }]; // too far
    const r = scoreCoverage(issues, expected);
    expect(r.score).toBe(0);
  });

  it('requires category compatibility', () => {
    const expected = [{ line: 10, category: 'security' }];
    const issues = [{ type: 'style', line: 10 }];
    const r = scoreCoverage(issues, expected);
    expect(r.score).toBe(0);
  });
});

describe('scoreSeverity', () => {
  it('returns 0 when no expected issues', () => {
    const r = scoreSeverity([], []);
    expect(r.score).toBe(0);
  });

  it('returns 0 when no issues match', () => {
    const expected = [{ line: 10, category: 'bug', severity: 'high' }];
    const r = scoreSeverity([], expected);
    expect(r.score).toBe(0);
  });

  it('returns 1 when all severities match', () => {
    const expected = [
      { line: 10, category: 'bug', severity: 'high' },
      { line: 20, category: 'style', severity: 'low' },
    ];
    const issues = [
      { type: 'bug', line: 10, severity: 'high' },
      { type: 'style', line: 20, severity: 'low' },
    ];
    const r = scoreSeverity(issues, expected);
    expect(r.score).toBe(1);
  });

  it('returns partial score for mixed severity matches', () => {
    const expected = [
      { line: 10, category: 'bug', severity: 'high' },
      { line: 20, category: 'style', severity: 'low' },
    ];
    const issues = [
      { type: 'bug', line: 10, severity: 'high' },
      { type: 'style', line: 20, severity: 'medium' }, // wrong severity
    ];
    const r = scoreSeverity(issues, expected);
    expect(r.score).toBe(0.5);
  });

  it('matches severity case-insensitively', () => {
    const expected = [{ line: 10, category: 'bug', severity: 'High' }];
    const issues = [{ type: 'bug', line: 10, severity: 'high' }];
    const r = scoreSeverity(issues, expected);
    expect(r.score).toBe(1);
  });
});
