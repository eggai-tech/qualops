import { getCurrentSessionPaths } from '@/shared/runtime/session-context';
import type { ReportMetadata } from '@/shared/types';
import { readMetadataFile } from '@/shared/utils/file-utils';
import { logger } from '@/shared/utils/logger';
import { collectAllStageData, getStageResults } from '@/stages/report/collectors/data-collector';
import { collectMetadata } from '@/stages/report/collectors/metadata-collector';
import { generateConsoleOutput } from '@/stages/report/generators/console-generator';
import {
  generateAnalysisSection,
  generateFixSection,
  generateMarkdownSummary,
  generateRecommendations,
  generateReviewSection,
} from '@/stages/report/generators/markdown-generator';
import { generateTokenUsageSection } from '@/stages/report/generators/token-generator';
import { generateHTMLReport } from '@/stages/report/html-report';
import { generateReport } from '@/stages/report/main';
import { writeHTMLReport } from '@/stages/report/utils/file-writer';

jest.mock('@/shared/runtime/session-context');
jest.mock('@/shared/utils/file-utils');
jest.mock('@/shared/utils/logger');
jest.mock('@/stages/report/collectors/data-collector');
jest.mock('@/stages/report/collectors/metadata-collector');
jest.mock('@/stages/report/generators/console-generator');
jest.mock('@/stages/report/generators/markdown-generator');
jest.mock('@/stages/report/generators/token-generator');
jest.mock('@/stages/report/html-report');
jest.mock('@/stages/report/utils/file-writer');

const mockGetCurrentSessionPaths = getCurrentSessionPaths as jest.MockedFunction<
  typeof getCurrentSessionPaths
>;
const mockReadMetadataFile = readMetadataFile as jest.MockedFunction<typeof readMetadataFile>;
const mockCollectAllStageData = collectAllStageData as jest.MockedFunction<
  typeof collectAllStageData
>;
const mockGetStageResults = getStageResults as jest.MockedFunction<typeof getStageResults>;
const mockCollectMetadata = collectMetadata as jest.MockedFunction<typeof collectMetadata>;
const mockGenerateConsoleOutput = generateConsoleOutput as jest.MockedFunction<
  typeof generateConsoleOutput
>;
const mockGenerateAnalysisSection = generateAnalysisSection as jest.MockedFunction<
  typeof generateAnalysisSection
>;
const mockGenerateFixSection = generateFixSection as jest.MockedFunction<typeof generateFixSection>;
const mockGenerateMarkdownSummary = generateMarkdownSummary as jest.MockedFunction<
  typeof generateMarkdownSummary
>;
const mockGenerateRecommendations = generateRecommendations as jest.MockedFunction<
  typeof generateRecommendations
>;
const mockGenerateReviewSection = generateReviewSection as jest.MockedFunction<
  typeof generateReviewSection
>;
const mockGenerateTokenUsageSection = generateTokenUsageSection as jest.MockedFunction<
  typeof generateTokenUsageSection
>;
const mockGenerateHTMLReport = generateHTMLReport as jest.MockedFunction<typeof generateHTMLReport>;
const mockWriteHTMLReport = writeHTMLReport as jest.MockedFunction<typeof writeHTMLReport>;

describe('generateReport', () => {
  const mockPaths = {
    analysis: jest.fn().mockReturnValue('/session/analysis.json'),
    reviewSummary: jest.fn().mockReturnValue('/session/review.json'),
    fixSummary: jest.fn().mockReturnValue('/session/fix.json'),
    overallReport: jest.fn().mockReturnValue('/session/report.json'),
    diffReport: jest.fn().mockReturnValue('/session/diff.html'),
    judgeDecision: jest.fn().mockReturnValue('/session/judge.json'),
    htmlReport: jest.fn().mockReturnValue('/session/report.html'),
  };

  const mockCollectedData = {
    analysis: {
      timestamp: '2024-01-01',
      filePaths: ['file1.ts'],
      executionTime: 1000,
    },
    review: {
      timestamp: '2024-01-01',
      filesReviewed: 1,
      projectsReviewed: 1,
      issues: [],
      summary: {
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        byType: {
          bug: 0,
          security: 0,
          performance: 0,
          maintainability: 0,
        },
      },
    },
    fix: {
      timestamp: '2024-01-01',
      issuesProcessed: 0,
      suggestions: [],
      summary: {
        totalSuggestions: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        breaking: 0,
        applied: 0,
      },
    },
    extractLog: {
      files: {},
    },
  };

  const mockSummary = {
    totalIssues: 0,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    filesAnalyzed: 1,
    fixSuggestions: 0,
    qualityStatus: 'PASSED' as const,
  };

  const mockStageResults = {
    analyze: true,
    review: true,
    fix: true,
    report: true,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue(mockPaths as any);
    mockCollectAllStageData.mockResolvedValue(mockCollectedData as any);
    mockGetStageResults.mockReturnValue(mockStageResults);
    mockCollectMetadata.mockReturnValue(mockSummary);
    mockGenerateAnalysisSection.mockReturnValue({ title: 'Analysis', content: 'Analysis content' });
    mockGenerateReviewSection.mockReturnValue({ title: 'Review', content: 'Review content' });
    mockGenerateFixSection.mockReturnValue({ title: 'Fix', content: 'Fix content' });
    mockGenerateTokenUsageSection.mockReturnValue({
      title: 'Token Usage',
      content: 'Token content',
    });
    mockGenerateRecommendations.mockReturnValue({
      title: 'Recommendations',
      content: 'Recommendations content',
    });
    mockGenerateMarkdownSummary.mockReturnValue('# Report Summary');
    mockGenerateHTMLReport.mockResolvedValue('<html>Report</html>');
    mockWriteHTMLReport.mockResolvedValue('/session/report.html');
    mockGenerateConsoleOutput.mockReturnValue(undefined);
  });

  describe('existing report', () => {
    it('should return existing report if found', async () => {
      const existingReport: ReportMetadata = {
        timestamp: '2024-01-01T00:00:00Z',
        summary: mockSummary,
        sections: [],
        executionTime: 1000,
        stageResults: mockStageResults,
      };
      mockReadMetadataFile.mockResolvedValue(existingReport);

      const result = await generateReport();

      expect(result).toEqual(existingReport);
      expect(logger.info).toHaveBeenCalledWith(
        'Report stage already completed - using existing results',
      );
    });

    it('should not collect data if existing report found', async () => {
      mockReadMetadataFile.mockResolvedValue({ timestamp: '2024-01-01' } as any);

      await generateReport();

      expect(mockCollectAllStageData).not.toHaveBeenCalled();
    });
  });

  describe('data collection', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should collect all stage data', async () => {
      await generateReport();

      expect(mockCollectAllStageData).toHaveBeenCalled();
    });

    it('should collect metadata summary', async () => {
      await generateReport();

      expect(mockCollectMetadata).toHaveBeenCalledWith(
        mockCollectedData.analysis,
        mockCollectedData.review,
        mockCollectedData.fix,
      );
    });

    it('should get stage results', async () => {
      await generateReport();

      expect(mockGetStageResults).toHaveBeenCalledWith(mockCollectedData);
    });
  });

  describe('section generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should generate analysis section', async () => {
      await generateReport();

      expect(mockGenerateAnalysisSection).toHaveBeenCalledWith(
        mockCollectedData.analysis,
        mockCollectedData.extractLog,
      );
    });

    it('should generate review section', async () => {
      await generateReport();

      expect(mockGenerateReviewSection).toHaveBeenCalledWith(mockCollectedData.review);
    });

    it('should generate fix section', async () => {
      await generateReport();

      expect(mockGenerateFixSection).toHaveBeenCalledWith(mockCollectedData.fix);
    });

    it('should generate token usage section', async () => {
      await generateReport();

      expect(mockGenerateTokenUsageSection).toHaveBeenCalled();
    });

    it('should generate recommendations section', async () => {
      await generateReport();

      expect(mockGenerateRecommendations).toHaveBeenCalled();
    });

    it('should include all sections in report', async () => {
      const result = await generateReport();

      expect(result.sections.length).toBeGreaterThan(0);
    });
  });

  describe('markdown generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should generate markdown summary', async () => {
      const result = await generateReport();

      expect(mockGenerateMarkdownSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: mockSummary,
          stageResults: mockStageResults,
        }),
      );
      expect(result.markdownReport).toBe('# Report Summary');
    });

    it('should include markdown in report metadata', async () => {
      const result = await generateReport();

      expect(result.markdownReport).toBeDefined();
      expect(typeof result.markdownReport).toBe('string');
    });
  });

  describe('HTML generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should generate HTML report', async () => {
      await generateReport();

      expect(mockGenerateHTMLReport).toHaveBeenCalled();
    });

    it('should write HTML report to file', async () => {
      await generateReport();

      expect(mockWriteHTMLReport).toHaveBeenCalledWith('<html>Report</html>');
    });

    it('should include HTML in report metadata', async () => {
      const result = await generateReport();

      expect(result.htmlReport).toBe('<html>Report</html>');
    });
  });

  describe('console output', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should generate console output', async () => {
      await generateReport();

      expect(mockGenerateConsoleOutput).toHaveBeenCalled();
    });

    it('should pass complete report to console generator', async () => {
      await generateReport();

      expect(mockGenerateConsoleOutput).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: mockSummary,
          stageResults: mockStageResults,
          sections: expect.any(Array),
        }),
      );
    });
  });

  describe('metadata output', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should return complete report metadata', async () => {
      const result = await generateReport();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        summary: mockSummary,
        sections: expect.any(Array),
        executionTime: expect.any(Number),
        stageResults: mockStageResults,
        markdownReport: expect.any(String),
        htmlReport: expect.any(String),
      });
    });

    it('should include ISO timestamp', async () => {
      const result = await generateReport();

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('should calculate execution time', async () => {
      const result = await generateReport();

      expect(result.executionTime).toBeGreaterThanOrEqual(0);
    });
  });

  describe('logging', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should log report generation start', async () => {
      await generateReport();

      expect(logger.start).toHaveBeenCalledWith('Generating comprehensive QualOps report...');
    });
  });

  describe('error handling', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should handle data collection errors', async () => {
      mockCollectAllStageData.mockRejectedValue(new Error('Collection failed'));

      await expect(generateReport()).rejects.toThrow('Collection failed');
    });

    it('should handle HTML generation errors', async () => {
      mockGenerateHTMLReport.mockRejectedValue(new Error('HTML generation failed'));

      await expect(generateReport()).rejects.toThrow('HTML generation failed');
    });

    it('should handle HTML write errors', async () => {
      mockWriteHTMLReport.mockRejectedValue(new Error('Write failed'));

      await expect(generateReport()).rejects.toThrow('Write failed');
    });
  });

  describe('section ordering', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should add recommendations after initial sections', async () => {
      const result = await generateReport();

      const recommendationSection = result.sections.find((s) => s.title === 'Recommendations');
      expect(recommendationSection).toBeDefined();
    });

    it('should generate sections in correct order', async () => {
      await generateReport();

      expect(mockGenerateAnalysisSection).toHaveBeenCalled();
      expect(mockGenerateReviewSection).toHaveBeenCalled();
      expect(mockGenerateFixSection).toHaveBeenCalled();
      expect(mockGenerateTokenUsageSection).toHaveBeenCalled();
    });
  });

  describe('integration', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should complete full report generation flow', async () => {
      const result = await generateReport();

      expect(mockCollectAllStageData).toHaveBeenCalled();
      expect(mockCollectMetadata).toHaveBeenCalled();
      expect(mockGenerateAnalysisSection).toHaveBeenCalled();
      expect(mockGenerateReviewSection).toHaveBeenCalled();
      expect(mockGenerateFixSection).toHaveBeenCalled();
      expect(mockGenerateTokenUsageSection).toHaveBeenCalled();
      expect(mockGenerateRecommendations).toHaveBeenCalled();
      expect(mockGenerateMarkdownSummary).toHaveBeenCalled();
      expect(mockGenerateHTMLReport).toHaveBeenCalled();
      expect(mockWriteHTMLReport).toHaveBeenCalled();
      expect(mockGenerateConsoleOutput).toHaveBeenCalled();

      expect(result).toBeDefined();
      expect(result.sections.length).toBeGreaterThan(0);
    });

    it('should pass data correctly between components', async () => {
      const result = await generateReport();

      expect(mockGenerateMarkdownSummary).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: result.summary,
          sections: result.sections,
        }),
      );

      expect(mockGenerateConsoleOutput).toHaveBeenCalledWith(result);
    });
  });

  describe('empty data handling', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockResolvedValue(null);
    });

    it('should handle empty analysis data', async () => {
      mockCollectAllStageData.mockResolvedValue({
        ...mockCollectedData,
        analysis: null,
      } as any);

      const result = await generateReport();

      expect(result).toBeDefined();
    });

    it('should handle empty review data', async () => {
      mockCollectAllStageData.mockResolvedValue({
        ...mockCollectedData,
        review: null,
      } as any);

      const result = await generateReport();

      expect(result).toBeDefined();
    });

    it('should handle empty fix data', async () => {
      mockCollectAllStageData.mockResolvedValue({
        ...mockCollectedData,
        fix: null,
      } as any);

      const result = await generateReport();

      expect(result).toBeDefined();
    });
  });
});
