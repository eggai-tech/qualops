import type { FixSuggestion, ReviewIssue } from '@/shared/types';
import { generateFixes } from '@/stages/fix';
import { getOutputDir } from '@tests/setup/integration.setup';
import { addFile, createMockAIProvider, createTestProject, SAMPLE_COMPONENTS } from '@tests/helpers/test-fixtures';

const mockGetCurrentSessionPaths = jest.fn();
const mockWriteMetadataFile = jest.fn();
const mockReadMetadataFile = jest.fn();
const mockAddStageTokenStats = jest.fn();
const mockAIFactory = {
  createForStage: jest.fn(),
};
const mockCreateFixBatchRollbackPoint = jest.fn();
const mockGenerateDiffHTML = jest.fn();
const mockGenerateFix = jest.fn();

jest.mock('@/shared/runtime/session-context', () => ({
  getCurrentSessionPaths: (...args: unknown[]) => mockGetCurrentSessionPaths(...args),
  addStageTokenStats: (...args: unknown[]) => mockAddStageTokenStats(...args),
}));

jest.mock('@/shared/utils/file-utils', () => {
  const actual = jest.requireActual('../../shared/utils/file-utils.ts');
  return {
    ...actual,
    writeMetadataFile: (...args: unknown[]) => mockWriteMetadataFile(...args),
    readMetadataFile: (...args: unknown[]) => mockReadMetadataFile(...args),
  };
});

jest.mock('@/ai/providers', () => ({
  AIFactory: {
    createForStage: (...args: unknown[]) => mockAIFactory.createForStage(...args),
  },
}));

jest.mock('@/stages/fix/utils/rollback-manager', () => ({
  createFixBatchRollbackPoint: (...args: unknown[]) => mockCreateFixBatchRollbackPoint(...args),
}));

jest.mock('@/stages/fix/utils/diff-visualizer', () => ({
  generateDiffHTML: (...args: unknown[]) => mockGenerateDiffHTML(...args),
}));

jest.mock('@/stages/fix/generators/fix-generator', () => ({
  generateFix: (...args: unknown[]) => mockGenerateFix(...args),
}));

describe('Fix Stage Integration', () => {
  let testProject: ReturnType<typeof createTestProject>;
  let mockAIProvider: ReturnType<typeof createMockAIProvider>;

  beforeEach(() => {
    testProject = createTestProject(getOutputDir(), 'fix-test-project');
    mockAIProvider = createMockAIProvider();

    mockGetCurrentSessionPaths.mockReturnValue({
      reviewSummary: () => `${testProject.root}/.qualops/review.json`,
      fixSummary: () => `${testProject.root}/.qualops/fix.json`,
      diffReport: () => `${testProject.root}/.qualops/diff.html`,
    });

    mockWriteMetadataFile.mockResolvedValue(undefined);
    mockAddStageTokenStats.mockReturnValue(undefined);
    mockAIFactory.createForStage.mockResolvedValue(mockAIProvider);
    mockCreateFixBatchRollbackPoint.mockReturnValue('rollback-point-id');
    mockGenerateDiffHTML.mockResolvedValue(undefined);
    mockGenerateFix.mockReset();
  });

  afterEach(() => {
    testProject.cleanup();
    jest.clearAllMocks();
  });

  it('should return existing fix metadata if already completed', async () => {
    const existingFix = {
      timestamp: new Date().toISOString(),
      issuesProcessed: 5,
      suggestions: [],
      summary: {
        totalSuggestions: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        breaking: 0,
        applied: 0,
      },
    };

    mockReadMetadataFile.mockResolvedValue(existingFix);

    const result = await generateFixes();

    expect(result).toEqual(existingFix);
    expect(mockAIFactory.createForStage).not.toHaveBeenCalled();
  });

  it('should generate fix suggestions for high severity issues', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);

    const mockIssues: ReviewIssue[] = [
      {
        id: 'issue-1',
        file: `${testProject.root}/src/component.ts`,
        type: 'bug',
        severity: 'high',
        description: 'Potential null reference',
        location: 'component.ts:10',
        reasoning: 'Variable could be undefined',
        suggestion: 'Add null check',
        context: 'Function body',
        confidence: 85,
      },
      {
        id: 'issue-2',
        file: `${testProject.root}/src/component.ts`,
        type: 'maintainability',
        severity: 'low',
        description: 'Code style issue',
        location: 'component.ts:15',
        reasoning: 'Minor formatting',
        suggestion: 'Format code',
        context: 'Helper function',
        confidence: 60,
      },
    ];

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 1,
          projectsReviewed: 1,
          issues: mockIssues,
          summary: {
            totalIssues: 2,
            critical: 0,
            high: 1,
            medium: 0,
            low: 1,
            byType: { bug: 1, security: 0, performance: 0, maintainability: 1 },
          },
        });
      }
      return null;
    });

    const mockFixSuggestion: FixSuggestion = {
      issueId: 'issue-1',
      file: `${testProject.root}/src/component.ts`,
      line: 10,
      originalCode: 'const value = obj.property;',
      suggestedCode: 'const value = obj?.property;',
      explanation: 'Added optional chaining to prevent null reference',
      confidence: 'high',
      breaking: false,
      applied: false,
    };

    mockGenerateFix.mockResolvedValue(mockFixSuggestion);

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.issuesProcessed).toBeGreaterThan(0);
    expect(result.summary.totalSuggestions).toBeGreaterThan(0);
    expect(mockAIFactory.createForStage).toHaveBeenCalledWith('fix');
  });

  it('should filter low confidence issues', async () => {
    const lowConfidenceIssues: ReviewIssue[] = [
      {
        id: 'issue-1',
        file: 'src/component.ts',
        type: 'maintainability',
        severity: 'high',
        description: 'Code improvement',
        location: 'component.ts:10',
        reasoning: 'Could be better',
        suggestion: 'Refactor',
        context: 'Function',
        confidence: 50,
      },
    ];

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 1,
          projectsReviewed: 1,
          issues: lowConfidenceIssues,
          summary: {
            totalIssues: 1,
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
          },
        });
      }
      return null;
    });

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.summary.totalSuggestions).toBe(0);
  });

  it('should handle empty issues list', async () => {
    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 0,
          projectsReviewed: 0,
          issues: [],
          summary: {
            totalIssues: 0,
            critical: 0,
            high: 0,
            medium: 0,
            low: 0,
            byType: { bug: 0, security: 0, performance: 0, maintainability: 0 },
          },
        });
      }
      return null;
    });

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.issuesProcessed).toBe(0);
    expect(result.summary.totalSuggestions).toBe(0);
  });

  it('should categorize suggestions by confidence level', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);

    const highConfidenceIssue: ReviewIssue = {
      id: 'issue-1',
      file: `${testProject.root}/src/component.ts`,
      type: 'bug',
      severity: 'high',
      description: 'Critical bug',
      location: 'component.ts:10',
      reasoning: 'Logic error',
      suggestion: 'Fix logic',
      context: 'Main function',
      confidence: 95,
    };

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 1,
          projectsReviewed: 1,
          issues: [highConfidenceIssue],
          summary: {
            totalIssues: 1,
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
          },
        });
      }
      return null;
    });

    mockGenerateFix.mockResolvedValue({
      issueId: 'issue-1',
      file: `${testProject.root}/src/component.ts`,
      line: 10,
      originalCode: 'if (x = 1)',
      suggestedCode: 'if (x === 1)',
      explanation: 'Fixed assignment to comparison',
      confidence: 'high',
      breaking: false,
      applied: false,
    });

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.summary.highConfidence).toBeGreaterThan(0);
  });

  it('should skip ESLint issues', async () => {
    const eslintIssue: ReviewIssue = {
      id: 'lint-1',
      file: 'src/component.ts',
      type: 'maintainability',
      severity: 'high',
      description: 'ESLint error',
      location: 'component.ts:5',
      reasoning: 'Rule violation',
      suggestion: 'Fix ESLint rule',
      context: '[ESLint] semi',
      confidence: 95,
    };

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 1,
          projectsReviewed: 1,
          issues: [eslintIssue],
          summary: {
            totalIssues: 1,
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
          },
        });
      }
      return null;
    });

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.summary.totalSuggestions).toBe(0);
  });

  it('should handle AI provider failures gracefully', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);

    const issue: ReviewIssue = {
      id: 'issue-1',
      file: `${testProject.root}/src/component.ts`,
      type: 'bug',
      severity: 'high',
      description: 'Bug to fix',
      location: 'component.ts:10',
      reasoning: 'Error in logic',
      suggestion: 'Fix logic',
      context: 'Function',
      confidence: 85,
    };

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filesReviewed: 1,
          projectsReviewed: 1,
          issues: [issue],
          summary: {
            totalIssues: 1,
            critical: 0,
            high: 1,
            medium: 0,
            low: 0,
            byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
          },
        });
      }
      return null;
    });

    mockGenerateFix.mockRejectedValue(new Error('AI provider failed'));

    const result = await generateFixes();

    expect(result).toBeDefined();
    expect(result.summary.totalSuggestions).toBe(0);
  });

  it('should throw error if review metadata is missing', async () => {
    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('fix.json')) return null;
      if (path.includes('review.json')) return null;
      return null;
    });

    await expect(generateFixes()).rejects.toThrow('No review metadata found');
  });
});
