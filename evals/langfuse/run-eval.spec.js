'use strict';

jest.mock('langfuse', () => ({ Langfuse: jest.fn() }));

const { parseDiffLines, resolveDatasets, classifyError, createRunLog, CRB_REPOS } = require('./run-eval');

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

// ─── classifyError ──────────────────────────────────────────────────────────

describe('classifyError', () => {
  it('classifies rate limit errors', () => {
    expect(classifyError(new Error('rate limit exceeded'))).toBe('RATE_LIMITED');
    expect(classifyError(new Error('Request failed with status 429'))).toBe('RATE_LIMITED');
  });

  it('classifies auth errors', () => {
    expect(classifyError(new Error('401 Unauthorized'))).toBe('AUTH_FAILED');
    expect(classifyError(new Error('Bad credentials'))).toBe('AUTH_FAILED');
    expect(classifyError(new Error('403 Forbidden'))).toBe('AUTH_FAILED');
  });

  it('classifies timeout errors', () => {
    expect(classifyError(new Error('Request timed out'))).toBe('TIMEOUT');
    expect(classifyError(new Error('The operation was aborted'))).toBe('TIMEOUT');
  });

  it('classifies budget errors', () => {
    expect(classifyError(new Error('budget exhausted'))).toBe('BUDGET_EXHAUSTED');
  });

  it('classifies parse errors', () => {
    expect(classifyError(new Error('Unexpected token < in JSON'))).toBe('PARSE_ERROR');
  });

  it('classifies network errors', () => {
    expect(classifyError(new Error('connect ECONNREFUSED'))).toBe('NETWORK_ERROR');
    expect(classifyError(new Error('fetch failed'))).toBe('NETWORK_ERROR');
  });

  it('classifies API errors', () => {
    expect(classifyError(new Error('Internal Server Error 500'))).toBe('API_ERROR');
    expect(classifyError(new Error('Service overloaded'))).toBe('API_ERROR');
  });

  it('returns UNKNOWN for unrecognized errors', () => {
    expect(classifyError(new Error('something weird happened'))).toBe('UNKNOWN');
  });

  it('handles non-Error objects', () => {
    expect(classifyError('rate limit')).toBe('RATE_LIMITED');
    expect(classifyError({ message: 'timeout' })).toBe('TIMEOUT');
  });
});

// ─── createRunLog ───────────────────────────────────────────────────────────

describe('createRunLog', () => {
  const fs = require('fs');
  const path = require('path');

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('collects entries and writes a summary file', () => {
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const log = createRunLog();
    log.add({ level: 'info', event: 'item_complete', caseId: 'a' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'TIMEOUT', caseId: 'b' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'TIMEOUT', caseId: 'c' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'AUTH_FAILED', caseId: 'd' });
    log.add({ level: 'warn', event: 'repo_not_found', warnCode: 'REPO_NOT_CLONED', caseId: 'e' });
    log.add({ level: 'warn', event: 'checkout_failed', warnCode: 'CHECKOUT_FAILED', caseId: 'f' });

    const logFile = log.write();

    expect(mkdirSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(logFile).toMatch(/\.json$/);

    const written = JSON.parse(writeSpy.mock.calls[0][1]);
    expect(written.totals.successes).toBe(1);
    expect(written.totals.errors).toBe(3);
    expect(written.totals.warnings).toBe(2);
    expect(written.errorBreakdown).toEqual({ TIMEOUT: 2, AUTH_FAILED: 1 });
    expect(written.warningBreakdown).toEqual({ REPO_NOT_CLONED: 1, CHECKOUT_FAILED: 1 });
    expect(written.entries).toHaveLength(6);
  });

  it('adds timestamps to entries', () => {
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const log = createRunLog();
    log.add({ level: 'info', event: 'test' });
    log.write();

    const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
    expect(written.entries[0].timestamp).toBeDefined();
    expect(written.startedAt).toBeDefined();
    expect(written.finishedAt).toBeDefined();
  });
});
