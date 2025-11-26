import {
  escapeHtml,
  hasValidUrlScheme,
  isClassificationResultArray,
  isPathTraversalSafe,
  isValidGitSha,
  sanitizeFilename,
} from '@/shared/utils/security';

describe('isPathTraversalSafe', () => {
  it('should return false for empty filename', () => {
    expect(isPathTraversalSafe('')).toBe(false);
  });

  it('should return true for safe filename', () => {
    expect(isPathTraversalSafe('test.txt')).toBe(true);
    expect(isPathTraversalSafe('my-file_123.js')).toBe(true);
  });

  it('should return false for filename with path traversal', () => {
    expect(isPathTraversalSafe('../test.txt')).toBe(false);
    expect(isPathTraversalSafe('test..txt')).toBe(false);
    expect(isPathTraversalSafe('..test.txt')).toBe(false);
  });

  it('should return false for filename with forward slash', () => {
    expect(isPathTraversalSafe('path/to/file.txt')).toBe(false);
  });

  it('should return false for filename with backslash', () => {
    expect(isPathTraversalSafe('path\\to\\file.txt')).toBe(false);
  });

  it('should return false for filename with null character', () => {
    expect(isPathTraversalSafe('file\0.txt')).toBe(false);
  });
});

describe('sanitizeFilename', () => {
  it('should return empty string for empty input', () => {
    expect(sanitizeFilename('')).toBe('');
  });

  it('should keep safe characters', () => {
    expect(sanitizeFilename('test-file_123.txt')).toBe('test-file_123.txt');
  });

  it('should replace dangerous characters with underscore', () => {
    expect(sanitizeFilename('test<>file?.txt')).toBe('test__file_.txt');
    expect(sanitizeFilename('test&file|pipe.txt')).toBe('test_file_pipe.txt');
  });

  it('should extract basename from path', () => {
    expect(sanitizeFilename('/path/to/file.txt')).toBe('file.txt');
    expect(sanitizeFilename('../../../etc/passwd')).toBe('passwd');
  });

  it('should handle spaces and special characters', () => {
    expect(sanitizeFilename('my file name.txt')).toBe('my_file_name.txt');
    expect(sanitizeFilename('file@#$%.txt')).toBe('file____.txt');
  });
});

describe('isValidGitSha', () => {
  it('should return false for empty SHA', () => {
    expect(isValidGitSha('')).toBe(false);
  });

  it('should return true for valid SHA-1 (40 chars)', () => {
    expect(isValidGitSha('a'.repeat(40))).toBe(true);
    expect(isValidGitSha('1234567890abcdef1234567890abcdef12345678')).toBe(true);
  });

  it('should return true for valid SHA-256 (64 chars)', () => {
    expect(isValidGitSha('a'.repeat(64))).toBe(true);
    expect(
      isValidGitSha(
        '1234567890abcdef' + '1234567890abcdef' + '1234567890abcdef' + '1234567890abcdef',
      ),
    ).toBe(true);
  });

  it('should return false for SHA with wrong length', () => {
    expect(isValidGitSha('a'.repeat(39))).toBe(false);
    expect(isValidGitSha('a'.repeat(41))).toBe(false);
    expect(isValidGitSha('a'.repeat(63))).toBe(false);
    expect(isValidGitSha('a'.repeat(65))).toBe(false);
  });

  it('should return false for SHA with invalid characters', () => {
    expect(isValidGitSha('g'.repeat(40))).toBe(false); // 'g' is not hex
    expect(isValidGitSha('GHIJ' + 'a'.repeat(36))).toBe(false);
  });

  it('should be case insensitive', () => {
    expect(isValidGitSha('A'.repeat(40))).toBe(true);
    expect(isValidGitSha('ABCDEF1234567890' + 'abcdef1234567890' + '12345678')).toBe(true);
  });
});

describe('hasValidUrlScheme', () => {
  it('should return true for http URLs', () => {
    expect(hasValidUrlScheme('http://example.com')).toBe(true);
    expect(hasValidUrlScheme('http://localhost:3000')).toBe(true);
  });

  it('should return true for https URLs', () => {
    expect(hasValidUrlScheme('https://example.com')).toBe(true);
    expect(hasValidUrlScheme('https://api.example.com/path')).toBe(true);
  });

  it('should return false for javascript URLs', () => {
    expect(hasValidUrlScheme('javascript:alert(1)')).toBe(false);
  });

  it('should return false for data URLs', () => {
    expect(hasValidUrlScheme('data:text/html,<script>alert(1)</script>')).toBe(false);
  });

  it('should return false for file URLs', () => {
    expect(hasValidUrlScheme('file:///etc/passwd')).toBe(false);
  });

  it('should return false for invalid URLs', () => {
    expect(hasValidUrlScheme('not-a-url')).toBe(false);
    expect(hasValidUrlScheme('')).toBe(false);
    expect(hasValidUrlScheme('htp://example.com')).toBe(false);
  });
});

describe('escapeHtml', () => {
  it('should return empty string for empty input', () => {
    expect(escapeHtml('')).toBe('');
  });

  it('should escape ampersand', () => {
    expect(escapeHtml('Tom & Jerry')).toBe('Tom &amp; Jerry');
  });

  it('should escape less than', () => {
    expect(escapeHtml('x < y')).toBe('x &lt; y');
  });

  it('should escape greater than', () => {
    expect(escapeHtml('x > y')).toBe('x &gt; y');
  });

  it('should escape double quotes', () => {
    expect(escapeHtml('Say "hello"')).toBe('Say &quot;hello&quot;');
  });

  it('should escape single quotes', () => {
    expect(escapeHtml("It's mine")).toBe('It&#x27;s mine');
  });

  it('should escape forward slash', () => {
    expect(escapeHtml('path/to/file')).toBe('path&#x2F;to&#x2F;file');
  });

  it('should escape all special characters together', () => {
    expect(escapeHtml('<script>alert("XSS")</script>')).toBe(
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;&#x2F;script&gt;',
    );
  });

  it('should handle text without special characters', () => {
    expect(escapeHtml('plain text')).toBe('plain text');
  });
});

describe('isClassificationResultArray', () => {
  it('should return true for valid classification result array', () => {
    const data = [
      { issueId: 'issue-1', rootCause: 'cause-1', confidence: 0.9 },
      { issueId: 'issue-2', rootCause: 'cause-2', confidence: 0.8 },
    ];

    expect(isClassificationResultArray(data)).toBe(true);
  });

  it('should return true for empty array', () => {
    expect(isClassificationResultArray([])).toBe(true);
  });

  it('should return false for non-array', () => {
    expect(isClassificationResultArray(null)).toBe(false);
    expect(isClassificationResultArray(undefined)).toBe(false);
    expect(isClassificationResultArray('string')).toBe(false);
    expect(isClassificationResultArray(123)).toBe(false);
    expect(isClassificationResultArray({})).toBe(false);
  });

  it('should return false for array with missing issueId', () => {
    const data = [{ rootCause: 'cause-1', confidence: 0.9 }];

    expect(isClassificationResultArray(data)).toBe(false);
  });

  it('should return false for array with missing rootCause', () => {
    const data = [{ issueId: 'issue-1', confidence: 0.9 }];

    expect(isClassificationResultArray(data)).toBe(false);
  });

  it('should return false for array with missing confidence', () => {
    const data = [{ issueId: 'issue-1', rootCause: 'cause-1' }];

    expect(isClassificationResultArray(data)).toBe(false);
  });

  it('should return false for array with wrong types', () => {
    const data = [{ issueId: 123, rootCause: 'cause-1', confidence: 0.9 }];
    expect(isClassificationResultArray(data)).toBe(false);

    const data2 = [{ issueId: 'issue-1', rootCause: null, confidence: 0.9 }];
    expect(isClassificationResultArray(data2)).toBe(false);

    const data3 = [{ issueId: 'issue-1', rootCause: 'cause-1', confidence: 'high' }];
    expect(isClassificationResultArray(data3)).toBe(false);
  });

  it('should return false for array with null/undefined items', () => {
    const data = [null];
    expect(isClassificationResultArray(data)).toBe(false);

    const data2 = [undefined];
    expect(isClassificationResultArray(data2)).toBe(false);
  });

  it('should return false if any item is invalid', () => {
    const data = [
      { issueId: 'issue-1', rootCause: 'cause-1', confidence: 0.9 },
      { issueId: 'issue-2', rootCause: 'cause-2' }, // missing confidence
    ];

    expect(isClassificationResultArray(data)).toBe(false);
  });
});
