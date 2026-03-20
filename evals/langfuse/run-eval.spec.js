'use strict';

jest.mock('langfuse', () => ({ Langfuse: jest.fn() }));

const { parseDiffLines, resolveDatasets, CRB_REPOS } = require('./run-eval');

// ─── parseDiffLines ──────────────────────────────────────────────────────────

describe('parseDiffLines', () => {
  it('returns empty sets for empty/null input', () => {
    const r = parseDiffLines('');
    expect(r.additions.size).toBe(0);
    expect(r.deletions.size).toBe(0);
  });

  it('parses standard unified diff additions', () => {
    const diff = '@@ -1,3 +1,4 @@\n context\n+added line\n context\n context';
    const r = parseDiffLines(diff);
    expect(r.additions.has(2)).toBe(true);
    expect(r.additions.size).toBe(1);
  });

  it('parses standard unified diff deletions', () => {
    const diff = '@@ -1,4 +1,3 @@\n context\n-deleted line\n context\n context';
    const r = parseDiffLines(diff);
    expect(r.deletions.has(2)).toBe(true);
  });

  it('tracks line numbers across multiple hunks', () => {
    const diff = '@@ -1,2 +1,3 @@\n ctx\n+add1\n ctx\n@@ -10,2 +11,3 @@\n ctx\n+add2\n ctx';
    const r = parseDiffLines(diff);
    expect(r.additions.has(2)).toBe(true);
    expect(r.additions.has(12)).toBe(true);
  });

  it('ignores --- and +++ header lines', () => {
    const diff = '--- a/file.ts\n+++ b/file.ts\n@@ -1,2 +1,3 @@\n ctx\n+added\n ctx';
    const r = parseDiffLines(diff);
    expect(r.additions.size).toBe(1);
    expect(r.deletions.size).toBe(0);
  });
});

// ─── resolveDatasets ─────────────────────────────────────────────────────────

describe('resolveDatasets', () => {
  it('returns qualops by default', () => {
    const datasets = resolveDatasets();
    expect(datasets).toEqual(['qualops/qualops']);
  });

  it('returns CRB_REPOS list', () => {
    expect(CRB_REPOS).toEqual(['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak']);
  });
});
