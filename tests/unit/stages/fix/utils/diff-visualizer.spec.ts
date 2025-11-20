import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FixSuggestion } from '@/shared/types';
import { generateDiffHTML, generateUnifiedDiff } from '@/stages/fix/utils/diff-visualizer';

jest.mock('node:fs');
jest.mock('node:fs/promises');
jest.mock('node:child_process');
jest.mock('node:os');
jest.mock('node:path');
jest.mock('@/shared/utils/file-utils');
jest.mock('@/shared/utils/logger');

const mockMkdtempSync = mkdtempSync as jest.MockedFunction<typeof mkdtempSync>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockSpawnSync = spawnSync as jest.MockedFunction<typeof spawnSync>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockUnlinkSync = unlinkSync as jest.MockedFunction<typeof unlinkSync>;
const mockRmSync = rmSync as jest.MockedFunction<typeof rmSync>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockTmpdir = tmpdir as jest.MockedFunction<typeof tmpdir>;
const mockJoin = join as jest.MockedFunction<typeof join>;

describe('generateUnifiedDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTmpdir.mockReturnValue('/tmp');
    mockJoin.mockImplementation((...args) => args.join('/'));
    mockMkdtempSync.mockReturnValue('/tmp/qualops-test');
    mockWriteFileSync.mockImplementation(() => undefined);
    mockExistsSync.mockReturnValue(true);
    mockUnlinkSync.mockImplementation(() => undefined);
    mockRmSync.mockImplementation(() => undefined);
  });

  it('should generate unified diff using git diff', () => {
    const original = 'const x = 1;';
    const modified = 'const x = 2;';
    const expectedDiff = '@@ -1 +1 @@\n-const x = 1;\n+const x = 2;';

    mockSpawnSync.mockReturnValue({
      stdout: expectedDiff,
      stderr: '',
      status: 1,
      signal: null,
      output: [Buffer.from(''), Buffer.from(expectedDiff), Buffer.from('')],
      pid: 1234,
    });

    const result = generateUnifiedDiff(original, modified);

    expect(result).toBe(expectedDiff);
    expect(mockMkdtempSync).toHaveBeenCalled();
    expect(mockWriteFileSync).toHaveBeenCalledTimes(2);
    expect(mockSpawnSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining(['diff', '--no-index', '--no-color', '-U5']),
      expect.any(Object),
    );
  });

  it('should write original and modified files to temp directory', () => {
    const original = 'original content';
    const modified = 'modified content';

    mockSpawnSync.mockReturnValue({
      stdout: 'diff output',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('diff output'), null],
      pid: 1234,
    });

    generateUnifiedDiff(original, modified);

    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/qualops-test/original.ts', original);
    expect(mockWriteFileSync).toHaveBeenCalledWith('/tmp/qualops-test/modified.ts', modified);
  });

  it('should clean up temporary files after diff generation', () => {
    mockSpawnSync.mockReturnValue({
      stdout: 'diff',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('diff'), null],
      pid: 1234,
    });

    generateUnifiedDiff('a', 'b');

    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/qualops-test/original.ts');
    expect(mockUnlinkSync).toHaveBeenCalledWith('/tmp/qualops-test/modified.ts');
    expect(mockRmSync).toHaveBeenCalledWith('/tmp/qualops-test', { recursive: true, force: true });
  });

  it('should handle cleanup errors gracefully', () => {
    mockSpawnSync.mockReturnValue({
      stdout: 'diff',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('diff'), null],
      pid: 1234,
    });
    mockUnlinkSync.mockImplementation(() => {
      throw new Error('Cleanup failed');
    });

    const result = generateUnifiedDiff('a', 'b');

    expect(result).toBe('diff');
  });

  it('should fallback to simple text diff on git error', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = generateUnifiedDiff('line1\nline2', 'line1\nline3');

    expect(result).toContain(' line1');
    expect(result).toContain('-line2');
    expect(result).toContain('+line3');
  });

  it('should fallback to simple text diff when git returns no stdout', () => {
    mockSpawnSync.mockImplementation(() => {
      throw new Error('git not found');
    });

    const result = generateUnifiedDiff('a', 'b');

    expect(result).toContain('-a');
    expect(result).toContain('+b');
  });

  it('should use error stdout if available', () => {
    const errorWithStdout = { stdout: 'error diff output' };
    mockSpawnSync.mockImplementation(() => {
      throw errorWithStdout;
    });

    const result = generateUnifiedDiff('a', 'b');

    expect(result).toBe('error diff output');
  });

  it('should handle identical content', () => {
    const content = 'const x = 1;';

    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      output: [null, Buffer.from(''), null],
      pid: 1234,
    });

    const result = generateUnifiedDiff(content, content);

    expect(result).toBe('');
  });

  it('should handle empty strings', () => {
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      output: [null, Buffer.from(''), null],
      pid: 1234,
    });

    const result = generateUnifiedDiff('', '');

    expect(result).toBe('');
  });

  it('should handle multiline content', () => {
    const original = 'line1\nline2\nline3';
    const modified = 'line1\nchanged\nline3';

    mockSpawnSync.mockReturnValue({
      stdout: 'diff output',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('diff output'), null],
      pid: 1234,
    });

    const result = generateUnifiedDiff(original, modified);

    expect(result).toBe('diff output');
  });

  it('should handle content with special characters', () => {
    const original = 'const str = "hello\\nworld";';
    const modified = 'const str = "goodbye\\nworld";';

    mockSpawnSync.mockReturnValue({
      stdout: 'diff',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('diff'), null],
      pid: 1234,
    });

    generateUnifiedDiff(original, modified);

    expect(mockWriteFileSync).toHaveBeenCalledWith(expect.any(String), original);
    expect(mockWriteFileSync).toHaveBeenCalledWith(expect.any(String), modified);
  });
});

describe('generateUnifiedDiff - simple text diff fallback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTmpdir.mockReturnValue('/tmp');
    mockJoin.mockImplementation((...args) => args.join('/'));
    mockMkdtempSync.mockReturnValue('/tmp/qualops-test');
    mockSpawnSync.mockImplementation(() => {
      throw new Error('git not available');
    });
  });

  it('should handle context lines in simple diff', () => {
    const result = generateUnifiedDiff('same\nsame\nsame', 'same\nsame\nsame');

    expect(result).toContain(' same');
  });

  it('should handle only additions in simple diff', () => {
    const result = generateUnifiedDiff('', 'line1\nline2');

    expect(result).toContain('+line1');
    expect(result).toContain('+line2');
  });

  it('should handle only deletions in simple diff', () => {
    const result = generateUnifiedDiff('line1\nline2', '');

    expect(result).toContain('-line1');
    expect(result).toContain('-line2');
  });

  it('should handle mixed changes in simple diff', () => {
    const result = generateUnifiedDiff('old\nsame\nremove', 'new\nsame\nadd');

    expect(result).toContain('-old');
    expect(result).toContain('+new');
    expect(result).toContain(' same');
    expect(result).toContain('-remove');
    expect(result).toContain('+add');
  });

  it('should handle empty lines in simple diff', () => {
    const result = generateUnifiedDiff('line1\n\nline3', 'line1\n\nline3');

    expect(result).toContain(' line1');
    expect(result).toContain(' ');
    expect(result).toContain(' line3');
  });
});

describe('generateDiffHTML', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    mockTmpdir.mockReturnValue('/tmp');
    mockJoin.mockImplementation((...args) => args.join('/'));
    mockMkdtempSync.mockReturnValue('/tmp/qualops-test');
    mockSpawnSync.mockReturnValue({
      stdout: '',
      stderr: '',
      status: 0,
      signal: null,
      output: [null, Buffer.from(''), null],
      pid: 1234,
    });
  });

  it('should generate HTML with no fixes', async () => {
    await generateDiffHTML([], '/output/report.html');

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/output/report.html',
      expect.stringContaining('No fixes generated'),
      'utf-8',
    );
  });

  it('should generate HTML with single fix', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-1',
        file: 'test.ts',
        line: 10,
        originalCode: 'const x = 1;',
        suggestedCode: 'const x = 2;',
        explanation: 'Update value',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    expect(mockWriteFile).toHaveBeenCalled();
    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('test.ts');
    expect(html).toContain('Line 10');
    expect(html).toContain('high confidence');
    expect(html).toContain('Update value');
  });

  it('should include summary statistics', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-1',
        file: 'test1.ts',
        line: 10,
        originalCode: 'a',
        suggestedCode: 'b',
        explanation: '',
        confidence: 'high',
        breaking: true,
        applied: true,
      },
      {
        issueId: 'test-2',
        file: 'test2.ts',
        line: 20,
        originalCode: 'c',
        suggestedCode: 'd',
        explanation: '',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('Total Fixes:</strong> 2');
    expect(html).toContain('High Confidence:</strong> 2');
    expect(html).toContain('Breaking Changes:</strong> 1');
    expect(html).toContain('Applied:</strong> 1');
  });

  it('should display confidence levels with colors', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-high',
        file: 'high.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: '',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
      {
        issueId: 'test-medium',
        file: 'medium.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: '',
        confidence: 'medium',
        breaking: false,
        applied: false,
      },
      {
        issueId: 'test-low',
        file: 'low.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: '',
        confidence: 'low',
        breaking: false,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('confidence-high');
    expect(html).toContain('confidence-medium');
    expect(html).toContain('confidence-low');
  });

  it('should mark breaking changes', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-breaking',
        file: 'test.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: '',
        confidence: 'high',
        breaking: true,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('Breaking Change');
    expect(html).toContain('class="breaking"');
  });

  it('should mark applied fixes', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-applied',
        file: 'test.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: '',
        confidence: 'high',
        breaking: false,
        applied: true,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('Applied');
  });

  it('should include explanations when present', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-expl',
        file: 'test.ts',
        line: 1,
        originalCode: '',
        suggestedCode: '',
        explanation: 'This is a detailed explanation',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('This is a detailed explanation');
    expect(html).toContain('fix-explanation');
  });

  it('should escape HTML in content', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-xss',
        file: 'test.ts',
        line: 1,
        originalCode: '<script>alert("xss")</script>',
        suggestedCode: '<div>safe</div>',
        explanation: 'Fix <script> tag',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
    ];

    mockSpawnSync.mockReturnValue({
      stdout: '+<script>alert("xss")</script>',
      stderr: '',
      status: 1,
      signal: null,
      output: [null, Buffer.from('+<script>alert("xss")</script>'), null],
      pid: 1234,
    });

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('&lt;');
    expect(html).toContain('&gt;');
  });

  it('should handle write errors', async () => {
    mockWriteFile.mockRejectedValue(new Error('Write failed'));

    await expect(generateDiffHTML([], '/output/report.html')).rejects.toThrow('Write failed');
  });

  it('should include CSS styles', async () => {
    await generateDiffHTML([], '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('<style>');
    expect(html).toContain('.diff-add');
    expect(html).toContain('.diff-remove');
    expect(html).toContain('.diff-context');
  });

  it('should include proper HTML structure', async () => {
    await generateDiffHTML([], '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('<!DOCTYPE html>');
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('</html>');
    expect(html).toContain('<head>');
    expect(html).toContain('</head>');
    expect(html).toContain('<body>');
    expect(html).toContain('</body>');
  });

  it('should include title', async () => {
    await generateDiffHTML([], '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('<title>QualOps Fix Diff Report</title>');
    expect(html).toContain('<h1>QualOps Fix Diff Report</h1>');
  });

  it('should handle fixes without explanation', async () => {
    const fixes: FixSuggestion[] = [
      {
        issueId: 'test-noexpl',
        file: 'test.ts',
        line: 1,
        originalCode: 'a',
        suggestedCode: 'b',
        explanation: '',
        confidence: 'high',
        breaking: false,
        applied: false,
      },
    ];

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('test.ts');
  });

  it('should handle multiple fixes', async () => {
    const fixes: FixSuggestion[] = Array(10)
      .fill(null)
      .map((_, i) => ({
        issueId: `test-${i}`,
        file: `test${i}.ts`,
        line: i,
        originalCode: `code${i}`,
        suggestedCode: `fixed${i}`,
        explanation: `fix ${i}`,
        confidence: 'high' as const,
        breaking: false,
        applied: false,
      }));

    await generateDiffHTML(fixes, '/output/report.html');

    const html = mockWriteFile.mock.calls[0][1] as string;
    expect(html).toContain('test0.ts');
    expect(html).toContain('test9.ts');
    expect(html).toContain('Total Fixes:</strong> 10');
  });
});
