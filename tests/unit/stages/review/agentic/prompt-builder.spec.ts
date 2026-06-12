import type { FileInfo } from '@/shared/types/config';
import {
  addLineNumbers,
  buildFileContext,
  buildUserPrompt,
  estimateTokens,
  formatFileContent,
} from '@/stages/review/agentic/prompt-builder';

function file(path: string, content = '', extras: Partial<FileInfo> = {}): FileInfo {
  return { path, content, ...extras };
}

describe('estimateTokens', () => {
  it('returns ceil(length / 4)', () => {
    expect(estimateTokens('abcd')).toBe(1);
    expect(estimateTokens('abcde')).toBe(2);
    expect(estimateTokens('')).toBe(0);
  });
});

describe('addLineNumbers', () => {
  it('prefixes each line with right-padded line number', () => {
    const result = addLineNumbers('foo\nbar');
    expect(result).toBe('   1 | foo\n   2 | bar');
  });

  it('handles a single line', () => {
    expect(addLineNumbers('hello')).toBe('   1 | hello');
  });
});

describe('formatFileContent', () => {
  it('returns line-numbered content when within budget', () => {
    const result = formatFileContent('a\nb\nc', 10000);
    expect(result).toBe('   1 | a\n   2 | b\n   3 | c');
  });

  it('truncates and appends TRUNCATED notice when content exceeds budget', () => {
    // maxLines = floor(20 / 10) = 2
    const content = 'a\nb\nc\nd\ne';
    const result = formatFileContent(content, 20);
    expect(result).toContain('[TRUNCATED: 3 more lines]');
    expect(result).toContain('   1 | a');
    expect(result).toContain('   2 | b');
    expect(result).not.toContain('   3 | c');
  });
});

describe('buildFileContext', () => {
  it('includes file path as header', () => {
    const result = buildFileContext(file('src/foo.ts', 'const x = 1;'), 'full', 8000, 50000);
    expect(result).toContain('## src/foo.ts');
  });

  it('uses diff content when mode is "diff" and rawDiff is present', () => {
    const f = file('src/foo.ts', 'x', { rawDiff: '@@ -1 +1 @@ -old\n+new' });
    const result = buildFileContext(f, 'diff', 8000, 50000);
    expect(result).toContain('```diff');
    expect(result).toContain('@@ -1 +1 @@');
    expect(result).not.toContain('   1 |');
  });

  it('uses diff content when mode is "auto" and rawDiff is present', () => {
    const f = file('src/foo.ts', 'const x = 1;', { rawDiff: '@@ -0,0 +1 @@\n+const x = 1;' });
    const result = buildFileContext(f, 'auto', 8000, 50000);
    expect(result).toContain('```diff');
  });

  it('falls back to full content when mode is "diff" but rawDiff is absent', () => {
    const result = buildFileContext(file('src/foo.ts', 'const x = 1;'), 'diff', 8000, 50000);
    expect(result).toContain('   1 | const x = 1;');
    expect(result).not.toContain('```diff');
  });

  it('uses min(maxTokens, remainingBudget) as the effective budget', () => {
    // remainingBudget = 10 → maxLines = floor(10/10) = 1
    const content = Array.from({ length: 5 }, (_, i) => `line${i}`).join('\n');
    const result = buildFileContext(file('src/foo.ts', content), 'full', 8000, 10);
    expect(result).toContain('[TRUNCATED:');
  });
});

describe('buildUserPrompt', () => {
  it('includes file path in the prompt', () => {
    const result = buildUserPrompt([file('src/foo.ts', 'const x = 1;')], {});
    expect(result).toContain('src/foo.ts');
  });

  it('sorts files by total diff size (largest first)', () => {
    const small = file('small.ts', 'x', {
      diff: { additions: new Set([1]), deletions: new Set() },
    });
    const large = file('large.ts', 'x', {
      diff: { additions: new Set([1, 2, 3, 4, 5]), deletions: new Set([6, 7]) },
    });
    const result = buildUserPrompt([small, large], {});
    expect(result.indexOf('large.ts')).toBeLessThan(result.indexOf('small.ts'));
  });

  it('stops adding files when total token budget is exhausted', () => {
    // Each file will produce ~100 chars of context; maxTotalTokens = 10 means only first fits
    const files = Array.from({ length: 10 }, (_, i) => file(`file${i}.ts`, 'x'.repeat(100)));
    const result = buildUserPrompt(files, { maxTotalTokens: 10 });
    // Only the first file should appear; subsequent ones would exceed budget
    const count = (result.match(/## file\d+\.ts/g) || []).length;
    expect(count).toBeLessThan(10);
  });

  it('includes the diff content when rawDiff is present and contextMode is "diff"', () => {
    const f = file('src/foo.ts', 'x', { rawDiff: '@@ -1 +1 @@ -old\n+new' });
    const result = buildUserPrompt([f], { contextMode: 'diff' });
    expect(result).toContain('```diff');
    expect(result).toContain('@@ -1 +1 @@');
  });
});
