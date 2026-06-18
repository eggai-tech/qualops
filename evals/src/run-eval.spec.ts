'use strict';

jest.mock('@langfuse/client', () => ({ LangfuseClient: jest.fn() }));

import { parseDiffLines } from './reviewer';
import { resolveDatasets, resolvePreset, listPresets } from './config';
import { CRB_REPOS } from './config';
import { classifyError, createRunLog } from './run-log';
import fs from 'node:fs';
import path from 'node:path';

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

describe('resolveDatasets', () => {
  it('returns qualops by default', () => {
    const datasets = resolveDatasets();
    expect(datasets).toEqual(['qualops/qualops']);
  });

  it('returns CRB_REPOS list', () => {
    expect(Object.keys(CRB_REPOS)).toEqual(['sentry', 'grafana', 'cal_dot_com', 'discourse', 'keycloak']);
  });
});

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

describe('createRunLog', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('collects entries and writes a summary file', () => {
    const mkdirSpy = jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    const writeSpy = jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const log = createRunLog({ experimentName: 'test', presetLabel: 'default', configPath: '', model: '', mode: '', provider: '' });
    log.add({ level: 'info', event: 'item_complete', caseId: 'a' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'TIMEOUT', caseId: 'b' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'TIMEOUT', caseId: 'c' });
    log.add({ level: 'error', event: 'review_error', errorCode: 'AUTH_FAILED', caseId: 'd' });
    log.add({ level: 'warn', event: 'repo_not_found', warnCode: 'REPO_NOT_FOUND', caseId: 'e' });
    log.add({ level: 'warn', event: 'checkout_failed', warnCode: 'CHECKOUT_FAILED', caseId: 'f' });

    const logFile = log.write();

    expect(mkdirSpy).toHaveBeenCalled();
    expect(writeSpy).toHaveBeenCalledTimes(1);
    expect(logFile).toMatch(/\.json$/);

    const written = JSON.parse((writeSpy.mock.calls[0] as [string, string])[1]);
    expect(written.totals.successes).toBe(1);
    expect(written.totals.errors).toBe(3);
    expect(written.totals.warnings).toBe(2);
    expect(written.errorBreakdown).toEqual({ TIMEOUT: 2, AUTH_FAILED: 1 });
    expect(written.warningBreakdown).toEqual({ REPO_NOT_FOUND: 1, CHECKOUT_FAILED: 1 });
    expect(written.entries).toHaveLength(6);
  });

  it('adds timestamps to entries', () => {
    jest.spyOn(fs, 'mkdirSync').mockReturnValue(undefined);
    jest.spyOn(fs, 'writeFileSync').mockReturnValue(undefined);

    const log = createRunLog({ experimentName: 'test', presetLabel: 'default', configPath: '', model: '', mode: '', provider: '' });
    log.add({ level: 'info', event: 'test' });
    log.write();

    const written = JSON.parse((fs.writeFileSync as jest.MockedFunction<typeof fs.writeFileSync>).mock.calls[0][1] as string);
    expect(written.entries[0].timestamp).toBeDefined();
    expect(written.startedAt).toBeDefined();
    expect(written.finishedAt).toBeDefined();
  });
});

describe('listPresets', () => {
  it('returns array of preset names from evals/qualopsrc/', () => {
    const presets = listPresets();
    expect(Array.isArray(presets)).toBe(true);
    expect(presets).toContain('fast');
    expect(presets).toContain('thorough');
    expect(presets).toContain('security');
    expect(presets).toContain('sonnet-agentic');
  });
});

describe('resolvePreset', () => {
  it('returns null for default preset', () => {
    expect(resolvePreset(null)).toBeNull();
    expect(resolvePreset('default')).toBeNull();
  });

  it('returns file path for known preset', () => {
    const result = resolvePreset('fast');
    expect(result).toMatch(/evals\/qualopsrc\/fast\.json$/);
  });

  it('throws for unknown preset', () => {
    expect(() => resolvePreset('nonexistent')).toThrow(/Unknown preset.*nonexistent/);
  });

  it('returned path points to a valid JSON file', () => {
    const presetPath = resolvePreset('thorough')!;
    const content = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
    expect(content.ai).toBeDefined();
    expect(content.ai.reviewStage.model).toBeDefined();
    expect(content.review.pipeline).toBeDefined();
  });

  it('preset config has an enabled agentic job', () => {
    const presetPath = resolvePreset('sonnet-agentic')!;
    const content = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));
    const agenticJob = content.review.pipeline.find((j: { mode: string; enabled: boolean }) => j.mode === 'agentic' && j.enabled);
    expect(agenticJob).toBeDefined();
    expect(agenticJob.agentic.maxTurns).toBeGreaterThan(0);
  });

  it('presets differ from each other in meaningful ways', () => {
    const fast = JSON.parse(fs.readFileSync(resolvePreset('fast')!, 'utf-8'));
    const thorough = JSON.parse(fs.readFileSync(resolvePreset('thorough')!, 'utf-8'));

    const fastJob = fast.review.pipeline.find((j: { enabled: boolean }) => j.enabled);
    const thoroughJob = thorough.review.pipeline.find((j: { enabled: boolean }) => j.enabled);

    expect(thoroughJob.agentic.maxTurns).toBeGreaterThan(fastJob.agentic.maxTurns);
    expect(thoroughJob.agentic.maxBudgetUsd).toBeGreaterThan(fastJob.agentic.maxBudgetUsd);

    expect(fast.review.validation.enabled).toBe(false);
    expect(thorough.review.validation.enabled).toBe(true);
  });

  it('preset configs differ from default qualopsrc in expected ways', () => {
    const QUALOPS_ROOT = path.join(__dirname, '../..');
    const defaultRc = JSON.parse(fs.readFileSync(path.join(QUALOPS_ROOT, '.qualops/.qualopsrc.json'), 'utf-8'));
    const fastRc = JSON.parse(fs.readFileSync(resolvePreset('fast')!, 'utf-8'));
    const thoroughRc = JSON.parse(fs.readFileSync(resolvePreset('thorough')!, 'utf-8'));

    expect(defaultRc.review.validation.enabled).toBe(true);
    expect(fastRc.review.validation.enabled).toBe(false);

    const fastJob = fastRc.review.pipeline.find((j: { mode: string; enabled: boolean }) => j.mode === 'agentic' && j.enabled);
    const thoroughJob = thoroughRc.review.pipeline.find((j: { mode: string; enabled: boolean }) => j.mode === 'agentic' && j.enabled);
    expect(thoroughJob.agentic.maxTurns).toBeGreaterThan(fastJob.agentic.maxTurns);
    expect(thoroughJob.agentic.maxBudgetUsd).toBeGreaterThan(fastJob.agentic.maxBudgetUsd);

    expect(fastJob.agentic.contextMode).toBe('diff');
    expect(thoroughJob.agentic.contextMode).toBe('full');

    expect(thoroughRc.review.minConfidence).toBeLessThan(defaultRc.review.minConfidence);
  });

  it('each preset has the required config structure for qualops', () => {
    for (const name of listPresets()) {
      const presetPath = resolvePreset(name)!;
      const config = JSON.parse(fs.readFileSync(presetPath, 'utf-8'));

      expect(config.ai).toBeDefined();
      expect(config.ai.reviewStage).toBeDefined();
      expect(config.ai.reviewStage.provider).toBeDefined();
      expect(config.ai.reviewStage.model).toBeDefined();

      expect(config.review).toBeDefined();
      expect(config.review.pipeline).toBeDefined();
      expect(config.review.pipeline.length).toBeGreaterThan(0);

      const enabledJob = config.review.pipeline.find((j: { enabled: boolean }) => j.enabled);
      expect(enabledJob).toBeDefined();
    }
  });
});
