import type { FrameworkContext, ReviewIssue } from '@/shared/types';
import { createFixPrompt, createReviewPrompt, detectFrameworkContext, validateReviewIssue } from '@/ai/shared/structured-ai';

jest.mock('@/shared/utils/documentation-context', () => ({
  enhanceReviewPromptWithDocumentation: jest.fn((fileContent, filePath, _frameworkContext) => {
    return `Enhanced review prompt for ${filePath}`;
  }),
}));

describe('structured-ai', () => {
  describe('createReviewPrompt', () => {
    it('should create review prompt for typescript file', async () => {
      const result = await createReviewPrompt('const x = 1;', 'test.ts');

      expect(result).toBeTruthy();
      expect(typeof result).toBe('string');
      expect(result).toContain('test.ts');
    });

    it('should create review prompt with framework context', async () => {
      const context = {
        framework: 'angular',
        version: '14.0.0',
        dependencies: ['@angular/core'],
      };
      const result = await createReviewPrompt('code', 'test.ts', context);

      expect(result).toBeTruthy();
      expect(result).toContain('test.ts');
    });

    it('should handle empty file content', async () => {
      const result = await createReviewPrompt('', 'empty.ts');

      expect(result).toBeTruthy();
    });

    it('should handle long file content', async () => {
      const longContent = 'const x = 1;\n'.repeat(1000);
      const result = await createReviewPrompt(longContent, 'large.ts');

      expect(result).toBeTruthy();
    });

    it('should handle various file paths', async () => {
      const paths = ['src/components/test.tsx', 'lib/utils/helper.js', 'services/api.service.ts'];

      for (const path of paths) {
        const result = await createReviewPrompt('code', path);
        expect(result).toContain(path);
      }
    });

    it('should handle files with special characters', async () => {
      const content = 'const x = "特殊文字";';
      const result = await createReviewPrompt(content, 'test.ts');

      expect(result).toBeTruthy();
    });

    it('should handle undefined framework context', async () => {
      const result = await createReviewPrompt('code', 'test.ts', undefined);

      expect(result).toBeTruthy();
    });

    it('should handle minimal framework context', async () => {
      const context: Partial<FrameworkContext> = {
        framework: 'typescript',
      };
      const result = await createReviewPrompt('code', 'test.ts', context);

      expect(result).toBeTruthy();
    });
  });

  describe('createFixPrompt', () => {
    const mockIssue: ReviewIssue = {
      id: 'issue-1',
      file: 'test.ts',
      line: 10,
      type: 'bug',
      severity: 'high',
      description: 'Variable not defined',
      location: 'line 10',
      reasoning: 'Variable is used before declaration',
      suggestion: 'Declare the variable first',
      context: 'function test() { console.log(x); }',
      confidence: 8,
    };

    it('should create fix prompt with basic information', async () => {
      const result = await createFixPrompt(mockIssue, 'const x = undefined;', 'surrounding context');

      expect(result).toContain('Variable not defined');
      expect(result).toContain('line 10');
      expect(result).toContain('const x = undefined;');
    });

    it('should include issue description in prompt', async () => {
      const result = await createFixPrompt(mockIssue, 'code', 'context');

      expect(result).toContain('Issue:');
      expect(result).toContain(mockIssue.description);
    });

    it('should include location in prompt', async () => {
      const result = await createFixPrompt(mockIssue, 'code', 'context');

      expect(result).toContain('Location:');
      expect(result).toContain(mockIssue.location);
    });

    it('should include context in prompt', async () => {
      const issueContext = 'This is the context around the issue';
      const result = await createFixPrompt(mockIssue, 'code', issueContext);

      expect(result).toContain('Context:');
      expect(result).toContain(issueContext);
    });

    it('should include original code in code block', async () => {
      const originalCode = 'const x = 1;\nconst y = 2;';
      const result = await createFixPrompt(mockIssue, originalCode, 'context');

      expect(result).toContain('Original Code:');
      expect(result).toContain('```');
      expect(result).toContain(originalCode);
    });

    it('should handle multiline code', async () => {
      const multilineCode = `function test() {
  const x = 1;
  const y = 2;
  return x + y;
}`;
      const result = await createFixPrompt(mockIssue, multilineCode, 'context');

      expect(result).toContain(multilineCode);
    });

    it('should handle full file content', async () => {
      const fullContent = 'entire file content here';
      const result = await createFixPrompt(mockIssue, 'code', 'context', fullContent);

      expect(result).toBeTruthy();
    });

    it('should handle framework context', async () => {
      const frameworkContext: FrameworkContext = {
        framework: 'angular',
        dependencies: ['@angular/core'],
      };
      const result = await createFixPrompt(mockIssue, 'code', 'context', undefined, frameworkContext);

      expect(result).toBeTruthy();
    });

    it('should handle loadDocumentation flag', async () => {
      const result = await createFixPrompt(mockIssue, 'code', 'context', undefined, undefined, true);

      expect(result).toBeTruthy();
    });

    it('should provide fix guidance', async () => {
      const result = await createFixPrompt(mockIssue, 'code', 'context');

      expect(result).toContain('provide');
      expect(result).toContain('fix');
    });

    it('should mention best practices', async () => {
      const result = await createFixPrompt(mockIssue, 'code', 'context');

      expect(result).toContain('best practices');
    });

    it('should handle issues with no line number', async () => {
      const issueNoLine = { ...mockIssue };
      delete issueNoLine.line;

      const result = await createFixPrompt(issueNoLine, 'code', 'context');

      expect(result).toBeTruthy();
    });

    it('should handle empty context', async () => {
      const result = await createFixPrompt(mockIssue, 'code', '');

      expect(result).toBeTruthy();
    });

    it('should handle empty original code', async () => {
      const result = await createFixPrompt(mockIssue, '', 'context');

      expect(result).toBeTruthy();
    });
  });

  describe('detectFrameworkContext', () => {
    it('should detect Angular from @angular imports', () => {
      const content = `import { Component } from '@angular/core';`;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.framework).toBe('angular');
      expect(context.dependencies).toContain('@angular/core');
    });

    it('should detect Angular from @angular imports only', () => {
      const content = `
        @Component({ selector: 'app-test' })
        class TestComponent {}
      `;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.framework).toBe('typescript');
    });

    it('should collect Angular dependencies', () => {
      const content = `import { Component } from '@angular/core';
import { Router } from '@angular/router';
import { HttpClient } from '@angular/common';`;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.dependencies).toContain('@angular/core');
      expect(context.dependencies).toContain('@angular/router');
      expect(context.dependencies).toContain('@angular/common');
    });

    it('should detect RxJS dependency', () => {
      const content = `import { Observable } from 'rxjs';`;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.dependencies).toContain('rxjs');
    });

    it('should detect RxJS from import only', () => {
      const content = `const obs: Observable<string> = of('test');`;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.dependencies).not.toContain('rxjs');
    });

    it('should detect service file type', () => {
      const content = `export class DataService {}`;
      const context = detectFrameworkContext('data.service.ts', content);

      expect(context.fileType).toBe('service');
    });

    it('should detect component file type', () => {
      const content = `@Component({})`;
      const context = detectFrameworkContext('app.component.ts', content);

      expect(context.fileType).toBe('component');
    });

    it('should detect guard file type', () => {
      const content = `export class AuthGuard {}`;
      const context = detectFrameworkContext('auth.guard.ts', content);

      expect(context.fileType).toBe('guard');
    });

    it('should detect pipe file type', () => {
      const content = `@Pipe({ name: 'custom' })`;
      const context = detectFrameworkContext('custom.pipe.ts', content);

      expect(context.fileType).toBe('pipe');
    });

    it('should detect directive file type', () => {
      const content = `@Directive({ selector: '[custom]' })`;
      const context = detectFrameworkContext('custom.directive.ts', content);

      expect(context.fileType).toBe('directive');
    });

    it('should default to typescript framework', () => {
      const content = `const x: number = 1;`;
      const context = detectFrameworkContext('util.ts', content);

      expect(context.framework).toBe('typescript');
    });

    it('should initialize empty dependencies array', () => {
      const content = `const x = 1;`;
      const context = detectFrameworkContext('test.ts', content);

      expect(Array.isArray(context.dependencies)).toBe(true);
    });

    it('should handle empty content', () => {
      const context = detectFrameworkContext('test.ts', '');

      expect(context.framework).toBe('typescript');
      expect(context.dependencies).toEqual([]);
    });

    it('should not duplicate dependencies', () => {
      const content = `import { Component } from '@angular/core';
import { OnInit } from '@angular/core';`;
      const context = detectFrameworkContext('test.ts', content);

      const coreCount = context.dependencies.filter((d) => d === '@angular/core').length;
      expect(coreCount).toBe(1);
    });

    it('should handle multiple framework indicators', () => {
      const content = `import { Component } from '@angular/core';
import { Observable } from 'rxjs';`;
      const context = detectFrameworkContext('test.ts', content);

      expect(context.framework).toBe('angular');
      expect(context.dependencies).toContain('rxjs');
    });

    it('should handle complex file paths', () => {
      const path = '/Users/project/src/app/features/auth/services/auth.service.ts';
      const context = detectFrameworkContext(path, 'code');

      expect(context.fileType).toBe('service');
    });
  });

  describe('validateReviewIssue', () => {
    const validIssue: Partial<ReviewIssue> = {
      id: 'issue-1',
      file: 'test.ts',
      type: 'bug',
      severity: 'high',
      description: 'Test issue',
      location: 'line 10',
    };

    it('should validate complete issue', () => {
      const result = validateReviewIssue(validIssue);

      expect(result).toBe(true);
    });

    it('should reject issue missing id', () => {
      const incomplete = { ...validIssue };
      delete incomplete.id;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should reject issue missing file', () => {
      const incomplete = { ...validIssue };
      delete incomplete.file;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should reject issue missing type', () => {
      const incomplete = { ...validIssue };
      delete incomplete.type;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should reject issue missing severity', () => {
      const incomplete = { ...validIssue };
      delete incomplete.severity;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should reject issue missing description', () => {
      const incomplete = { ...validIssue };
      delete incomplete.description;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should reject issue missing location', () => {
      const incomplete = { ...validIssue };
      delete incomplete.location;

      const result = validateReviewIssue(incomplete);

      expect(result).toBe(false);
    });

    it('should accept issue with all required fields', () => {
      const complete: Partial<ReviewIssue> = {
        id: 'id',
        file: 'file.ts',
        type: 'bug',
        severity: 'low',
        description: 'desc',
        location: 'loc',
      };

      const result = validateReviewIssue(complete);

      expect(result).toBe(true);
    });

    it('should accept issue with optional fields', () => {
      const withOptional: Partial<ReviewIssue> = {
        ...validIssue,
        line: 10,
        confidence: 8,
        tags: ['important'],
      };

      const result = validateReviewIssue(withOptional);

      expect(result).toBe(true);
    });

    it('should reject empty object', () => {
      const result = validateReviewIssue({});

      expect(result).toBe(false);
    });

    it('should handle null values in fields', () => {
      const withNull = {
        id: null,
        file: 'test.ts',
        type: 'bug',
        severity: 'high',
        description: 'test',
        location: 'line 1',
      } as unknown as Partial<ReviewIssue>;

      const result = validateReviewIssue(withNull);

      expect(result).toBe(false);
    });

    it('should handle undefined values in fields', () => {
      const withUndefined = {
        id: 'id',
        file: undefined,
        type: 'bug',
        severity: 'high',
        description: 'test',
        location: 'line 1',
      } as unknown as Partial<ReviewIssue>;

      const result = validateReviewIssue(withUndefined);

      expect(result).toBe(false);
    });

    it('should handle empty string values', () => {
      const withEmpty: Partial<ReviewIssue> = {
        id: '',
        file: 'test.ts',
        type: 'bug',
        severity: 'high',
        description: 'test',
        location: 'line 1',
      };

      const result = validateReviewIssue(withEmpty);

      expect(result).toBe(false);
    });

    it('should validate using double negation', () => {
      const result = validateReviewIssue(validIssue);

      expect(typeof result).toBe('boolean');
    });
  });

  describe('edge cases and integration', () => {
    it('should handle framework context with all fields', () => {
      const content = `import { Component } from '@angular/core';
import { Observable } from 'rxjs';`;
      const context = detectFrameworkContext('app.component.ts', content);

      expect(context.framework).toBe('angular');
      expect(context.fileType).toBe('component');
      expect(context.dependencies.length).toBeGreaterThan(0);
    });

    it('should create prompts for various frameworks', async () => {
      const frameworks: Array<'angular' | 'typescript'> = ['angular', 'typescript'];

      for (const framework of frameworks) {
        const context: FrameworkContext = {
          framework,
          dependencies: [],
        };
        const result = await createReviewPrompt('code', 'test.ts', context);
        expect(result).toBeTruthy();
      }
    });

    it('should handle complex real-world scenarios', async () => {
      const content = `import { Component, OnInit } from '@angular/core';
import { Observable } from 'rxjs';

@Component({
  selector: 'app-test',
  template: '<div>Test</div>'
})
export class TestComponent implements OnInit {
  data$: Observable<any>;

  ngOnInit() {
    // implementation
  }
}`;

      const context = detectFrameworkContext('test.component.ts', content);
      const prompt = await createReviewPrompt(content, 'test.component.ts', context);

      expect(context.framework).toBe('angular');
      expect(context.fileType).toBe('component');
      expect(prompt).toBeTruthy();
    });
  });
});
