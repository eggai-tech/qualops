import { inferPurpose } from '../../../../../../../src/stages/review/agentic/tools/bash/inferred-purpose';

describe('inferPurpose', () => {
  test('grep → search', () => {
    expect(inferPurpose('grep -r pattern /workspace/pr')).toBe('search');
  });

  test('rg → search', () => {
    expect(inferPurpose('rg "TODO" /workspace/pr')).toBe('search');
  });

  test('git → search (git log, git diff etc.)', () => {
    expect(inferPurpose('git log --oneline')).toBe('search');
  });

  test('cat → inspect', () => {
    expect(inferPurpose('cat /workspace/pr/src/index.ts')).toBe('inspect');
  });

  test('ls → inspect', () => {
    expect(inferPurpose('ls /workspace/pr/src')).toBe('inspect');
  });

  test('diff → diff', () => {
    expect(inferPurpose('diff file1 file2')).toBe('diff');
  });

  test('eslint → lint', () => {
    expect(inferPurpose('eslint src/ --format json')).toBe('lint');
  });

  test('tsc → lint', () => {
    expect(inferPurpose('tsc --noEmit')).toBe('lint');
  });

  test('jest → test', () => {
    expect(inferPurpose('jest --testPathPattern=auth')).toBe('test');
  });

  test('pytest → test', () => {
    expect(inferPurpose('pytest tests/auth.py')).toBe('test');
  });

  test('webpack → build', () => {
    expect(inferPurpose('webpack --mode production')).toBe('build');
  });

  test('unknown binary → unknown', () => {
    expect(inferPurpose('my-custom-tool --check')).toBe('unknown');
  });

  test('empty string → unknown', () => {
    expect(inferPurpose('')).toBe('unknown');
  });

  test('binary with path prefix is extracted correctly', () => {
    // inferPurpose extracts the first word and strips path
    expect(inferPurpose('/usr/bin/grep pattern')).toBe('search');
  });
});
