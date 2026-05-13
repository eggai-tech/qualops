import {
  getSemanticHint,
  getSemanticHintCode,
} from '../../../../../../../src/stages/review/agentic/tools/bash/exit-semantics';

describe('getSemanticHint', () => {
  test('grep exit 1 → no matches message', () => {
    expect(getSemanticHint('grep', 1)).toContain('No matches');
  });

  test('grep exit 0 → matches found message', () => {
    expect(getSemanticHint('grep', 0)).toContain('match');
  });

  test('rg exit 1 → no matches message', () => {
    expect(getSemanticHint('rg', 1)).toContain('No matches');
  });

  test('diff exit 1 → differences found message', () => {
    const hint = getSemanticHint('diff', 1);
    expect(hint).toBeDefined();
    expect(hint).toContain('Differences');
  });

  test('diff exit 0 → identical files message', () => {
    expect(getSemanticHint('diff', 0)).toContain('identical');
  });

  test('git exit 128 → fatal error message', () => {
    const hint = getSemanticHint('git', 128);
    expect(hint).toBeDefined();
    expect(hint!.toLowerCase()).toMatch(/fatal|error/);
  });

  test('basename stripping: /usr/bin/grep exit 1 → same as grep', () => {
    expect(getSemanticHint('/usr/bin/grep', 1)).toBe(getSemanticHint('grep', 1));
  });

  test('unknown binary returns undefined', () => {
    expect(getSemanticHint('unknown-tool-xyz', 0)).toBeUndefined();
  });

  test('unknown exit code for known binary returns undefined', () => {
    expect(getSemanticHint('grep', 99)).toBeUndefined();
  });

  test('jest exit 0 → all tests passed', () => {
    const hint = getSemanticHint('jest', 0);
    expect(hint).toContain('passed');
  });

  test('tsc exit 0 → compilation succeeded', () => {
    const hint = getSemanticHint('tsc', 0);
    expect(hint).toBeDefined();
  });
});

describe('getSemanticHintCode', () => {
  test('grep exit 1 → no_matches_found', () => {
    expect(getSemanticHintCode('grep', 1)).toBe('no_matches_found');
  });

  test('diff exit 1 → differences_found', () => {
    expect(getSemanticHintCode('diff', 1)).toBe('differences_found');
  });

  test('diff exit 0 → no_differences', () => {
    expect(getSemanticHintCode('diff', 0)).toBe('no_differences');
  });

  test('grep exit 0 → success', () => {
    expect(getSemanticHintCode('grep', 0)).toBe('success');
  });

  test('unknown → undefined', () => {
    expect(getSemanticHintCode('unknowntool', 0)).toBeUndefined();
  });
});
