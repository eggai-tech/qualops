'use strict';

const { scoreCoverage } = require('./coverage');

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
