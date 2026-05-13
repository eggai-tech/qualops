import { redactOutput } from '../../../../../../../src/stages/review/agentic/tools/bash/secret-redact';

describe('redactOutput', () => {
  test('redacts sk-ant- Anthropic keys', () => {
    const result = redactOutput('key=sk-ant-api03-abcdefghijklmnop1234567890');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('sk-ant-');
  });

  test('redacts GitHub PAT (ghp_)', () => {
    const result = redactOutput('export GH_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz12');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('ghp_');
  });

  test('redacts AWS access key', () => {
    const result = redactOutput('AWS_KEY=AKIAIOSFODNN7EXAMPLE');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('AKIAIOSFODNN7EXAMPLE');
  });

  test('redacts Slack bot tokens', () => {
    // Constructed at runtime so no literal token pattern triggers secret scanners
    const fakeSlackToken = [
      'xoxb',
      '12345678901',
      '1234567890123',
      'abcdefghijklmnopqrstuvwx',
    ].join('-');
    const result = redactOutput(`token=${fakeSlackToken}`);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('xoxb-');
  });

  test('redacts Bearer tokens', () => {
    const result = redactOutput('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  test('redacts npm tokens', () => {
    const result = redactOutput('NPM_TOKEN=npm_abcdefghijklmnopqrstuvwxyz1234567890');
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('npm_abcdef');
  });

  test('redacts known tokens passed explicitly', () => {
    const result = redactOutput('my-very-secret-token-value appears in output', [
      'my-very-secret-token-value',
    ]);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('my-very-secret-token-value');
  });

  test('does not redact benign text', () => {
    const result = redactOutput('No matches found in /workspace/pr/src');
    expect(result).toBe('No matches found in /workspace/pr/src');
  });

  test('returns empty string unchanged', () => {
    expect(redactOutput('')).toBe('');
  });

  test('short known tokens (< 8 chars) are not redacted to avoid false positives', () => {
    const result = redactOutput('test123 is a common word', ['test123']);
    // short token — should not be redacted
    expect(result).toContain('test123');
  });
});
