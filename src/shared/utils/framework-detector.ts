import type { FrameworkContext } from '../types';

export function detectFrameworkContext(filePath: string, fileContent: string): FrameworkContext {
  const context: FrameworkContext = {
    framework: 'typescript',
    dependencies: [],
  };

  if (fileContent.includes('@angular/')) {
    context.framework = 'angular';

    const angularImports = fileContent.match(/@angular\/[a-z-]+/g);
    if (angularImports) {
      context.dependencies = Array.from(new Set(angularImports));
    }
  }

  if (fileContent.includes('rxjs')) {
    if (!context.dependencies.includes('rxjs')) {
      context.dependencies.push('rxjs');
    }
  }

  if (filePath.endsWith('.service.ts')) {
    context.fileType = 'service';
  } else if (filePath.endsWith('.component.ts')) {
    context.fileType = 'component';
  } else if (filePath.endsWith('.guard.ts')) {
    context.fileType = 'guard';
  } else if (filePath.endsWith('.pipe.ts')) {
    context.fileType = 'pipe';
  } else if (filePath.endsWith('.directive.ts')) {
    context.fileType = 'directive';
  }

  return context;
}
