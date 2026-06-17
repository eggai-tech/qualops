'use strict';

jest.mock('@langfuse/client', () => ({ LangfuseClient: jest.fn() }));

import { buildQualOpsItem, crbSliceToCrbItem } from './upload-datasets';
import { buildCrbExpectedPair } from './config';

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
    const bug = item.expectedOutput.referenceBugs[0] as { relevantFile?: string; relevantLinesStart?: number; relevantLinesEnd?: number; type?: string; severity?: string; description?: string };

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

describe('buildCrbExpectedPair', () => {
  it('normalises expected entries with defaults', () => {
    const { referenceExpected, referenceBugs } = buildCrbExpectedPair({
      prUrl: 'https://github.com/org/repo/pull/1',
      expected: [{ line: 5, lineEnd: 10, type: 'security', severity: 'critical', description: 'injection' }],
    });

    expect(referenceExpected).toHaveLength(1);
    expect(referenceExpected[0]).toMatchObject({ line: 5, lineEnd: 10, type: 'security', severity: 'critical' });
    expect(referenceBugs).toHaveLength(1);
    expect(referenceBugs[0].relevantFile).toBe('https://github.com/org/repo/pull/1');
    expect(referenceBugs[0].relevantLinesStart).toBe(5);
  });

  it('applies default type and severity when missing', () => {
    const { referenceExpected } = buildCrbExpectedPair({
      prUrl: 'https://github.com/org/repo/pull/2',
      expected: [{ line: null, lineEnd: null, type: '', severity: '', description: '' }],
    });
    expect(referenceExpected[0].type).toBe('bug');
    expect(referenceExpected[0].severity).toBe('medium');
  });
});

describe('crbSliceToCrbItem', () => {
  const baseSlice = {
    id: 'crb-sentry-1',
    source: 'crb' as const,
    prUrl: 'https://github.com/org/repo/pull/1',
    prTitle: 'Fix pagination',
    sourceRepo: 'sentry',
    language: 'python',
    baseSha: 'abc',
    headSha: 'def',
    baseRef: 'master',
    headRef: 'fix-branch',
    upstreamOwner: 'org',
    upstreamRepo: 'repo',
    diff: '--- a/file.py\n+++ b/file.py',
    expected: [{ line: 10, lineEnd: 10, type: 'bug', severity: 'high', description: 'off-by-one' }],
  };

  it('builds item with slice metadata', () => {
    const item = crbSliceToCrbItem(baseSlice, 'sentry');

    expect(item.id).toBe('crb-sentry-1');
    expect(item.input.source).toBe('crb');
    expect(item.input.prTitle).toBe('Fix pagination');
    expect(item.input.prUrl).toBe('https://github.com/org/repo/pull/1');
    expect(item.input.sourceRepo).toBe('sentry');
    expect(item.input.language).toBe('python');
    expect(item.metadata.repo).toBe('sentry');
  });

  it('falls back to CRB_REPOS language when slice language is empty', () => {
    const item = crbSliceToCrbItem({ ...baseSlice, language: '' }, 'grafana');
    expect(item.input.language).toBe('go');
  });

  it('maps expected to both referenceBugs and referenceExpected', () => {
    const item = crbSliceToCrbItem(baseSlice, 'sentry');

    expect(item.expectedOutput.referenceExpected).toHaveLength(1);
    expect(item.expectedOutput.referenceBugs).toHaveLength(1);
    expect(item.expectedOutput.referenceExpected[0].line).toBe(10);
    const bug = item.expectedOutput.referenceBugs[0] as { relevantLinesStart?: number };
    expect(bug.relevantLinesStart).toBe(10);
  });

  it('sets git.head_sha to empty string so repo_path is used directly', () => {
    const item = crbSliceToCrbItem(baseSlice, 'sentry');
    const git = item.input.git as { head_sha: string };
    expect(git.head_sha).toBe('');
  });
});
