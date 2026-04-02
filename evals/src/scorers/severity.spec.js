'use strict';

const { scoreSeverity } = require('./severity');

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
