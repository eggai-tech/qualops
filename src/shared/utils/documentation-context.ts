import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

const DOCS_BASE_PATH = join(process.cwd(), '.qualops/unified-docs');

export interface FrameworkContext {
  framework?: string;
  version?: string;
  dependencies?: string[];
  fileType?: string;
}

export class SimpleDocumentationLoader {
  async loadRelevantDocs(framework: string): Promise<string> {
    const docs: string[] = [];
    let totalSize = 0;
    const MAX_SIZE = 500000;

    const criticalOwaspFiles = ['Authentication.md', 'Cross_Site_Scripting_Prevention.md', 'Injection_Prevention.md'];

    for (const file of criticalOwaspFiles) {
      const filePath = join(DOCS_BASE_PATH, 'owasp', file);
      if (existsSync(filePath)) {
        const content = await readFile(filePath, 'utf-8');
        const size = Buffer.byteLength(content);
        if (totalSize + size < MAX_SIZE) {
          docs.push(`# OWASP: ${file.replace('.md', '')}\n${content}`);
          totalSize += size;
        }
      }
    }

    if (framework === 'angular' && totalSize < MAX_SIZE * 0.7) {
      const angularBestPracticesPath = join(DOCS_BASE_PATH, 'angular/best-practices.md');
      if (existsSync(angularBestPracticesPath)) {
        const content = await readFile(angularBestPracticesPath, 'utf-8');
        const size = Buffer.byteLength(content);
        if (totalSize + size < MAX_SIZE) {
          docs.push(content);
          totalSize += size;
        }
      }

      if (totalSize < MAX_SIZE * 0.9) {
        const ngrxContext = join(DOCS_BASE_PATH, 'ngrx/ngrx-llm-context.md');
        if (existsSync(ngrxContext)) {
          const content = await readFile(ngrxContext, 'utf-8');
          const truncated = content.substring(0, 100000);
          docs.push(truncated + '\n... [Documentation truncated]');
          totalSize += 100000;
        }
      }
    }

    const securityPatternsFile = join(DOCS_BASE_PATH, 'security-patterns.md');
    if (existsSync(securityPatternsFile)) {
      const content = await readFile(securityPatternsFile, 'utf-8');
      docs.push(content);
    }

    if (docs.length === 0) {
      return `# ${framework} Documentation\nNo documentation found.`;
    }

    return docs.join('\n\n---\n\n');
  }

  detectFramework(fileContent: string): string {
    if (fileContent.includes('@angular/') || fileContent.includes('@Component')) {
      return 'angular';
    }
    if (fileContent.includes('react') || fileContent.includes('useState')) {
      return 'react';
    }
    if (fileContent.includes('vue')) {
      return 'vue';
    }
    if (fileContent.includes('rxjs') || fileContent.includes('Observable')) {
      return 'rxjs';
    }
    return 'typescript';
  }

  async generateContext(fileContent: string): Promise<string> {
    const framework = this.detectFramework(fileContent);
    const docs = await this.loadRelevantDocs(framework);

    const patterns = this.extractCodePatterns(fileContent);

    return `
# Framework Documentation Context
Framework: ${framework}
Generated: ${new Date().toISOString()}

## Code Patterns Detected:
${patterns.map((p) => `- ${p}`).join('\n')}

## Relevant Documentation:
${docs}

## Security Checks:
1. Check for localStorage usage with sensitive data
2. Check for XSS vulnerabilities in templates
3. Verify authentication and authorization
4. Check for hardcoded secrets
5. Check for injection vulnerabilities
6. Validate user inputs

## Guidelines:
- Follow framework-specific best practices
- Ensure proper cleanup for subscriptions
- Use proper typing and error handling
- Follow OWASP security practices
`;
  }

  private extractCodePatterns(fileContent: string): string[] {
    const patterns: string[] = [];

    // Observable patterns
    if (fileContent.includes('.subscribe(')) {
      patterns.push('Observable subscriptions (check for proper cleanup)');
    }

    // HTTP calls
    if (fileContent.includes('httpClient') || fileContent.includes('http.')) {
      patterns.push('HTTP requests (ensure error handling)');
    }

    // Dialog usage
    if (fileContent.includes('MatDialog') || fileContent.includes('dialogRef')) {
      patterns.push('Material Dialog usage (check lifecycle)');
    }

    // Form controls
    if (fileContent.includes('FormControl') || fileContent.includes('formGroup')) {
      patterns.push('Reactive forms (validate form handling)');
    }

    // Component lifecycle
    if (fileContent.includes('ngOnInit') || fileContent.includes('ngOnDestroy')) {
      patterns.push('Component lifecycle (check initialization/cleanup)');
    }

    return patterns;
  }
}

export async function enhanceReviewPromptWithDocumentation(
  fileContent: string,
  filePath: string,
  frameworkContext?: FrameworkContext,
): Promise<string> {
  const loader = new SimpleDocumentationLoader();
  const documentationContext = await loader.generateContext(fileContent);

  // Generate base prompt with documentation context
  const basePrompt = `
You are reviewing a TypeScript file for code quality, security, and best practices.

File: ${filePath}
Framework: ${frameworkContext?.framework || 'typescript'}

Please analyze the code and identify issues with:
- Type safety and TypeScript best practices
- Security vulnerabilities (XSS, injection attacks, etc.)
- Performance issues and memory leaks
- Code maintainability and readability
- Framework-specific best practices

${documentationContext}

Review the numbered code below and provide specific, actionable feedback:

${fileContent}`;

  return basePrompt;
}
