import type { FileInfo } from '@/shared/types/config';
import {
  calculatePriority,
  normalizeIssue,
  parseIssuesFromResult,
  parseLocation,
} from '@/stages/review/agentic/result-parser';

const file = (path: string): FileInfo => ({ path, content: '' });

describe('parseLocation', () => {
  it('returns empty object for empty string', () => {
    expect(parseLocation('')).toEqual({});
  });

  it('parses "file:line" format', () => {
    expect(parseLocation('src/foo.ts:42')).toEqual({ file: 'src/foo.ts', line: 42 });
  });

  it('parses "line N" format (no file)', () => {
    expect(parseLocation('line 42')).toEqual({ line: 42 });
  });

  it('parses "line:N" format as file="line", line=N (colon-digit regex matches first)', () => {
    // The "file:line" regex matches before the "line:N" regex, so "line" becomes the file name
    expect(parseLocation('line:10')).toEqual({ file: 'line', line: 10 });
  });

  it('returns empty object for plain filename with no line number', () => {
    expect(parseLocation('src/foo.ts')).toEqual({});
  });
});

describe('calculatePriority', () => {
  it.each([
    ['critical', 1],
    ['high', 2],
    ['medium', 3],
    ['low', 4],
  ])('maps %s → %i', (severity, expected) => {
    expect(calculatePriority(severity)).toBe(expected);
  });

  it('defaults to 3 for unknown severity', () => {
    expect(calculatePriority('unknown')).toBe(3);
    expect(calculatePriority('')).toBe(3);
  });
});

describe('normalizeIssue', () => {
  const files = [file('src/foo.ts'), file('src/bar.ts')];

  it('uses location file when present', () => {
    const issue = { location: 'src/bar.ts:5', type: 'bug', severity: 'high', confidence: 8 };
    const result = normalizeIssue(issue, 0, files, 'test-job');
    expect(result.file).toBe('src/bar.ts');
    expect(result.location).toBe('5');
  });

  it('falls back to first file when location has no file part', () => {
    const issue = { location: 'line 10', type: 'bug', severity: 'medium', confidence: 8 };
    const result = normalizeIssue(issue, 0, files, 'test-job');
    expect(result.file).toBe('src/foo.ts');
    expect(result.location).toBe('10');
  });

  it('falls back to "unknown" when files array is empty', () => {
    const issue = { type: 'bug', severity: 'low', confidence: 7 };
    const result = normalizeIssue(issue, 0, [], 'test-job');
    expect(result.file).toBe('unknown');
  });

  it('defaults location to "1" when no line number', () => {
    const issue = { type: 'bug', severity: 'low', confidence: 7 };
    const result = normalizeIssue(issue, 0, files, 'test-job');
    expect(result.location).toBe('1');
  });

  it('uses "issue.file" as location input but falls back to files[0] when no line format matches', () => {
    // parseLocation('src/baz.ts') returns {} — no colon+digit or "line N" pattern
    // so file falls back to files[0].path
    const issue = { file: 'src/baz.ts', type: 'bug', severity: 'low', confidence: 7 };
    const result = normalizeIssue(issue, 0, files, 'test-job');
    expect(result.file).toBe('src/foo.ts');
  });

  it('uses "issue.file" with line number to set file correctly', () => {
    const issue = { file: 'src/baz.ts:3', type: 'bug', severity: 'low', confidence: 7 };
    const result = normalizeIssue(issue, 0, files, 'test-job');
    expect(result.file).toBe('src/baz.ts');
    expect(result.location).toBe('3');
  });

  it('includes jobName in id and knowledge_source', () => {
    const issue = { type: 'bug', severity: 'medium', confidence: 8 };
    const result = normalizeIssue(issue, 2, files, 'my-job');
    expect(result.id).toMatch(/^agentic-my-job-\d+-2$/);
    expect(result.knowledge_source).toBe('agentic:my-job');
  });

  it('sets correct priority from severity', () => {
    const issue = { severity: 'critical', type: 'security', confidence: 9 };
    const result = normalizeIssue(issue, 0, files, 'j');
    expect(result.priority).toBe(1);
  });

  it('fills in defaults for missing fields', () => {
    const result = normalizeIssue({ confidence: 7 }, 0, files, 'j');
    expect(result.type).toBe('maintainability');
    expect(result.severity).toBe('medium');
    expect(result.description).toBe('No description');
    expect(result.reasoning).toBe('');
    expect(result.suggestion).toBe('');
    expect(result.context).toBe('');
    expect(result.confidence).toBe(7);
    expect(result.estimatedEffort).toBe('medium');
  });

  it('builds tags array from type, severity, and "agentic"', () => {
    const issue = { type: 'security', severity: 'high', confidence: 8 };
    const result = normalizeIssue(issue, 0, files, 'j');
    expect(result.tags).toEqual(['security', 'high', 'agentic']);
  });
});

describe('parseIssuesFromResult', () => {
  const files = [file('src/foo.ts')];

  it('returns empty array when no JSON found', () => {
    expect(parseIssuesFromResult('No issues found.', files, 'job')).toEqual([]);
  });

  it('parses issues from a plain JSON array', () => {
    const issues = [
      {
        type: 'bug',
        severity: 'high',
        description: 'Bad',
        location: 'src/foo.ts:1',
        confidence: 8,
      },
    ];
    const result = parseIssuesFromResult(JSON.stringify(issues), files, 'job');
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('Bad');
  });

  it('parses issues from a fenced code block', () => {
    const json =
      '[{"type":"bug","severity":"low","description":"Lint","location":"src/foo.ts:2","confidence":7}]';
    const result = parseIssuesFromResult('```json\n' + json + '\n```', files, 'job');
    expect(result).toHaveLength(1);
  });

  it('filters out issues with confidence < 7', () => {
    const issues = [
      { type: 'bug', severity: 'high', description: 'Low conf', confidence: 5 },
      { type: 'bug', severity: 'high', description: 'High conf', confidence: 8 },
    ];
    const result = parseIssuesFromResult(JSON.stringify(issues), files, 'job');
    expect(result).toHaveLength(1);
    expect(result[0].description).toBe('High conf');
  });

  it('returns empty array for malformed JSON', () => {
    expect(parseIssuesFromResult('```json\n{bad json\n```', files, 'job')).toEqual([]);
  });

  it('returns empty array when result is not an array', () => {
    expect(parseIssuesFromResult('{"type":"bug"}', files, 'job')).toEqual([]);
  });
});
