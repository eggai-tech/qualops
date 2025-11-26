import type { FixSuggestion } from '@/shared/types';
import {
  calculateDiff,
  calculateFixDiff,
  calculateMultiVersionDiff,
  calculateSimilarity,
  type DiffOptions,
  type FileDiff,
  formatSideBySideDiff,
  formatUnifiedDiff,
} from '@/stages/fix/utils/diff-calculator';

jest.mock('@/shared/utils/logger');

describe('calculateDiff', () => {
  it('should calculate diff for identical code', () => {
    const original = 'const x = 1;\nconst y = 2;';
    const suggested = 'const x = 1;\nconst y = 2;';

    const result = calculateDiff(original, suggested);

    expect(result).toEqual([]);
  });

  it('should calculate diff for added lines', () => {
    const original = 'const x = 1;';
    const suggested = 'const x = 1;\nconst y = 2;';

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((s) => s.type === 'add')).toBe(true);
    expect(result.some((s) => s.content.includes('const y = 2;'))).toBe(true);
  });

  it('should calculate diff for removed lines', () => {
    const original = 'const x = 1;\nconst y = 2;';
    const suggested = 'const x = 1;';

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((s) => s.type === 'remove')).toBe(true);
    expect(result.some((s) => s.content.includes('const y = 2;'))).toBe(true);
  });

  it('should calculate diff for modified lines', () => {
    const original = 'const x = 1;';
    const suggested = 'const x = 2;';

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
    expect(result.some((s) => s.type === 'remove' && s.content.includes('const x = 1;'))).toBe(
      true,
    );
    expect(result.some((s) => s.type === 'add' && s.content.includes('const x = 2;'))).toBe(true);
  });

  it('should respect contextLines option', () => {
    const original = 'line1\nline2\nline3\nline4\nline5';
    const suggested = 'line1\nline2\nchanged\nline4\nline5';

    const resultWithContext = calculateDiff(original, suggested, { contextLines: 2 });
    const resultWithoutContext = calculateDiff(original, suggested, { contextLines: 0 });

    const contextCount = resultWithContext.filter((s) => s.type === 'context').length;
    const noContextCount = resultWithoutContext.filter((s) => s.type === 'context').length;

    expect(contextCount).toBeGreaterThan(noContextCount);
  });

  it('should handle whitespace differences', () => {
    const original = 'const x=1;';
    const suggested = 'const x = 1;';

    const withWhitespace = calculateDiff(original, suggested, { ignoreWhitespace: false });
    const withoutWhitespace = calculateDiff(original, suggested, { ignoreWhitespace: true });

    expect(withWhitespace.length).toBeGreaterThan(0);
    expect(withoutWhitespace).toBeDefined();
  });

  it('should include line numbers when showLineNumbers is true', () => {
    const original = 'line1\nline2';
    const suggested = 'line1\nchanged';

    const result = calculateDiff(original, suggested, { showLineNumbers: true });

    const segmentWithLineNumber = result.find((s) => s.lineNumber !== undefined);
    expect(segmentWithLineNumber).toBeDefined();
  });

  it('should not include line numbers when showLineNumbers is false', () => {
    const original = 'line1\nline2';
    const suggested = 'line1\nchanged';

    const result = calculateDiff(original, suggested, { showLineNumbers: false });

    expect(result.every((s) => s.lineNumber === undefined)).toBe(true);
  });

  it('should handle empty strings', () => {
    const result1 = calculateDiff('', '');
    const result2 = calculateDiff('', 'content');
    const result3 = calculateDiff('content', '');

    expect(result1).toEqual([]);
    expect(result2.length).toBeGreaterThan(0);
    expect(result3.length).toBeGreaterThan(0);
  });

  it('should handle multiline changes', () => {
    const original = 'function test() {\n  return 1;\n}';
    const suggested = 'function test() {\n  return 2;\n  console.log("hi");\n}';

    const result = calculateDiff(original, suggested);

    expect(result.some((s) => s.type === 'remove')).toBe(true);
    expect(result.some((s) => s.type === 'add')).toBe(true);
  });
});

describe('calculateFixDiff', () => {
  const mockSuggestion: FixSuggestion = {
    issueId: 'test-123',
    file: 'test.ts',
    line: 10,
    originalCode: 'const x = 1;',
    suggestedCode: 'const x = 2;',
    explanation: 'Update value',
    confidence: 'high',
    breaking: false,
    applied: false,
  };

  it('should calculate diff for fix suggestion', () => {
    const result = calculateFixDiff(mockSuggestion);

    expect(result.filePath).toBe('test.ts');
    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.stats).toBeDefined();
  });

  it('should calculate stats correctly', () => {
    const result = calculateFixDiff(mockSuggestion);

    expect(result.stats.totalLines).toBeGreaterThan(0);
    expect(typeof result.stats.linesAdded).toBe('number');
    expect(typeof result.stats.linesRemoved).toBe('number');
    expect(typeof result.stats.linesModified).toBe('number');
  });

  it('should handle suggestion with no suggested code', () => {
    const suggestion = { ...mockSuggestion, suggestedCode: undefined };

    const result = calculateFixDiff(suggestion);

    expect(result.filePath).toBe('test.ts');
    expect(result.segments).toBeDefined();
  });

  it('should handle suggestion with no original code', () => {
    const suggestion = { ...mockSuggestion, originalCode: '' };

    const result = calculateFixDiff(suggestion);

    expect(result.segments.length).toBeGreaterThan(0);
    expect(result.stats.linesAdded).toBeGreaterThan(0);
  });

  it('should respect diff options', () => {
    const options: DiffOptions = {
      contextLines: 5,
      ignoreWhitespace: true,
      showLineNumbers: false,
    };

    const result = calculateFixDiff(mockSuggestion, options);

    expect(result.segments.every((s) => s.lineNumber === undefined)).toBe(true);
  });
});

describe('calculateMultiVersionDiff', () => {
  it('should calculate diff between multiple versions', () => {
    const versions = [
      { name: 'v1', content: 'const x = 1;' },
      { name: 'v2', content: 'const x = 2;' },
      { name: 'v3', content: 'const x = 3;' },
    ];

    const result = calculateMultiVersionDiff(versions);

    expect(result.size).toBe(2);
    expect(result.has('v1-v2')).toBe(true);
    expect(result.has('v2-v3')).toBe(true);
  });

  it('should return empty map for single version', () => {
    const versions = [{ name: 'v1', content: 'const x = 1;' }];

    const result = calculateMultiVersionDiff(versions);

    expect(result.size).toBe(0);
  });

  it('should return empty map for empty versions', () => {
    const result = calculateMultiVersionDiff([]);

    expect(result.size).toBe(0);
  });

  it('should create correct file path labels', () => {
    const versions = [
      { name: 'original', content: 'code1' },
      { name: 'modified', content: 'code2' },
    ];

    const result = calculateMultiVersionDiff(versions);
    const diff = result.get('original-modified')?.[0];

    expect(diff?.filePath).toBe('original → modified');
  });

  it('should calculate stats for each version pair', () => {
    const versions = [
      { name: 'v1', content: 'line1\nline2' },
      { name: 'v2', content: 'line1\nchanged' },
    ];

    const result = calculateMultiVersionDiff(versions);
    const diff = result.get('v1-v2')?.[0];

    expect(diff?.stats).toBeDefined();
    expect(diff?.stats.totalLines).toBeGreaterThan(0);
  });

  it('should respect diff options', () => {
    const versions = [
      { name: 'v1', content: 'const x=1;' },
      { name: 'v2', content: 'const x = 1;' },
    ];

    const withWhitespace = calculateMultiVersionDiff(versions, { ignoreWhitespace: false });
    const withoutWhitespace = calculateMultiVersionDiff(versions, { ignoreWhitespace: true });

    const diffWith = withWhitespace.get('v1-v2')?.[0];
    const diffWithout = withoutWhitespace.get('v1-v2')?.[0];

    expect(diffWithout?.segments.length).toBeLessThanOrEqual(diffWith?.segments.length || 0);
  });
});

describe('formatUnifiedDiff', () => {
  const mockFileDiff: FileDiff = {
    filePath: 'test.ts',
    segments: [
      { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'remove', content: 'line2', oldLineNumber: 2 },
      { type: 'add', content: 'changed', newLineNumber: 2 },
      { type: 'context', content: 'line3', oldLineNumber: 3, newLineNumber: 3 },
    ],
    stats: { linesAdded: 1, linesRemoved: 1, linesModified: 0, totalLines: 4 },
  };

  it('should format unified diff with headers', () => {
    const result = formatUnifiedDiff(mockFileDiff);

    expect(result).toContain('--- original');
    expect(result).toContain('+++ suggested');
  });

  it('should use custom file names', () => {
    const result = formatUnifiedDiff(mockFileDiff, 'old.ts', 'new.ts');

    expect(result).toContain('--- old.ts');
    expect(result).toContain('+++ new.ts');
  });

  it('should include hunk headers', () => {
    const result = formatUnifiedDiff(mockFileDiff);

    expect(result).toMatch(/@@ -\d+,\d+ \+\d+,\d+ @@/);
  });

  it('should prefix added lines with +', () => {
    const result = formatUnifiedDiff(mockFileDiff);

    expect(result).toContain('+changed');
  });

  it('should prefix removed lines with -', () => {
    const result = formatUnifiedDiff(mockFileDiff);

    expect(result).toContain('-line2');
  });

  it('should prefix context lines with space', () => {
    const result = formatUnifiedDiff(mockFileDiff);

    expect(result).toContain(' line1');
    expect(result).toContain(' line3');
  });

  it('should handle empty segments', () => {
    const emptyDiff: FileDiff = {
      filePath: 'test.ts',
      segments: [],
      stats: { linesAdded: 0, linesRemoved: 0, linesModified: 0, totalLines: 0 },
    };

    const result = formatUnifiedDiff(emptyDiff);

    expect(result).toContain('---');
    expect(result).toContain('+++');
  });

  it('should handle modify segments', () => {
    const modifyDiff: FileDiff = {
      filePath: 'test.ts',
      segments: [{ type: 'modify', content: 'modified line', oldLineNumber: 1, newLineNumber: 1 }],
      stats: { linesAdded: 0, linesRemoved: 0, linesModified: 1, totalLines: 1 },
    };

    const result = formatUnifiedDiff(modifyDiff);

    expect(result).toContain('!modified line');
  });
});

describe('formatSideBySideDiff', () => {
  const mockFileDiff: FileDiff = {
    filePath: 'test.ts',
    segments: [
      { type: 'context', content: 'line1', oldLineNumber: 1, newLineNumber: 1 },
      { type: 'remove', content: 'line2', oldLineNumber: 2 },
      { type: 'add', content: 'changed', newLineNumber: 2 },
    ],
    stats: { linesAdded: 1, linesRemoved: 1, linesModified: 0, totalLines: 3 },
  };

  it('should include header row', () => {
    const result = formatSideBySideDiff(mockFileDiff);

    expect(result).toContain('Original');
    expect(result).toContain('Suggested');
  });

  it('should include separator row', () => {
    const result = formatSideBySideDiff(mockFileDiff);

    expect(result).toMatch(/-+\s*\|\s*-+/);
  });

  it('should display removed lines on left only', () => {
    const result = formatSideBySideDiff(mockFileDiff);
    const lines = result.split('\n');
    const removeLine = lines.find((l) => l.includes('line2'));

    expect(removeLine).toBeDefined();
    expect(removeLine).toMatch(/line2.*-/);
  });

  it('should display added lines on right only', () => {
    const result = formatSideBySideDiff(mockFileDiff);
    const lines = result.split('\n');
    const addLine = lines.find((l) => l.includes('changed'));

    expect(addLine).toBeDefined();
    expect(addLine).toMatch(/\+.*changed/);
  });

  it('should display context lines on both sides', () => {
    const result = formatSideBySideDiff(mockFileDiff);
    const lines = result.split('\n');
    const contextLine = lines.find((l) => l.includes('line1') && !l.includes('Original'));

    expect(contextLine).toBeDefined();
  });

  it('should truncate long lines', () => {
    const longLineDiff: FileDiff = {
      filePath: 'test.ts',
      segments: [{ type: 'context', content: 'a'.repeat(100), oldLineNumber: 1, newLineNumber: 1 }],
      stats: { linesAdded: 0, linesRemoved: 0, linesModified: 0, totalLines: 1 },
    };

    const result = formatSideBySideDiff(longLineDiff);
    const lines = result.split('\n');

    lines.forEach((line) => {
      expect(line.includes('Original') || line.includes('---') || line.length < 150).toBe(true);
    });
  });

  it('should mark modified lines', () => {
    const modifyDiff: FileDiff = {
      filePath: 'test.ts',
      segments: [{ type: 'modify', content: 'modified', oldLineNumber: 1, newLineNumber: 1 }],
      stats: { linesAdded: 0, linesRemoved: 0, linesModified: 1, totalLines: 1 },
    };

    const result = formatSideBySideDiff(modifyDiff);

    expect(result).toContain('!');
  });

  it('should handle empty segments', () => {
    const emptyDiff: FileDiff = {
      filePath: 'test.ts',
      segments: [],
      stats: { linesAdded: 0, linesRemoved: 0, linesModified: 0, totalLines: 0 },
    };

    const result = formatSideBySideDiff(emptyDiff);

    expect(result).toContain('Original');
    expect(result).toContain('Suggested');
  });
});

describe('calculateSimilarity', () => {
  it('should return 100 for identical strings', () => {
    const result = calculateSimilarity('hello', 'hello');

    expect(result).toBe(100);
  });

  it('should return 100 for both empty strings', () => {
    const result = calculateSimilarity('', '');

    expect(result).toBe(100);
  });

  it('should return 0 for empty vs non-empty', () => {
    const result1 = calculateSimilarity('', 'hello');
    const result2 = calculateSimilarity('hello', '');

    expect(result1).toBe(0);
    expect(result2).toBe(0);
  });

  it('should calculate similarity for similar strings', () => {
    const result = calculateSimilarity('hello', 'hallo');

    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(100);
  });

  it('should calculate similarity for different strings', () => {
    const result = calculateSimilarity('abc', 'xyz');

    expect(result).toBeLessThan(50);
  });

  it('should handle single character difference', () => {
    const result = calculateSimilarity('test', 'text');

    expect(result).toBeGreaterThan(50);
  });

  it('should handle case sensitivity', () => {
    const result = calculateSimilarity('Hello', 'hello');

    expect(result).toBeGreaterThan(50);
    expect(result).toBeLessThan(100);
  });

  it('should handle longer strings', () => {
    const str1 = 'function calculateSimilarity(a, b) { return 0; }';
    const str2 = 'function calculateSimilarity(a, b) { return 1; }';

    const result = calculateSimilarity(str1, str2);

    expect(result).toBeGreaterThan(90);
  });

  it('should handle completely different strings', () => {
    const result = calculateSimilarity('abc', 'defghijklmnop');

    expect(result).toBeLessThan(20);
  });

  it('should return rounded integer', () => {
    const result = calculateSimilarity('test', 'text');

    expect(Number.isInteger(result)).toBe(true);
  });
});

describe('edge cases and error handling', () => {
  it('should handle code with special characters', () => {
    const original = 'const str = "hello\\nworld";';
    const suggested = 'const str = "hello\\tworld";';

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle code with unicode characters', () => {
    const original = 'const emoji = "😀";';
    const suggested = 'const emoji = "😃";';

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle very long lines', () => {
    const longLine = 'a'.repeat(10000);
    const result = calculateDiff(longLine, longLine + 'b');

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle many small changes', () => {
    const original = Array(100)
      .fill(0)
      .map((_, i) => `line${i}`)
      .join('\n');
    const suggested = Array(100)
      .fill(0)
      .map((_, i) => `line${i + 1}`)
      .join('\n');

    const result = calculateDiff(original, suggested);

    expect(result.length).toBeGreaterThan(0);
  });

  it('should handle code with tabs and spaces mixed', () => {
    const original = '\tconst x = 1;';
    const suggested = '    const x = 1;';

    const withWhitespace = calculateDiff(original, suggested, { ignoreWhitespace: false });
    const withoutWhitespace = calculateDiff(original, suggested, { ignoreWhitespace: true });

    expect(withWhitespace.length).toBeGreaterThan(0);
    expect(withoutWhitespace).toHaveLength(0);
  });
});
