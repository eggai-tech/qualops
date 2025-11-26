import type { FrameworkContext, ReviewIssue } from '../../shared/types';

export type { FrameworkContext } from '../../shared/types';

export async function createReviewPrompt(
  fileContent: string,
  filePath: string,
  frameworkContext?: {
    framework?: string;
    version?: string;
    dependencies?: string[];
  },
): Promise<string> {
  const documentation = await import('../../shared/utils/documentation-context');
  return documentation.enhanceReviewPromptWithDocumentation(
    fileContent,
    filePath,
    frameworkContext,
  );
}

export async function createFixPrompt(
  issue: ReviewIssue,
  originalCode: string,
  issueContext: string,
  fullFileContent?: string,
  frameworkContext?: FrameworkContext,
  _loadDocumentation = false,
): Promise<string> {
  return `Fix the following issue in the code:

Issue: ${issue.description}
Location: ${issue.location}
Context: ${issueContext}

Original Code:
\`\`\`
${originalCode}
\`\`\`

Please provide a corrected version of the code.
Provide a fix that addresses the issue while maintaining code quality and following best practices.`;
}

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

export function validateReviewIssue(issue: Partial<ReviewIssue>): boolean {
  return !!(
    issue.id &&
    issue.file &&
    issue.type &&
    issue.severity &&
    issue.description &&
    issue.location
  );
}
