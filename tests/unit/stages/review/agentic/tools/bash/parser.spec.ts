import {
  toAnalysisCopy,
  splitOnOperators,
  parseLogicalCommand,
  tokenise,
} from '../../../../../../../src/stages/review/agentic/tools/bash/parser';

describe('toAnalysisCopy', () => {
  test('replaces single-quoted content with placeholder', () => {
    const result = toAnalysisCopy("echo 'hello world'");
    expect(result).toContain("'__SQ__'");
    expect(result).not.toContain('hello world');
  });

  test('replaces double-quoted content with placeholder', () => {
    const result = toAnalysisCopy('echo "hello $USER"');
    expect(result).toContain('"__DQ__"');
    expect(result).not.toContain('$USER');
  });

  test('operators inside single quotes are not treated as structural', () => {
    const result = toAnalysisCopy("echo 'a && b'");
    // The && inside the single-quoted string should be hidden
    expect(result).not.toContain('a && b');
  });

  test('adjacent quoted strings are all stripped', () => {
    const result = toAnalysisCopy("'a' 'b' 'c'");
    expect(result).not.toContain('a');
    expect(result).not.toContain('b');
    expect(result).not.toContain('c');
  });

  test('preserves unquoted text', () => {
    const result = toAnalysisCopy('git log --oneline');
    expect(result).toContain('git');
    expect(result).toContain('log');
    expect(result).toContain('--oneline');
  });

  test('empty string returns empty string', () => {
    expect(toAnalysisCopy('')).toBe('');
  });

  test('string with no quotes is returned unchanged', () => {
    const cmd = 'rg pattern /workspace/pr';
    expect(toAnalysisCopy(cmd)).toBe(cmd);
  });
});

describe('splitOnOperators', () => {
  test('splits on semicolon', () => {
    const parts = splitOnOperators('cmd1; cmd2');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('cmd1');
    expect(parts[1]).toBe('cmd2');
  });

  test('splits on &&', () => {
    const parts = splitOnOperators('cmd1 && cmd2');
    expect(parts).toHaveLength(2);
    expect(parts[0]).toBe('cmd1');
    expect(parts[1]).toBe('cmd2');
  });

  test('splits on ||', () => {
    const parts = splitOnOperators('cmd1 || cmd2');
    expect(parts).toHaveLength(2);
  });

  test('splits on pipe', () => {
    const parts = splitOnOperators('git log | head -10');
    expect(parts).toHaveLength(2);
  });

  test('does NOT split on operators inside single quotes', () => {
    const parts = splitOnOperators("echo 'a && b'");
    expect(parts).toHaveLength(1);
  });

  test('filters empty segments', () => {
    const parts = splitOnOperators('cmd1;;cmd2');
    // multiple semicolons may produce empty segment between them — filtered out
    expect(parts.every((p) => p.trim() !== '')).toBe(true);
  });

  test('single command returns single element array', () => {
    const parts = splitOnOperators('git log --oneline');
    expect(parts).toHaveLength(1);
    expect(parts[0]).toBe('git log --oneline');
  });

  test('empty input returns empty array', () => {
    expect(splitOnOperators('')).toHaveLength(0);
  });
});

describe('parseLogicalCommand', () => {
  test('extracts binary as first word', () => {
    const cmd = parseLogicalCommand('git log --oneline');
    expect(cmd.binary).toBe('git');
  });

  test('extracts args correctly', () => {
    const cmd = parseLogicalCommand('git log --oneline -10');
    expect(cmd.args).toContain('log');
    expect(cmd.args).toContain('--oneline');
    expect(cmd.args).toContain('-10');
  });

  test('strips leading env var assignments', () => {
    const cmd = parseLogicalCommand('FOO=bar BAZ=qux pytest tests/');
    expect(cmd.binary).toBe('pytest');
    expect(cmd.args).toContain('tests/');
  });

  test('detects trailing background &', () => {
    const cmd = parseLogicalCommand('sleep 10 &');
    expect(cmd.hasBackground).toBe(true);
  });

  test('no background for normal command', () => {
    const cmd = parseLogicalCommand('git log');
    expect(cmd.hasBackground).toBe(false);
  });

  test('detects output redirection', () => {
    const cmd = parseLogicalCommand('cat file > /tmp/out');
    expect(cmd.hasRedirection).toBe(true);
  });

  test('detects variable expansion', () => {
    const cmd = parseLogicalCommand('echo $HOME');
    expect(cmd.hasExpansion).toBe(true);
  });

  test('detects subshell expansion', () => {
    const cmd = parseLogicalCommand('echo $(pwd)');
    expect(cmd.hasExpansion).toBe(true);
  });

  test('no expansion for plain command', () => {
    const cmd = parseLogicalCommand('rg pattern /workspace/pr');
    expect(cmd.hasExpansion).toBe(false);
  });
});

describe('tokenise', () => {
  test('returns empty commands for empty input', () => {
    const result = tokenise('');
    expect(result.commands).toHaveLength(0);
    expect(result.parseError).toBe(false);
  });

  test('returns parseError for unmatched single quote', () => {
    const result = tokenise("echo 'unterminated");
    expect(result.parseError).toBe(true);
    expect(result.commands).toHaveLength(0);
  });

  test('parses a simple command', () => {
    const result = tokenise('git log --oneline');
    expect(result.parseError).toBe(false);
    expect(result.commands).toHaveLength(1);
    expect(result.commands[0]?.binary).toBe('git');
  });

  test('parses a pipeline into multiple commands', () => {
    const result = tokenise('git log | head -10');
    expect(result.parseError).toBe(false);
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]?.binary).toBe('git');
    expect(result.commands[1]?.binary).toBe('head');
  });

  test('parses a && chain', () => {
    const result = tokenise('cd src && rg foo');
    expect(result.commands).toHaveLength(2);
    expect(result.commands[0]?.binary).toBe('cd');
    expect(result.commands[1]?.binary).toBe('rg');
  });

  test('raw property is preserved on each command', () => {
    const result = tokenise('git log');
    expect(result.commands[0]?.raw).toBe('git log');
  });
});
