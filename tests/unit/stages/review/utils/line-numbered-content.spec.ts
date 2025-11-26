import {
  addLineNumbers,
  extractLineNumber,
  findCodePatternLine,
  getLineRange,
  removeLineNumbers,
} from '@/stages/review/utils/line-numbered-content';

describe('addLineNumbers', () => {
  it('should add line numbers to single line', () => {
    const content = 'Hello World';
    const result = addLineNumbers(content);

    expect(result).toBe('    1 | Hello World');
  });

  it('should add line numbers to multiple lines', () => {
    const content = 'line one\nline two\nline three';
    const result = addLineNumbers(content);

    expect(result).toBe('    1 | line one\n    2 | line two\n    3 | line three');
  });

  it('should handle empty string', () => {
    const result = addLineNumbers('');

    expect(result).toBe('    1 | ');
  });

  it('should handle file with empty lines', () => {
    const content = 'first\n\nthird';
    const result = addLineNumbers(content);

    expect(result).toBe('    1 | first\n    2 | \n    3 | third');
  });

  it('should pad line numbers correctly for files over 100 lines', () => {
    const lines = Array.from({ length: 105 }, (_, i) => `line ${i + 1}`);
    const content = lines.join('\n');
    const result = addLineNumbers(content);
    const resultLines = result.split('\n');

    expect(resultLines[0]).toBe('    1 | line 1');
    expect(resultLines[99]).toBe('  100 | line 100');
    expect(resultLines[104]).toBe('  105 | line 105');
  });

  it('should handle content with special characters', () => {
    const content = 'hello\t\tworld\n"quoted"\n\'single\'';
    const result = addLineNumbers(content);

    expect(result).toContain('    1 | hello\t\tworld');
    expect(result).toContain('    2 | "quoted"');
    expect(result).toContain("    3 | 'single'");
  });

  it('should handle unicode characters', () => {
    const content = '你好世界\n🚀 rocket\ncafé';
    const result = addLineNumbers(content);

    expect(result).toContain('    1 | 你好世界');
    expect(result).toContain('    2 | 🚀 rocket');
    expect(result).toContain('    3 | café');
  });

  it('should handle very long lines', () => {
    const longLine = 'x'.repeat(10000);
    const result = addLineNumbers(longLine);

    expect(result).toBe(`    1 | ${longLine}`);
  });

  it('should handle content with only newlines', () => {
    const content = '\n\n\n';
    const result = addLineNumbers(content);

    expect(result).toBe('    1 | \n    2 | \n    3 | \n    4 | ');
  });
});

describe('extractLineNumber', () => {
  it('should extract line number from simple format', () => {
    const result = extractLineNumber('line 42');

    expect(result).toBe(42);
  });

  it('should extract line number from lines format', () => {
    const result = extractLineNumber('lines 123');

    expect(result).toBe(123);
  });

  it('should extract line number from number only', () => {
    const result = extractLineNumber('456');

    expect(result).toBe(456);
  });

  it('should extract line number case insensitively', () => {
    expect(extractLineNumber('Line 10')).toBe(10);
    expect(extractLineNumber('LINE 20')).toBe(20);
    expect(extractLineNumber('LINES 30')).toBe(30);
  });

  it('should return null for no number', () => {
    const result = extractLineNumber('no line number here');

    expect(result).toBeNull();
  });

  it('should extract first number when multiple present', () => {
    const result = extractLineNumber('line 10 and 20');

    expect(result).toBe(10);
  });

  it('should handle line ranges by extracting first number', () => {
    const result = extractLineNumber('lines 10-20');

    expect(result).toBe(10);
  });

  it('should handle location with file path', () => {
    const result = extractLineNumber('src/file.ts:42');

    expect(result).toBe(42);
  });

  it('should return null for empty string', () => {
    const result = extractLineNumber('');

    expect(result).toBeNull();
  });

  it('should extract number with extra whitespace', () => {
    const result = extractLineNumber('  line   99  ');

    expect(result).toBe(99);
  });
});

describe('removeLineNumbers', () => {
  it('should remove line numbers from numbered content', () => {
    const numbered = '    1 | Hello World\n    2 | Second line';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('Hello World\nSecond line');
  });

  it('should handle content without line numbers', () => {
    const content = 'Hello World\nSecond line';
    const result = removeLineNumbers(content);

    expect(result).toBe('Hello World\nSecond line');
  });

  it('should preserve empty lines', () => {
    const numbered = '    1 | first\n    2 | \n    3 | third';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('first\n\nthird');
  });

  it('should handle different spacing in line numbers', () => {
    const numbered = '  1 | line1\n 10 | line10\n100 | line100';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('line1\nline10\nline100');
  });

  it('should preserve content after pipe symbol', () => {
    const numbered = '    1 | code with | pipe symbol';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('code with | pipe symbol');
  });

  it('should handle single line', () => {
    const numbered = '    1 | single line';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('single line');
  });

  it('should preserve leading spaces in content after line number', () => {
    const numbered = '    1 |   indented code\n    2 |     more indent';
    const result = removeLineNumbers(numbered);

    expect(result).toBe('  indented code\n    more indent');
  });

  it('should handle empty string', () => {
    const result = removeLineNumbers('');

    expect(result).toBe('');
  });

  it('should be inverse of addLineNumbers', () => {
    const original = 'line one\nline two\nline three';
    const numbered = addLineNumbers(original);
    const restored = removeLineNumbers(numbered);

    expect(restored).toBe(original);
  });
});

describe('getLineRange', () => {
  const numberedContent =
    '    1 | first\n    2 | second\n    3 | third\n    4 | fourth\n    5 | fifth';

  it('should extract line range', () => {
    const result = getLineRange(numberedContent, 2, 4);

    expect(result).toBe('    2 | second\n    3 | third\n    4 | fourth');
  });

  it('should extract single line', () => {
    const result = getLineRange(numberedContent, 3, 3);

    expect(result).toBe('    3 | third');
  });

  it('should extract from beginning', () => {
    const result = getLineRange(numberedContent, 1, 2);

    expect(result).toBe('    1 | first\n    2 | second');
  });

  it('should extract to end', () => {
    const result = getLineRange(numberedContent, 4, 5);

    expect(result).toBe('    4 | fourth\n    5 | fifth');
  });

  it('should handle range beyond content length', () => {
    const result = getLineRange(numberedContent, 4, 100);

    expect(result).toBe('    4 | fourth\n    5 | fifth');
  });

  it('should handle start line before 1', () => {
    const result = getLineRange(numberedContent, 0, 2);

    expect(result).toBe('    1 | first\n    2 | second');
  });

  it('should handle negative start line', () => {
    const result = getLineRange(numberedContent, -5, 2);

    expect(result).toBe('    1 | first\n    2 | second');
  });

  it('should return empty for invalid range', () => {
    const result = getLineRange(numberedContent, 10, 12);

    expect(result).toBe('');
  });

  it('should handle entire file range', () => {
    const result = getLineRange(numberedContent, 1, 5);

    expect(result).toBe(numberedContent);
  });

  it('should handle range with endLine less than startLine', () => {
    const result = getLineRange(numberedContent, 4, 2);

    expect(result).toBe('');
  });
});

describe('findCodePatternLine', () => {
  const content = 'function hello() {\n  console.log("world");\n  return true;\n}';

  it('should find exact pattern match', () => {
    const result = findCodePatternLine(content, 'console.log("world");');

    expect(result).toBe(2);
  });

  it('should find pattern with different whitespace', () => {
    const result = findCodePatternLine(content, 'console.log("world")');

    expect(result).toBe(2);
  });

  it('should find pattern on first line', () => {
    const result = findCodePatternLine(content, 'function hello()');

    expect(result).toBe(1);
  });

  it('should find pattern on last line', () => {
    const result = findCodePatternLine(content, '}');

    expect(result).toBe(4);
  });

  it('should return null when pattern not found', () => {
    const result = findCodePatternLine(content, 'not in file');

    expect(result).toBeNull();
  });

  it('should handle pattern with leading/trailing whitespace', () => {
    const result = findCodePatternLine(content, '  return true;  ');

    expect(result).toBe(3);
  });

  it('should find partial line match', () => {
    const result = findCodePatternLine(content, 'console.log');

    expect(result).toBe(2);
  });

  it('should handle pattern with special characters', () => {
    const specialContent = 'const regex = /\\d+/;\nconst str = "test";';
    const result = findCodePatternLine(specialContent, 'const regex = /\\d+/;');

    expect(result).toBe(1);
  });

  it('should find pattern with normalized whitespace', () => {
    const multiSpaceContent = 'const  x  =  10;\nconst   y   =   20;';
    const result = findCodePatternLine(multiSpaceContent, 'const y = 20');

    expect(result).toBe(2);
  });

  it('should return null for empty content', () => {
    const result = findCodePatternLine('', 'pattern');

    expect(result).toBeNull();
  });

  it('should handle multi-line patterns by finding first occurrence', () => {
    const result = findCodePatternLine(content, 'function');

    expect(result).toBe(1);
  });

  it('should be case sensitive', () => {
    const result = findCodePatternLine(content, 'FUNCTION hello()');

    expect(result).toBeNull();
  });

  it('should find pattern with tabs', () => {
    const tabContent = 'function test() {\n\tconsole.log("tab");\n}';
    const result = findCodePatternLine(tabContent, 'console.log("tab")');

    expect(result).toBe(2);
  });

  it('should handle unicode in pattern', () => {
    const unicodeContent = 'const message = "你好";\nconst greeting = "Hello";';
    const result = findCodePatternLine(unicodeContent, 'const message = "你好"');

    expect(result).toBe(1);
  });
});
