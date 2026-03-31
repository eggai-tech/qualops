'use strict';

const { scoreParser } = require('./parse');

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
