import { detectFrameworkContext } from '@/shared/utils/framework-detector';

describe('detectFrameworkContext', () => {
  it('should detect Angular from @angular imports', () => {
    const content = `import { Component } from '@angular/core';`;
    const context = detectFrameworkContext('test.ts', content);

    expect(context.framework).toBe('angular');
    expect(context.dependencies).toContain('@angular/core');
  });

  it('should not detect Angular without @angular imports', () => {
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

  it('should not detect RxJS without import', () => {
    const content = `const obs: Observable<string> = of('test');`;
    const context = detectFrameworkContext('test.ts', content);

    expect(context.dependencies).not.toContain('rxjs');
  });

  it.each([
    ['data.service.ts', 'service'],
    ['app.component.ts', 'component'],
    ['auth.guard.ts', 'guard'],
    ['custom.pipe.ts', 'pipe'],
    ['custom.directive.ts', 'directive'],
  ])('should detect %s as %s file type', (path, expected) => {
    const context = detectFrameworkContext(path, 'export class X {}');
    expect(context.fileType).toBe(expected);
  });

  it('should default to typescript framework', () => {
    const context = detectFrameworkContext('util.ts', `const x: number = 1;`);

    expect(context.framework).toBe('typescript');
  });

  it('should initialize empty dependencies array', () => {
    const context = detectFrameworkContext('test.ts', `const x = 1;`);

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
