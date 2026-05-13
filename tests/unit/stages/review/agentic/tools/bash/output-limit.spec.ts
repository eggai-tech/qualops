import * as fs from 'fs';

import { stripAnsi } from '../../../../../../../src/stages/review/agentic/tools/bash/ansi-strip';
import { truncateOutput } from '../../../../../../../src/stages/review/agentic/tools/bash/output-limit';

describe('stripAnsi', () => {
  test('strips CSI color sequences', () => {
    expect(stripAnsi('\x1b[31mred\x1b[0m')).toBe('red');
  });

  test('strips multi-param CSI sequences', () => {
    expect(stripAnsi('\x1b[38;5;196mtext\x1b[0m')).toBe('text');
  });

  test('strips multiple ANSI sequences in one string', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[0m and \x1b[32mgreen\x1b[0m')).toBe('bold and green');
  });

  test('preserves plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world');
  });

  test('empty string returns empty string', () => {
    expect(stripAnsi('')).toBe('');
  });
});

describe('truncateOutput', () => {
  test('does not truncate short output', () => {
    const content = 'hello world\n';
    const result = truncateOutput(content, 'review-1', 'call-1', 'stdout');
    expect(result.truncated).toBe(false);
    expect(result.content).toBe(content);
    expect(result.fullPath).toBeUndefined();
  });

  test('truncates output over 1500 lines', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const result = truncateOutput(content, 'review-2', 'call-2', 'stdout');
    expect(result.truncated).toBe(true);
    expect(result.fullPath).toBeDefined();
    // Should contain the truncation notice
    expect(result.content).toContain('[qualops/output-limit]');
    // Should keep the tail (last lines)
    expect(result.content).toContain('line 2000');
    // Should not keep the very beginning
    expect(result.content).not.toContain('line 1\n');
  });

  test('truncates output over 64 KiB', () => {
    // Create content just over 64 KiB
    const line = 'x'.repeat(100) + '\n'; // ~101 bytes per line
    const lineCount = 700; // 700 * 101 = ~70.7 KiB
    const content = line.repeat(lineCount);
    const result = truncateOutput(content, 'review-3', 'call-3', 'stderr');
    expect(result.truncated).toBe(true);
  });

  test('spilled file contains full original content', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const result = truncateOutput(content, 'review-4', 'call-4', 'stdout');

    if (result.fullPath && fs.existsSync(result.fullPath)) {
      const spilled = fs.readFileSync(result.fullPath, 'utf8');
      expect(spilled).toBe(content);
    }
  });

  test('truncation notice includes line counts', () => {
    const lines = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const result = truncateOutput(content, 'review-5', 'call-5', 'stdout');
    expect(result.content).toContain('2000');
  });
});
