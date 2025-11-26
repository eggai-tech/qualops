import { jest } from '@jest/globals';

import type { AnalysisMetadata, FixMetadata, ReviewIssue, ReviewMetadata } from '@/shared/types';
import { generateHTMLReport } from '@/stages/report/html-report';

jest.mock('@/config/config');
jest.mock('@/shared/runtime/session-context');
jest.mock('@/shared/utils/file-utils');
jest.mock('@/stages/report/generators/issues-generator');
jest.mock('@/stages/report/generators/summary-generator');
jest.mock('@/stages/report/templates/base-template');
jest.mock('@/stages/report/templates/components');
jest.mock('@/stages/report/utils/data-transformer');

const createMockIssue = (overrides: Partial<ReviewIssue> = {}): ReviewIssue => ({
  id: 'issue1',
  file: 'test.ts',
  line: 10,
  type: 'bug',
  severity: 'medium',
  description: 'Test description',
  location: 'test.ts:10',
  reasoning: 'Test reasoning',
  suggestion: 'Test suggestion',
  context: 'Test context',
  confidence: 0.8,
  knowledge_source: '',
  ...overrides,
});

describe('html-report', () => {
  let mockGetCurrentSessionPaths: jest.Mock;
  let mockReadMetadataFile: jest.Mock;
  let mockGenerateIssuesSection: jest.Mock;
  let mockGenerateSummary: jest.Mock;
  let mockGenerateBaseTemplate: jest.Mock;
  let mockGenerateFiltersSection: jest.Mock;
  let mockAggregateIssues: jest.Mock;
  let mockConfigService: any;

  beforeEach(async () => {
    jest.clearAllMocks();

    // Mock ConfigService to include all severities
    mockConfigService = {
      getInstance: jest.fn().mockReturnValue({
        getAll: jest.fn().mockReturnValue({
          report: {
            includedSeverities: ['critical', 'high', 'medium', 'low'],
          },
        }),
      }),
    };

    const configModule = await import('@/config/config');
    (configModule.ConfigService as any) = mockConfigService;

    mockGetCurrentSessionPaths = jest.fn().mockReturnValue({
      analysis: jest.fn().mockReturnValue('/path/to/analysis.json'),
      reviewSummary: jest.fn().mockReturnValue('/path/to/review.json'),
      fixSummary: jest.fn().mockReturnValue('/path/to/fix.json'),
      base: jest.fn().mockReturnValue('/base/path'),
    });

    const sessionContext = await import('@/shared/runtime/session-context');
    (sessionContext.getCurrentSessionPaths as any) = mockGetCurrentSessionPaths;

    mockReadMetadataFile = jest.fn();
    const fileUtils = await import('@/shared/utils/file-utils');
    (fileUtils.readMetadataFile as any) = mockReadMetadataFile;

    mockGenerateIssuesSection = jest.fn();
    const issuesGenerator = await import('@/stages/report/generators/issues-generator');
    (issuesGenerator.generateIssuesSection as any) = mockGenerateIssuesSection;

    mockGenerateSummary = jest.fn();
    const summaryGenerator = await import('@/stages/report/generators/summary-generator');
    (summaryGenerator.generateSummary as any) = mockGenerateSummary;

    mockGenerateBaseTemplate = jest.fn();
    const baseTemplate = await import('@/stages/report/templates/base-template');
    (baseTemplate.generateBaseTemplate as any) = mockGenerateBaseTemplate;

    mockGenerateFiltersSection = jest.fn();
    const components = await import('@/stages/report/templates/components');
    (components.generateFiltersSection as any) = mockGenerateFiltersSection;

    mockAggregateIssues = jest.fn();
    const dataTransformer = await import('@/stages/report/utils/data-transformer');
    (dataTransformer.aggregateIssues as any) = mockAggregateIssues;
  });

  describe('generateHTMLReport', () => {
    it('should generate complete HTML report with all metadata', async () => {
      const mockAnalysis: AnalysisMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filePaths: ['/path/to/file.ts'],
      };

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 5,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'bug',
            severity: 'high',
            knowledge_source: 'OWASP Security Guidelines',
          }),
          createMockIssue({
            id: 'issue2',
            file: 'test2.ts',
            line: 20,
            type: 'security',
            severity: 'critical',
            knowledge_source: 'Architecture Decision Records',
          }),
        ],
        summary: {
          totalIssues: 2,
          critical: 1,
          high: 1,
          medium: 0,
          low: 0,
          byType: {
            bug: 1,
            security: 1,
            performance: 0,
            maintainability: 0,
          },
        },
      };

      const mockFix: FixMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        issuesProcessed: 2,
        suggestions: [],
        summary: {
          totalSuggestions: 1,
          highConfidence: 1,
          mediumConfidence: 0,
          lowConfidence: 0,
          breaking: 0,
          applied: 0,
        },
      };

      const mockFixSuggestions = {
        suggestions: [
          {
            issueId: 'issue1',
            file: 'test.ts',
            line: 10,
            originalCode: 'old code',
            suggestedCode: 'new code',
            explanation: 'Fix explanation',
            confidence: 'high',
            breaking: false,
            applied: false,
          },
        ],
      };

      const mockMetadata = { projects: ['project1', 'project2'] };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(mockAnalysis)

        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(mockFix)
        .mockResolvedValueOnce(mockFixSuggestions)
        .mockResolvedValueOnce(mockMetadata);

      const mockSummaryData = {
        sessionName: 'Test Session',
        projectsList: 'project1, project2',
        statusClass: 'status-critical',
        summary: {
          totalIssues: 2,
          critical: 1,
          high: 1,
          medium: 0,
          low: 0,
        },
      };

      (mockGenerateSummary as any).mockReturnValue(mockSummaryData);
      (mockAggregateIssues as any).mockReturnValue({
        byType: { bug: [mockReview.issues[0]], security: [mockReview.issues[1]] },
      });
      (mockGenerateFiltersSection as any).mockReturnValue('<div>Filters</div>');
      (mockGenerateIssuesSection as any).mockResolvedValue('<div>Issues</div>');
      (mockGenerateBaseTemplate as any).mockReturnValue('<html>Report</html>');

      const result = await generateHTMLReport();

      expect(result).toBe('<html>Report</html>');
      expect(mockReadMetadataFile).toHaveBeenCalledTimes(5);
      expect(mockGenerateSummary).toHaveBeenCalledWith(
        mockAnalysis,
        mockReview,
        mockFix,
        mockMetadata,
        '/base/path',
      );
      expect(mockAggregateIssues).toHaveBeenCalledWith(mockReview);
      expect(mockGenerateFiltersSection).toHaveBeenCalled();
      expect(mockGenerateIssuesSection).toHaveBeenCalledWith(
        mockReview.issues,
        mockFixSuggestions,
        expect.any(Map),
      );
      expect(mockGenerateBaseTemplate).toHaveBeenCalledWith({
        sessionName: 'Test Session',
        projectsList: 'project1, project2',
        statusClass: 'status-critical',
        totalIssues: 2,
        critical: 1,
        high: 1,
        medium: 0,
        low: 0,
        filtersSection: '<div>Filters</div>',
        directoriesSection: '<div>Issues</div>',
      });
    });

    it('should throw error when review metadata is missing', async () => {
      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(generateHTMLReport()).rejects.toThrow(
        'Required metadata not found. Run analysis and review stages first.',
      );
    });

    it('should correctly categorize issues by knowledge source - OWASP', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'security',
            severity: 'high',
            knowledge_source: 'OWASP Top 10',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          byType: { bug: 0, security: 1, performance: 0, maintainability: 0 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-high',
        summary: { totalIssues: 1, critical: 0, high: 1, medium: 0, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.owasp).toHaveLength(1);
      expect(filterCall.issuesByKnowledgeSource.owasp[0].id).toBe('issue1');
    });

    it('should correctly categorize issues by knowledge source - ADR', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'maintainability',
            severity: 'medium',
            knowledge_source: 'Architecture Decision Records - ADR-001',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-medium',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 1, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.adr).toHaveLength(1);
    });

    it('should correctly categorize issues by knowledge source - Angular', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'performance',
            severity: 'low',
            knowledge_source: 'Angular Style Guide',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          byType: { bug: 0, security: 0, performance: 1, maintainability: 0 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-low',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 0, low: 1 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.angular).toHaveLength(1);
    });

    it('should correctly categorize issues by knowledge source - NgRx', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'maintainability',
            severity: 'medium',
            knowledge_source: 'NgRx best practices',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-medium',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 1, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.ngrx).toHaveLength(1);
    });

    it('should correctly categorize issues by knowledge source - RxJS', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'performance',
            severity: 'medium',
            knowledge_source: 'RxJS patterns',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          byType: { bug: 0, security: 0, performance: 1, maintainability: 0 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-medium',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 1, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.rxjs).toHaveLength(1);
    });

    it('should correctly categorize issues by knowledge source - Material', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'maintainability',
            severity: 'low',
            knowledge_source: 'Angular Material CDK guidelines',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-low',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 0, low: 1 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.material).toHaveLength(1);
    });

    it('should correctly categorize issues with no knowledge source', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'bug',
            severity: 'high',
            knowledge_source: '',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 1,
          medium: 0,
          low: 0,
          byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-high',
        summary: { totalIssues: 1, critical: 0, high: 1, medium: 0, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.none).toHaveLength(1);
    });

    it('should correctly categorize issues with other knowledge source', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'bug',
            severity: 'medium',
            knowledge_source: 'Custom internal guidelines',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 1,
          low: 0,
          byType: { bug: 1, security: 0, performance: 0, maintainability: 0 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-medium',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 1, low: 0 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.other).toHaveLength(1);
    });

    it('should exclude Angular Material from angular category', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'maintainability',
            severity: 'low',
            knowledge_source: 'Angular Material guidelines',
          }),
        ],
        summary: {
          totalIssues: 1,
          critical: 0,
          high: 0,
          medium: 0,
          low: 1,
          byType: { bug: 0, security: 0, performance: 0, maintainability: 1 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-low',
        summary: { totalIssues: 1, critical: 0, high: 0, medium: 0, low: 1 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.angular).toHaveLength(0);
      expect(filterCall.issuesByKnowledgeSource.material).toHaveLength(1);
    });

    it('should handle multiple issues with different knowledge sources', async () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: [
          createMockIssue({
            id: 'issue1',
            file: 'test.ts',
            line: 10,
            type: 'security',
            severity: 'critical',
            knowledge_source: 'OWASP',
          }),
          createMockIssue({
            id: 'issue2',
            file: 'test.ts',
            line: 20,
            type: 'maintainability',
            severity: 'medium',
            knowledge_source: 'ADR-001',
          }),
          createMockIssue({
            id: 'issue3',
            file: 'test.ts',
            line: 30,
            severity: 'low',
            knowledge_source: 'Angular docs',
          }),
        ],
        summary: {
          totalIssues: 3,
          critical: 1,
          high: 0,
          medium: 1,
          low: 1,
          byType: { bug: 0, security: 1, performance: 1, maintainability: 1 },
        },
      };

      (mockReadMetadataFile as any)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(mockReview)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      (mockGenerateSummary as any).mockReturnValue({
        sessionName: 'Test',
        projectsList: '',
        statusClass: 'status-critical',
        summary: { totalIssues: 3, critical: 1, high: 0, medium: 1, low: 1 },
      });
      (mockAggregateIssues as any).mockReturnValue({ byType: {} });
      (mockGenerateFiltersSection as any).mockReturnValue('');
      (mockGenerateIssuesSection as any).mockResolvedValue('');
      (mockGenerateBaseTemplate as any).mockReturnValue('');

      await generateHTMLReport();

      const filterCall = (mockGenerateFiltersSection as any).mock.calls[0][0];
      expect(filterCall.issuesByKnowledgeSource.owasp).toHaveLength(1);
      expect(filterCall.issuesByKnowledgeSource.adr).toHaveLength(1);
      expect(filterCall.issuesByKnowledgeSource.angular).toHaveLength(1);
      expect(filterCall.issuesByKnowledgeSource.ngrx).toHaveLength(0);
      expect(filterCall.issuesByKnowledgeSource.rxjs).toHaveLength(0);
      expect(filterCall.issuesByKnowledgeSource.material).toHaveLength(0);
      expect(filterCall.issuesByKnowledgeSource.other).toHaveLength(0);
      expect(filterCall.issuesByKnowledgeSource.none).toHaveLength(0);
    });
  });
});
