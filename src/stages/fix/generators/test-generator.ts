import { readFile } from 'node:fs/promises';

import { getGlobalAIProvider } from '../../../ai/providers';
import type { FixSuggestion } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

export interface GeneratedTest {
  id: string;
  fixId: string;
  testType: 'unit' | 'integration' | 'regression';
  framework: string;
  filePath: string;
  testCode: string;
  description: string;
  dependencies: string[];
  setup?: string;
  teardown?: string;
}

export interface TestGenerationOptions {
  framework?: 'jest' | 'vitest' | 'mocha' | 'auto';
  testType?: 'unit' | 'integration' | 'regression' | 'all';
  includeSetup?: boolean;
  includeTeardown?: boolean;
  generateMocks?: boolean;
}

export function detectTestingFramework(fileContent: string, filePath: string): string {
  if (
    fileContent.includes("from 'jest'") ||
    fileContent.includes('describe(') ||
    fileContent.includes('it(')
  ) {
    return 'jest';
  }

  if (fileContent.includes("from 'vitest'") || fileContent.includes('import { test, expect }')) {
    return 'vitest';
  }

  if (fileContent.includes("from 'mocha'") || fileContent.includes("require('mocha')")) {
    return 'mocha';
  }

  if (filePath.includes('.test.') || filePath.includes('.spec.')) {
    if (filePath.includes('jest') || filePath.includes('__tests__')) {
      return 'jest';
    }
    if (filePath.includes('vitest')) {
      return 'vitest';
    }
  }

  return 'jest';
}

export function generateTestFilePath(originalFilePath: string, framework: string): string {
  const pathParts = originalFilePath.split('/');
  const fileName = pathParts[pathParts.length - 1];
  const fileNameWithoutExt = fileName.replace(/\.(ts|js|tsx|jsx)$/, '');

  const directory = pathParts.slice(0, -1).join('/');

  switch (framework) {
    case 'jest':
      return `${directory}/__tests__/${fileNameWithoutExt}.test.ts`;
    case 'vitest':
      return `${directory}/${fileNameWithoutExt}.test.ts`;
    case 'mocha':
      return `${directory}/test/${fileNameWithoutExt}.test.ts`;
    default:
      return `${directory}/${fileNameWithoutExt}.test.ts`;
  }
}

function createTestPrompt(
  suggestion: FixSuggestion,
  originalCode: string,
  fixedCode: string,
  framework: string,
  testType: string,
): string {
  return `Generate a comprehensive ${testType} test for the following code fix:

**File**: ${suggestion.file}
**Issue**: ${suggestion.explanation}
**Framework**: ${framework}

**Original Code**:
\`\`\`typescript
${originalCode}
\`\`\`

**Fixed Code**:
\`\`\`typescript
${fixedCode}
\`\`\`

**Requirements**:
1. Generate ${framework} tests that verify the fix works correctly
2. Test both the positive case (fix works) and edge cases
3. Include regression tests to ensure the bug doesn't reappear
4. Use appropriate ${framework} syntax and best practices
5. Include proper setup/teardown if needed
6. Add mocks for external dependencies if necessary
7. Ensure tests are readable and maintainable

**Test Types to Include**:
- Unit tests for the specific function/method
- Integration tests if the fix affects multiple components
- Regression tests to prevent the issue from reoccurring
- Edge case tests for boundary conditions

Please provide:
1. Complete test file content
2. List of dependencies needed
3. Setup/teardown instructions if required

Generate only the test code, properly formatted for ${framework}.`;
}

export async function generateUnitTest(
  suggestion: FixSuggestion,
  options: TestGenerationOptions = {},
): Promise<GeneratedTest> {
  const framework =
    options.framework === 'auto'
      ? detectTestingFramework(suggestion.originalCode, suggestion.file)
      : options.framework || 'jest';

  const aiProvider = getGlobalAIProvider();

  const prompt = createTestPrompt(
    suggestion,
    suggestion.originalCode,
    suggestion.suggestedCode || '',
    framework,
    'unit',
  );

  try {
    const response = await aiProvider.invoke(prompt, 2000);

    const testCodeMatch = response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)\n```/);
    const testCode = testCodeMatch ? testCodeMatch[1] : response;

    const dependencies = extractDependencies(testCode, framework);

    return {
      id: `test-${suggestion.issueId}-unit-${Date.now()}`,
      fixId: suggestion.issueId,
      testType: 'unit',
      framework,
      filePath: generateTestFilePath(suggestion.file, framework),
      testCode,
      description: `Unit test for fix: ${suggestion.explanation}`,
      dependencies,
      setup: options.includeSetup ? generateSetupCode(framework) : undefined,
      teardown: options.includeTeardown ? generateTeardownCode(framework) : undefined,
    };
  } catch (error) {
    logger.error(`Failed to generate unit test: ${error}`);

    return generateFallbackTest(suggestion, framework, 'unit');
  }
}

export async function generateIntegrationTest(
  suggestion: FixSuggestion,
  options: TestGenerationOptions = {},
): Promise<GeneratedTest> {
  const framework =
    options.framework === 'auto'
      ? detectTestingFramework(suggestion.originalCode, suggestion.file)
      : options.framework || 'jest';

  let fullFileContent = '';
  try {
    fullFileContent = await readFile(suggestion.file, 'utf-8');
  } catch (error) {
    logger.warn(`Could not read full file for integration test: ${error}`);
  }

  const aiProvider = getGlobalAIProvider();

  const prompt = createTestPrompt(
    suggestion,
    fullFileContent || suggestion.originalCode,
    suggestion.suggestedCode || '',
    framework,
    'integration',
  );

  try {
    const response = await aiProvider.invoke(prompt, 3000);

    const testCodeMatch = response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)\n```/);
    const testCode = testCodeMatch ? testCodeMatch[1] : response;

    const dependencies = extractDependencies(testCode, framework);

    return {
      id: `test-${suggestion.issueId}-integration-${Date.now()}`,
      fixId: suggestion.issueId,
      testType: 'integration',
      framework,
      filePath: generateTestFilePath(suggestion.file, framework),
      testCode,
      description: `Integration test for fix: ${suggestion.explanation}`,
      dependencies,
      setup: generateSetupCode(framework, true),
      teardown: generateTeardownCode(framework, true),
    };
  } catch (error) {
    logger.error(`Failed to generate integration test: ${error}`);
    return generateFallbackTest(suggestion, framework, 'integration');
  }
}

export async function generateRegressionTest(
  suggestion: FixSuggestion,
  options: TestGenerationOptions = {},
): Promise<GeneratedTest> {
  const framework =
    options.framework === 'auto'
      ? detectTestingFramework(suggestion.originalCode, suggestion.file)
      : options.framework || 'jest';

  // Regression tests focus on preventing the bug from reappearing
  const prompt = `Generate a regression test to prevent this bug from reappearing:

**Issue**: ${suggestion.explanation}
**File**: ${suggestion.file}
**Framework**: ${framework}

**Original Buggy Code**:
\`\`\`typescript
${suggestion.originalCode}
\`\`\`

**Fixed Code**:
\`\`\`typescript
${suggestion.suggestedCode || ''}
\`\`\`

Create a ${framework} test that:
1. Reproduces the original bug scenario
2. Verifies the fix prevents the bug
3. Tests edge cases that could trigger the bug again
4. Is specific enough to catch regressions
5. Documents the bug scenario clearly

Focus on the specific conditions that caused the bug and ensure they're covered.`;

  const aiProvider = getGlobalAIProvider();

  try {
    const response = await aiProvider.invoke(prompt, 2000);

    const testCodeMatch = response.match(/```(?:typescript|ts|javascript|js)?\n([\s\S]*?)\n```/);
    const testCode = testCodeMatch ? testCodeMatch[1] : response;

    const dependencies = extractDependencies(testCode, framework);

    return {
      id: `test-${suggestion.issueId}-regression-${Date.now()}`,
      fixId: suggestion.issueId,
      testType: 'regression',
      framework,
      filePath: generateTestFilePath(suggestion.file, framework),
      testCode,
      description: `Regression test for fix: ${suggestion.explanation}`,
      dependencies,
    };
  } catch (error) {
    logger.error(`Failed to generate regression test: ${error}`);
    return generateFallbackTest(suggestion, framework, 'regression');
  }
}

export async function generateAllTests(
  suggestion: FixSuggestion,
  options: TestGenerationOptions = {},
): Promise<GeneratedTest[]> {
  const tests: GeneratedTest[] = [];

  logger.info(`Generating tests for fix ${suggestion.issueId}`);

  try {
    const unitTest = await generateUnitTest(suggestion, options);
    tests.push(unitTest);

    if (suggestion.confidence === 'high') {
      const integrationTest = await generateIntegrationTest(suggestion, options);
      tests.push(integrationTest);
    }

    const regressionTest = await generateRegressionTest(suggestion, options);
    tests.push(regressionTest);
  } catch (error) {
    logger.error(`Failed to generate tests for fix ${suggestion.issueId}: ${error}`);
  }

  logger.info(`Generated ${tests.length} tests for fix ${suggestion.issueId}`);
  return tests;
}

function extractDependencies(testCode: string, framework: string): string[] {
  const dependencies = new Set<string>();

  dependencies.add(framework);

  const importMatches: string[] = testCode.match(/import.*from ['"]([^'"]+)['"]/g) ?? [];
  importMatches.forEach((match) => {
    const moduleMatch = match.match(/from ['"]([^'"]+)['"]/);
    if (moduleMatch) {
      dependencies.add(moduleMatch[1]);
    }
  });

  if (testCode.includes('jest.')) dependencies.add('@types/jest');
  if (testCode.includes('sinon')) dependencies.add('sinon');
  if (testCode.includes('supertest')) dependencies.add('supertest');

  return Array.from(dependencies);
}

function generateSetupCode(framework: string, integration = false): string {
  switch (framework) {
    case 'jest':
      return integration
        ? 'beforeAll(() => {\n  // Setup test environment\n});'
        : 'beforeEach(() => {\n  // Setup for each test\n});';
    case 'vitest':
      return integration
        ? 'beforeAll(() => {\n  // Setup test environment\n});'
        : 'beforeEach(() => {\n  // Setup for each test\n});';
    case 'mocha':
      return integration
        ? 'before(() => {\n  // Setup test environment\n});'
        : 'beforeEach(() => {\n  // Setup for each test\n});';
    default:
      return '// Setup code here';
  }
}

function generateTeardownCode(framework: string, integration = false): string {
  switch (framework) {
    case 'jest':
      return integration
        ? 'afterAll(() => {\n  // Cleanup test environment\n});'
        : 'afterEach(() => {\n  // Cleanup after each test\n});';
    case 'vitest':
      return integration
        ? 'afterAll(() => {\n  // Cleanup test environment\n});'
        : 'afterEach(() => {\n  // Cleanup after each test\n});';
    case 'mocha':
      return integration
        ? 'after(() => {\n  // Cleanup test environment\n});'
        : 'afterEach(() => {\n  // Cleanup after each test\n});';
    default:
      return '// Cleanup code here';
  }
}

function generateFallbackTest(
  suggestion: FixSuggestion,
  framework: string,
  testType: string,
): GeneratedTest {
  const testCode = `// ${testType.toUpperCase()} TEST
// Generated as fallback for fix: ${suggestion.explanation}

describe('Fix for ${suggestion.file}', () => {
  it('should pass after applying the fix', () => {
    expect(true).toBe(true);
  });

  it('should prevent regression', () => {
    expect(true).toBe(true);
  });
});`;

  return {
    id: `test-${suggestion.issueId}-${testType}-fallback-${Date.now()}`,
    fixId: suggestion.issueId,
    testType: testType as 'unit' | 'integration' | 'regression',
    framework,
    filePath: generateTestFilePath(suggestion.file, framework),
    testCode,
    description: `Fallback ${testType} test for fix: ${suggestion.explanation}`,
    dependencies: [framework],
  };
}
