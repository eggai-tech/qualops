import type { ReviewIssue } from '@/shared/types';
import { reviewProjects } from '@/stages/review';
import { getOutputDir } from '@tests/setup/integration.setup';
import { addFile, createMockAIProvider, createTestProject, SAMPLE_COMPONENTS } from '@tests/helpers/test-fixtures';

const mockGetCurrentSessionPaths = jest.fn();
const mockGetCurrentSession = jest.fn();
const mockWriteMetadataFile = jest.fn();
const mockReadMetadataFile = jest.fn();
const mockAddStageTokenStats = jest.fn();
const mockLoadExtractLog = jest.fn();
const mockSaveExtractLog = jest.fn();
const mockUpdateFileInExtractLog = jest.fn();
const mockAIFactory = {
  createForStage: jest.fn(),
};
const mockPipelineExecutor = jest.fn();

jest.mock('@/shared/runtime/session-context', () => ({
  getCurrentSessionPaths: (...args: unknown[]) => mockGetCurrentSessionPaths(...args),
  getCurrentSession: (...args: unknown[]) => mockGetCurrentSession(...args),
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

jest.mock('@/stages/analyze/utils/extract-log', () => ({
  loadExtractLog: (...args: unknown[]) => mockLoadExtractLog(...args),
  saveExtractLog: (...args: unknown[]) => mockSaveExtractLog(...args),
  updateFileInExtractLog: (...args: unknown[]) => mockUpdateFileInExtractLog(...args),
}));

jest.mock('@/ai/providers', () => ({
  AIFactory: {
    createForStage: (...args: unknown[]) => mockAIFactory.createForStage(...args),
  },
}));

jest.mock('@/stages/review/processors/pipeline-executor', () => ({
  PipelineExecutor: jest.fn().mockImplementation(() => ({
    execute: (...args: unknown[]) => mockPipelineExecutor(...args),
  })),
}));

describe('Review Stage Integration', () => {
  let testProject: ReturnType<typeof createTestProject>;
  let mockAIProvider: ReturnType<typeof createMockAIProvider>;

  beforeEach(() => {
    testProject = createTestProject(getOutputDir(), 'review-test-project');
    mockAIProvider = createMockAIProvider();

    mockGetCurrentSessionPaths.mockReturnValue({
      reportRoot: () => 'reports',
      analysis: () => `${testProject.root}/.qualops/analysis.json`,
      reviewSummary: () => `${testProject.root}/.qualops/review.json`,
      extractLog: () => `${testProject.root}/.qualops/extract-log.json`,
    });

    mockGetCurrentSession.mockReturnValue('test-session');
    mockWriteMetadataFile.mockResolvedValue(undefined);
    mockAddStageTokenStats.mockReturnValue(undefined);
    mockAIFactory.createForStage.mockResolvedValue(mockAIProvider);
    mockLoadExtractLog.mockResolvedValue({
      timestamp: new Date().toISOString(),
      files: {},
    });
    mockSaveExtractLog.mockResolvedValue(undefined);
    mockUpdateFileInExtractLog.mockResolvedValue(undefined);

    // Default mock: return empty issues array
    mockPipelineExecutor.mockResolvedValue([]);
  });

  afterEach(() => {
    testProject.cleanup();
    jest.clearAllMocks();
  });

  it('should return existing review if already completed', async () => {
    const existingReview = {
      timestamp: new Date().toISOString(),
      filesReviewed: 5,
      projectsReviewed: 1,
      issues: [],
      summary: {
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        byType: { bug: 0, security: 0, performance: 0, maintainability: 0 },
      },
    };

    mockReadMetadataFile.mockResolvedValue(existingReview);

    const result = await reviewProjects();

    expect(result).toEqual(existingReview);
    expect(mockAIFactory.createForStage).not.toHaveBeenCalled();
  });

  it('should perform AI review on TypeScript files', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);
    addFile(testProject, 'src/service.ts', SAMPLE_COMPONENTS.serviceWithSecurity);

    const mockIssues: ReviewIssue[] = [
      {
        id: 'review-1',
        file: `${testProject.root}/src/component.ts`,
        type: 'maintainability',
        severity: 'medium',
        description: 'Complex logic detected',
        location: 'component.ts:10',
        reasoning: 'Function is too complex',
        suggestion: 'Refactor into smaller functions',
        context: 'Function with high cyclomatic complexity',
        confidence: 85,
      },
    ];

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filePaths: [`${testProject.root}/src/component.ts`, `${testProject.root}/src/service.ts`],
        });
      }
      return null;
    });

    mockPipelineExecutor.mockResolvedValue(mockIssues);

    const result = await reviewProjects();

    expect(result).toBeDefined();
    expect(result.filesReviewed).toBe(2);
    expect(result.summary.totalIssues).toBeGreaterThanOrEqual(0);
    expect(mockAIFactory.createForStage).toHaveBeenCalledWith('review');
  });

  it('should handle files with security issues', async () => {
    addFile(testProject, 'src/security.ts', SAMPLE_COMPONENTS.serviceWithSecurity);

    const securityIssue: ReviewIssue = {
      id: 'security-1',
      file: `${testProject.root}/src/security.ts`,
      type: 'security',
      severity: 'critical',
      description: 'SQL injection vulnerability',
      location: 'security.ts:15',
      reasoning: 'User input directly concatenated to SQL query',
      suggestion: 'Use parameterized queries',
      context: 'Database query construction',
      confidence: 95,
    };

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filePaths: [`${testProject.root}/src/security.ts`],
        });
      }
      return null;
    });

    mockPipelineExecutor.mockResolvedValue([securityIssue]);

    const result = await reviewProjects();

    expect(result).toBeDefined();
    expect(result.summary.critical).toBeGreaterThan(0);
    expect(result.summary.byType.security).toBeGreaterThan(0);
  });

  it('should handle empty file list', async () => {
    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filePaths: [],
        });
      }
      return null;
    });

    const result = await reviewProjects();

    expect(result).toBeDefined();
    expect(result.filesReviewed).toBe(0);
    expect(result.summary.totalIssues).toBe(0);
  });

  it('should skip spec files', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);
    addFile(testProject, 'src/component.spec.ts', 'describe("test", () => {});');

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filePaths: [`${testProject.root}/src/component.ts`, `${testProject.root}/src/component.spec.ts`],
        });
      }
      return null;
    });

    mockPipelineExecutor.mockResolvedValue([]);

    const result = await reviewProjects();

    expect(result).toBeDefined();
    expect(result.filesReviewed).toBe(1);
  });

  it('should categorize issues by severity', async () => {
    addFile(testProject, 'src/component.ts', SAMPLE_COMPONENTS.goodComponent);

    const mixedIssues: ReviewIssue[] = [
      {
        id: 'issue-1',
        file: `${testProject.root}/src/component.ts`,
        type: 'bug',
        severity: 'critical',
        description: 'Critical bug',
        location: 'component.ts:5',
        reasoning: 'Logic error',
        suggestion: 'Fix logic',
        context: 'Critical section',
        confidence: 95,
      },
      {
        id: 'issue-2',
        file: `${testProject.root}/src/component.ts`,
        type: 'maintainability',
        severity: 'low',
        description: 'Minor improvement',
        location: 'component.ts:10',
        reasoning: 'Could be cleaner',
        suggestion: 'Refactor',
        context: 'Helper function',
        confidence: 70,
      },
    ];

    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) {
        return Promise.resolve({
          timestamp: new Date().toISOString(),
          filePaths: [`${testProject.root}/src/component.ts`],
        });
      }
      return null;
    });

    mockPipelineExecutor.mockResolvedValue(mixedIssues);

    const result = await reviewProjects();

    expect(result).toBeDefined();
    expect(result.summary.critical).toBeGreaterThan(0);
    expect(result.summary.low).toBeGreaterThan(0);
  });

  it('should throw error if analysis metadata is missing', async () => {
    mockReadMetadataFile.mockImplementation((path: string) => {
      if (path.includes('review.json')) return null;
      if (path.includes('analysis.json')) return null;
      return null;
    });

    await expect(reviewProjects()).rejects.toThrow('No analysis metadata found');
  });
});
