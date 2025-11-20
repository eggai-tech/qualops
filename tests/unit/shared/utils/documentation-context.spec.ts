import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { enhanceReviewPromptWithDocumentation, SimpleDocumentationLoader } from '@/shared/utils/documentation-context';

jest.mock('node:fs');
jest.mock('node:fs/promises');
jest.mock('node:path');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockJoin = join as jest.MockedFunction<typeof join>;

describe('SimpleDocumentationLoader', () => {
  let loader: SimpleDocumentationLoader;

  beforeEach(() => {
    jest.clearAllMocks();
    loader = new SimpleDocumentationLoader();
    mockJoin.mockImplementation((...args) => args.join('/'));
  });

  describe('detectFramework', () => {
    it('should detect Angular framework', () => {
      const content = 'import { Component } from "@angular/core";';
      expect(loader.detectFramework(content)).toBe('angular');
    });

    it('should detect Angular by @Component decorator', () => {
      const content = '@Component({ selector: "app-root" })';
      expect(loader.detectFramework(content)).toBe('angular');
    });

    it('should detect React framework', () => {
      const content = 'import React from "react";';
      expect(loader.detectFramework(content)).toBe('react');
    });

    it('should detect React by useState hook', () => {
      const content = 'const [state, setState] = useState(0);';
      expect(loader.detectFramework(content)).toBe('react');
    });

    it('should detect Vue framework', () => {
      const content = 'import Vue from "vue";';
      expect(loader.detectFramework(content)).toBe('vue');
    });

    it('should detect RxJS framework', () => {
      const content = 'import { Observable } from "rxjs";';
      expect(loader.detectFramework(content)).toBe('rxjs');
    });

    it('should default to TypeScript', () => {
      const content = 'const x = 42;';
      expect(loader.detectFramework(content)).toBe('typescript');
    });

    it('should prioritize Angular over RxJS', () => {
      const content = 'import { Component } from "@angular/core"; import { Observable } from "rxjs";';
      expect(loader.detectFramework(content)).toBe('angular');
    });
  });

  describe('extractCodePatterns', () => {
    it('should detect Observable subscriptions', async () => {
      const content = 'this.data$.subscribe(data => {});';
      const context = await loader.generateContext(content);
      expect(context).toContain('Observable subscriptions (check for proper cleanup)');
    });

    it('should detect HTTP requests', async () => {
      const content = 'this.httpClient.get("/api/data")';
      const context = await loader.generateContext(content);
      expect(context).toContain('HTTP requests (ensure error handling)');
    });

    it('should detect Material Dialog usage', async () => {
      const content = 'const dialogRef = this.dialog.open(MyComponent);';
      const context = await loader.generateContext(content);
      expect(context).toContain('Material Dialog usage (check lifecycle)');
    });

    it('should detect Reactive forms', async () => {
      const content = 'this.formGroup = new FormGroup({});';
      const context = await loader.generateContext(content);
      expect(context).toContain('Reactive forms (validate form handling)');
    });

    it('should detect Component lifecycle hooks', async () => {
      const content = 'ngOnInit() {} ngOnDestroy() {}';
      const context = await loader.generateContext(content);
      expect(context).toContain('Component lifecycle (check initialization/cleanup)');
    });

    it('should detect multiple patterns', async () => {
      const content = 'ngOnInit() { this.data$.subscribe(); this.httpClient.get(); }';
      const context = await loader.generateContext(content);
      expect(context).toContain('Observable subscriptions');
      expect(context).toContain('HTTP requests');
      expect(context).toContain('Component lifecycle');
    });
  });

  describe('loadRelevantDocs', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(false);
    });

    it('should load critical OWASP files', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue('# Authentication content');

      const docs = await loader.loadRelevantDocs('typescript');

      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('owasp/Authentication.md'), 'utf-8');
      expect(docs).toContain('OWASP: Authentication');
    });

    it('should load security patterns file', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.toString().includes('security-patterns.md');
      });
      mockReadFile.mockResolvedValue('# Security patterns');

      const docs = await loader.loadRelevantDocs('typescript');

      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('security-patterns.md'), 'utf-8');
      expect(docs).toContain('# Security patterns');
    });

    it('should load Angular best practices for Angular framework', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.toString().includes('angular/best-practices.md');
      });
      mockReadFile.mockResolvedValue('# Angular best practices');

      const docs = await loader.loadRelevantDocs('angular');

      expect(mockReadFile).toHaveBeenCalledWith(expect.stringContaining('angular/best-practices.md'), 'utf-8');
      expect(docs).toContain('# Angular best practices');
    });

    it('should load NgRx patterns for Angular', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        if (path.toString().includes('ngrx-llm-context.md')) return true;
        if (path.toString().includes('angular/best-practices.md')) return true;
        return false;
      });
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.toString().includes('ngrx')) {
          return '# NgRx content '.repeat(1000);
        }
        return '# Angular content';
      });

      const docs = await loader.loadRelevantDocs('angular');

      expect(docs).toContain('[Documentation truncated]');
    });

    it('should respect MAX_SIZE limit', async () => {
      mockExistsSync.mockReturnValue(true);
      const largeContent = 'x'.repeat(600000);
      mockReadFile.mockResolvedValue(largeContent);

      const docs = await loader.loadRelevantDocs('typescript');

      expect(docs.length).toBeLessThanOrEqual(600000);
    });

    it('should handle file read errors gracefully', async () => {
      mockExistsSync.mockImplementation((path: string) => {
        return path.toString().includes('owasp') && !path.toString().includes('Authentication');
      });
      mockReadFile.mockImplementation(async (path: string) => {
        if (path.toString().includes('Authentication')) {
          throw new Error('File read error');
        }
        return '# OWASP content';
      });

      const docs = await loader.loadRelevantDocs('typescript');

      expect(docs).toBeDefined();
      expect(docs.length).toBeGreaterThan(0);
    });

    it('should return fallback message when no docs found', async () => {
      mockExistsSync.mockReturnValue(false);

      const docs = await loader.loadRelevantDocs('typescript');

      expect(docs).toBe('# typescript Documentation\nNo documentation found.');
    });

    it('should load fallback OWASP files when no docs initially loaded', async () => {
      let callIndex = 0;
      mockExistsSync.mockImplementation(() => {
        callIndex++;
        return callIndex > 3;
      });
      mockReadFile.mockResolvedValue('# OWASP content');

      const docs = await loader.loadRelevantDocs('typescript');

      expect(mockReadFile).toHaveBeenCalled();
      expect(docs).toContain('OWASP content');
    });

    it('should join multiple docs with separator', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValueOnce('Doc 1').mockResolvedValueOnce('Doc 2');

      const docs = await loader.loadRelevantDocs('typescript');

      expect(docs).toContain('---');
    });
  });

  describe('generateContext', () => {
    beforeEach(() => {
      mockExistsSync.mockReturnValue(false);
    });

    it('should generate complete context', async () => {
      mockExistsSync.mockReturnValue(false);
      const fileContent = 'import { Component } from "@angular/core";';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Framework: angular');
      expect(context).toContain('Framework Documentation Context');
      expect(context).toContain('Security Checks:');
      expect(context).toContain('Guidelines:');
    });

    it('should include detected framework', async () => {
      const fileContent = 'const [state, setState] = useState(0);';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Framework: react');
    });

    it('should include code patterns', async () => {
      const fileContent = 'this.data$.subscribe(); ngOnInit() {}';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Code Patterns Detected:');
      expect(context).toContain('Observable subscriptions');
    });

    it('should include timestamp', async () => {
      const fileContent = 'const x = 42;';

      const context = await loader.generateContext(fileContent);

      expect(context).toMatch(/Generated: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should include security checks', async () => {
      const fileContent = 'const x = 42;';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Check for localStorage usage');
      expect(context).toContain('Check for XSS vulnerabilities');
      expect(context).toContain('Verify authentication');
      expect(context).toContain('Check for hardcoded secrets');
      expect(context).toContain('Check for injection vulnerabilities');
      expect(context).toContain('Validate user inputs');
    });

    it('should include guidelines', async () => {
      const fileContent = 'const x = 42;';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Follow framework-specific best practices');
      expect(context).toContain('Ensure proper cleanup for subscriptions');
      expect(context).toContain('Use proper typing and error handling');
      expect(context).toContain('Follow OWASP security practices');
    });

    it('should load relevant documentation', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFile.mockResolvedValue('# Documentation content');
      const fileContent = 'const x = 42;';

      const context = await loader.generateContext(fileContent);

      expect(context).toContain('Relevant Documentation:');
    });
  });
});

describe('enhanceReviewPromptWithDocumentation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockExistsSync.mockReturnValue(false);
    mockJoin.mockImplementation((...args) => args.join('/'));
  });

  it('should generate review prompt with file path', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('File: /path/to/file.ts');
  });

  it('should include framework from context', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';
    const frameworkContext = { framework: 'angular' as const, dependencies: [] };

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath, frameworkContext);

    expect(prompt).toContain('Framework: angular');
  });

  it('should default to typescript framework', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('Framework: typescript');
  });

  it('should include review instructions', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('Type safety and TypeScript best practices');
    expect(prompt).toContain('Security vulnerabilities');
    expect(prompt).toContain('Performance issues and memory leaks');
    expect(prompt).toContain('Code maintainability and readability');
    expect(prompt).toContain('Framework-specific best practices');
  });

  it('should include documentation context', async () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFile.mockResolvedValue('# Documentation');
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('Framework Documentation Context');
    expect(prompt).toContain('Security Checks:');
  });

  it('should include file content', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('const x = 42;');
  });

  it('should request numbered code review', async () => {
    const fileContent = 'const x = 42;';
    const filePath = '/path/to/file';

    const prompt = await enhanceReviewPromptWithDocumentation(fileContent, filePath);

    expect(prompt).toContain('Review the numbered code below');
  });
});
