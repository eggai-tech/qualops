import {
  type ContextLocation,
  extractCodeAroundContext,
  extractKeywords,
  findContextInFile,
  smartContextSearch,
} from '@/stages/fix/utils/code-locator';

jest.mock('@/shared/utils/logger');

describe('findContextInFile', () => {
  it('should find exact match context', () => {
    const fileContent = 'const x = 1;\nconst y = 2;\nconst z = 3;';
    const context = 'const y = 2;';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('exact');
    expect(result?.startLine).toBe(1);
    expect(result?.endLine).toBe(1);
  });

  it('should return correct indices for exact match', () => {
    const fileContent = 'hello world\ntest line\ngoodbye';
    const context = 'test line';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.startIndex).toBe(12);
    expect(result?.endIndex).toBe(21);
  });

  it('should find normalized whitespace match', () => {
    const fileContent = 'const  x  =  1;';
    const context = 'const x = 1;';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('pattern');
  });

  it('should find function pattern', () => {
    const fileContent = 'function testFunction() {\n  return 1;\n}';
    const context = 'testFunction';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should find class pattern', () => {
    const fileContent = 'class MyClass {\n  constructor() {}\n}';
    const context = 'MyClass';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should find variable pattern with const', () => {
    const fileContent = 'const myVariable = 123;';
    const context = 'myVariable';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should find variable pattern with let', () => {
    const fileContent = 'let myVariable = 123;';
    const context = 'myVariable';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should find variable pattern with var', () => {
    const fileContent = 'var myVariable = 123;';
    const context = 'myVariable';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should return null for non-existent context', () => {
    const fileContent = 'const x = 1;';
    const context = 'nonexistent';

    const result = findContextInFile(fileContent, context);

    expect(result).toBeNull();
  });

  it('should handle empty file content', () => {
    const result = findContextInFile('', 'context');

    expect(result).toBeNull();
  });

  it('should handle empty context', () => {
    const result = findContextInFile('content', '');

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('exact');
  });

  it('should calculate correct line numbers for multiline context', () => {
    const fileContent = 'line1\nline2\nline3\nline4';
    const context = 'line2\nline3';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.startLine).toBe(1);
    expect(result?.endLine).toBe(2);
  });

  it('should handle context at start of file', () => {
    const fileContent = 'start\nmiddle\nend';
    const context = 'start';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.startLine).toBe(0);
  });

  it('should handle context at end of file', () => {
    const fileContent = 'start\nmiddle\nend';
    const context = 'end';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.endLine).toBe(2);
  });

  it('should handle special regex characters in context', () => {
    const fileContent = 'test (value)';
    const context = '(value)';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('exact');
  });

  it('should prefer exact match over pattern match', () => {
    const fileContent = 'const test = 1;\ntest()';
    const context = 'test';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('exact');
  });

  it('should handle normalized match with tabs', () => {
    const fileContent = 'const\tx\t=\t1;';
    const context = 'const x = 1;';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('pattern');
  });

  it('should handle normalized match with newlines', () => {
    const fileContent = 'const\nx\n=\n1;';
    const context = 'const x = 1;';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('pattern');
  });

  it('should handle class with type parameters', () => {
    const fileContent = 'class MyClass<T> { }';
    const context = 'MyClass';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });

  it('should handle TypeScript type annotations', () => {
    const fileContent = 'const myVar: number = 123;';
    const context = 'myVar';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(['exact', 'pattern']).toContain(result?.confidence);
  });
});

describe('extractCodeAroundContext', () => {
  it('should extract code with default context', () => {
    const fileContent = Array(30)
      .fill(0)
      .map((_, i) => `line${i}`)
      .join('\n');
    const location: ContextLocation = {
      startIndex: 50,
      endIndex: 60,
      startLine: 10,
      endLine: 10,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location);

    const lines = result.split('\n');
    expect(lines.length).toBeGreaterThan(15);
    expect(lines[0]).toBe('line0');
  });

  it('should extract code with custom lines before', () => {
    const fileContent = 'line0\nline1\nline2\nline3\nline4';
    const location: ContextLocation = {
      startIndex: 12,
      endIndex: 17,
      startLine: 2,
      endLine: 2,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 1, 1);

    expect(result).toBe('line1\nline2\nline3');
  });

  it('should extract code with custom lines after', () => {
    const fileContent = 'line0\nline1\nline2\nline3\nline4';
    const location: ContextLocation = {
      startIndex: 6,
      endIndex: 11,
      startLine: 1,
      endLine: 1,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 0, 2);

    expect(result).toBe('line1\nline2\nline3');
  });

  it('should handle context at start of file', () => {
    const fileContent = 'line0\nline1\nline2\nline3';
    const location: ContextLocation = {
      startIndex: 0,
      endIndex: 5,
      startLine: 0,
      endLine: 0,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 10, 2);

    expect(result).toBe('line0\nline1\nline2');
  });

  it('should handle context at end of file', () => {
    const fileContent = 'line0\nline1\nline2\nline3';
    const location: ContextLocation = {
      startIndex: 18,
      endIndex: 23,
      startLine: 3,
      endLine: 3,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 2, 10);

    expect(result).toBe('line1\nline2\nline3');
  });

  it('should handle zero context lines', () => {
    const fileContent = 'line0\nline1\nline2';
    const location: ContextLocation = {
      startIndex: 6,
      endIndex: 11,
      startLine: 1,
      endLine: 1,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 0, 0);

    expect(result).toBe('line1');
  });

  it('should handle multiline context location', () => {
    const fileContent = 'line0\nline1\nline2\nline3\nline4';
    const location: ContextLocation = {
      startIndex: 6,
      endIndex: 17,
      startLine: 1,
      endLine: 2,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 1, 1);

    expect(result).toBe('line0\nline1\nline2\nline3');
  });

  it('should handle single line file', () => {
    const fileContent = 'single line';
    const location: ContextLocation = {
      startIndex: 0,
      endIndex: 11,
      startLine: 0,
      endLine: 0,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location);

    expect(result).toBe('single line');
  });
});

describe('smartContextSearch', () => {
  it('should find exact match with line numbers', async () => {
    const fileContent = '1→ const x = 1;\n2→ const y = 2;';
    const context = '1→ const x = 1;';
    const description = 'Find x';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });

  it('should clean line number prefixes', async () => {
    const fileContent = 'const x = 1;\nconst y = 2;';
    const context = '1→ const x = 1;';
    const description = 'Find x';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBeDefined();
  });

  it('should try original context if cleaning fails', async () => {
    const fileContent = 'special→content';
    const context = 'special→content';
    const description = 'Find special';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });

  it('should search by unique keywords from description', async () => {
    const fileContent = 'function calculateTotal() { return 0; }';
    const context = 'notfound';
    const description = 'Update calculateTotal function';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe('fuzzy');
  });

  it('should search by shorter keywords', async () => {
    const fileContent = 'const value = 123;';
    const context = 'notfound';
    const description = 'Update value';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });

  it('should search by significant words from context', async () => {
    const fileContent = 'function processData(input) { }';
    const context = 'function processData(input)';
    const description = 'Fix function';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });

  it('should return null when no match found', async () => {
    const fileContent = 'const x = 1;';
    const context = 'nonexistent';
    const description = 'Find something';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).toBeNull();
  });

  it('should prioritize longer keywords', async () => {
    const fileContent = 'function veryLongFunctionName() { } function short() { }';
    const context = 'notfound';
    const description = 'Update veryLongFunctionName';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
    expect(result?.startIndex).toBeLessThan(30);
  });

  it('should handle empty description', async () => {
    const fileContent = 'const x = 1;';
    const context = 'const x = 1;';
    const description = '';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });

  it('should handle empty context', async () => {
    const fileContent = 'const x = 1;';
    const context = '';
    const description = 'Find variable x';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).toBeNull();
  });

  it('should filter out short words', async () => {
    const fileContent = 'const myVariable = 1;';
    const context = 'a b c d e';
    const description = 'Find myVariable';

    const result = await smartContextSearch(fileContent, context, description);

    expect(result).not.toBeNull();
  });
});

describe('extractKeywords', () => {
  it('should extract quoted strings from description', () => {
    const description = 'Update the "calculateTotal" function';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('calculateTotal');
  });

  it('should extract single-quoted strings', () => {
    const description = "Update the 'processData' function";

    const keywords = extractKeywords(description);

    expect(keywords).toContain('processData');
  });

  it('should extract backtick-quoted strings', () => {
    const description = 'Update the `handleEvent` function';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('handleEvent');
  });

  it('should extract function calls', () => {
    const description = 'Fix the getData() method';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('getData');
  });

  it('should extract capitalized words', () => {
    const description = 'Update MyClass and OtherClass';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('MyClass');
    expect(keywords).toContain('OtherClass');
  });

  it('should include context as keyword', () => {
    const description = 'Fix something';
    const context = 'const myVariable = 1;';

    const keywords = extractKeywords(description, context);

    expect(keywords).toContain('const myVariable = 1;');
  });

  it('should extract words from context', () => {
    const description = 'Fix something';
    const context = 'function calculateTotal() { }';

    const keywords = extractKeywords(description, context);

    expect(keywords.some((k) => k.includes('function'))).toBe(true);
  });

  it('should remove duplicates', () => {
    const description = 'Update "test" and "test" function';

    const keywords = extractKeywords(description);

    const testCount = keywords.filter((k) => k === 'test').length;
    expect(testCount).toBe(1);
  });

  it('should sort by length descending', () => {
    const description = 'Update "short" and "muchlongerword"';

    const keywords = extractKeywords(description);

    const shortIndex = keywords.indexOf('short');
    const longIndex = keywords.indexOf('muchlongerword');
    expect(longIndex).toBeLessThan(shortIndex);
  });

  it('should filter short words from context', () => {
    const description = '';
    const context = 'a bb ccc dddd eeeee';

    const keywords = extractKeywords(description, context);

    expect(keywords.some((k) => k.length <= 4)).toBe(false);
  });

  it('should handle empty description', () => {
    const keywords = extractKeywords('');

    expect(keywords).toEqual([]);
  });

  it('should handle empty context', () => {
    const keywords = extractKeywords('test', '');

    expect(keywords.length).toBeGreaterThan(0);
  });

  it('should handle no matches', () => {
    const description = 'no special keywords here';

    const keywords = extractKeywords(description);

    expect(keywords).toBeDefined();
  });

  it('should extract multiple function calls', () => {
    const description = 'Fix getData() and processData() methods';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('getData');
    expect(keywords).toContain('processData');
  });

  it('should extract nested quotes', () => {
    const description = 'Update "outer \'inner\' text"';

    const keywords = extractKeywords(description);

    expect(keywords.length).toBeGreaterThan(0);
  });

  it('should handle mixed quote types', () => {
    const description = 'Update "double" and \'single\' and `backtick`';

    const keywords = extractKeywords(description);

    expect(keywords).toContain('double');
    expect(keywords).toContain('single');
    expect(keywords).toContain('backtick');
  });
});

describe('edge cases and error handling', () => {
  it('should handle very large file content', () => {
    const fileContent = Array(10000)
      .fill(0)
      .map((_, i) => `line${i}`)
      .join('\n');
    const context = 'line5000';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle unicode characters', () => {
    const fileContent = 'const emoji = "😀";';
    const context = 'emoji';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle special characters in context', () => {
    const fileContent = 'const pattern = /[a-z]+/g;';
    const context = '/[a-z]+/g';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle empty lines', () => {
    const fileContent = 'line1\n\n\nline4';
    const context = 'line4';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
    expect(result?.startLine).toBe(3);
  });

  it('should handle trailing newlines', () => {
    const fileContent = 'line1\nline2\n\n\n';
    const context = 'line2';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle Windows line endings', () => {
    const fileContent = 'line1\r\nline2\r\nline3';
    const context = 'line2';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle mixed line endings', () => {
    const fileContent = 'line1\nline2\r\nline3\rline4';
    const context = 'line3';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle invalid regex patterns gracefully', () => {
    const fileContent = 'const x = 1;';
    const context = '[invalid(regex';

    const result = findContextInFile(fileContent, context);

    expect(result).toBeNull();
  });

  it('should handle context with multiple spaces', () => {
    const fileContent = 'const     x     =     1;';
    const context = 'const x = 1;';

    const result = findContextInFile(fileContent, context);

    expect(result).not.toBeNull();
  });

  it('should handle location at exact file boundaries', () => {
    const fileContent = 'test';
    const location: ContextLocation = {
      startIndex: 0,
      endIndex: 4,
      startLine: 0,
      endLine: 0,
      confidence: 'exact',
    };

    const result = extractCodeAroundContext(fileContent, location, 0, 0);

    expect(result.length).toBeGreaterThanOrEqual(0);
  });
});
