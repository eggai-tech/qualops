'use strict';

jest.mock('langfuse', () => ({ Langfuse: jest.fn() }));

const { buildQualOpsItem, buildCrbItem } = require('./upload-datasets');

// ─── buildQualOpsItem ────────────────────────────────────────────────────────

describe('buildQualOpsItem', () => {
  it('builds item with all fields', () => {
    const data = {
      id: 'test-1',
      filePath: 'src/app.ts',
      language: 'typescript',
      fullContent: 'const x = 1;',
      diff: '@@ -1 +1 @@\n+const x = 1;',
      expected: [
        { line: 1, lineEnd: 1, type: 'bug', severity: 'high', description: 'unused var' },
      ],
    };
    const item = buildQualOpsItem(data, 0);

    expect(item.id).toBe('test-1');
    expect(item.input.caseId).toBe('test-1');
    expect(item.input.source).toBe('qualops');
    expect(item.input.filePath).toBe('src/app.ts');
    expect(item.input.language).toBe('typescript');
    expect(item.input.fullContent).toBe('const x = 1;');
    expect(item.input.diff).toBe('@@ -1 +1 @@\n+const x = 1;');
  });

  it('maps expected to referenceBugs', () => {
    const data = {
      filePath: 'a.ts',
      expected: [
        { line: 10, lineEnd: 15, type: 'bug', severity: 'high', description: 'desc' },
      ],
    };
    const item = buildQualOpsItem(data, 0);
    const bug = item.expectedOutput.referenceBugs[0];

    expect(bug.relevantFile).toBe('a.ts');
    expect(bug.relevantLinesStart).toBe(10);
    expect(bug.relevantLinesEnd).toBe(15);
    expect(bug.type).toBe('bug');
    expect(bug.severity).toBe('high');
    expect(bug.description).toBe('desc');
  });

  it('generates fallback id from index', () => {
    const item = buildQualOpsItem({}, 3);
    expect(item.id).toBe('qualops-4');
    expect(item.input.caseId).toBe('qualops-4');
  });

  it('defaults missing fields', () => {
    const item = buildQualOpsItem({}, 0);
    expect(item.input.filePath).toBe('unknown.ts');
    expect(item.input.language).toBe('typescript');
    expect(item.input.fullContent).toBe('');
    expect(item.input.diff).toBe('');
    expect(item.expectedOutput.referenceBugs).toEqual([]);
    expect(item.expectedOutput.referenceExpected).toEqual([]);
  });
});

// ─── buildCrbItem ────────────────────────────────────────────────────────────

describe('buildCrbItem', () => {
  it('builds item with repo metadata', () => {
    const data = {
      id: 'crb-1',
      pr_title: 'Fix pagination',
      pr_url: 'https://github.com/org/repo/pull/1',
      source_repo: 'sentry',
      diff: '--- a/file.py\n+++ b/file.py',
      language: 'python',
      expected: [
        { line: 10, type: 'bug', severity: 'high', description: 'off-by-one' },
      ],
    };
    const item = buildCrbItem(data, 0, 'sentry');

    expect(item.id).toBe('crb-1');
    expect(item.input.source).toBe('crb');
    expect(item.input.prTitle).toBe('Fix pagination');
    expect(item.input.prUrl).toBe('https://github.com/org/repo/pull/1');
    expect(item.input.sourceRepo).toBe('sentry');
    expect(item.input.language).toBe('python');
    expect(item.metadata.repo).toBe('sentry');
  });

  it('generates fallback id from repo and index', () => {
    const item = buildCrbItem({}, 2, 'grafana');
    expect(item.id).toBe('crb-grafana-3');
  });

  it('falls back to CRB_REPOS language', () => {
    const item = buildCrbItem({}, 0, 'grafana');
    expect(item.input.language).toBe('go');
  });

  it('maps expected to both referenceBugs and referenceExpected', () => {
    const data = {
      expected: [
        { line: 5, lineEnd: 10, type: 'security', severity: 'critical', description: 'injection' },
      ],
    };
    const item = buildCrbItem(data, 0, 'sentry');

    expect(item.expectedOutput.referenceExpected).toHaveLength(1);
    expect(item.expectedOutput.referenceBugs).toHaveLength(1);
    expect(item.expectedOutput.referenceExpected[0].line).toBe(5);
    expect(item.expectedOutput.referenceBugs[0].relevantLinesStart).toBe(5);
  });
});
