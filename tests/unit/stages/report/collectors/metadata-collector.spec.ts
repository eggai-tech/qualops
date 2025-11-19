import { jest } from '@jest/globals';

import type { AnalysisMetadata, ExtractLog, FixMetadata, ReviewMetadata } from '@/shared/types/index.ts';
import { collectIncrementalStats, collectMetadata } from '@/stages/report/collectors/metadata-collector.ts';

jest.mock('@/stages/report/utils/formatters.ts');

const createAnalysisMetadata = (projects: string[], files: string[]): AnalysisMetadata => ({
  timestamp: '2025-01-01T00:00:00Z',
  filePaths: files,
});

const createReviewMetadata = (
  filesReviewed: number,
  totalIssues: number,
  critical: number,
  high: number,
  medium: number,
  low: number,
): ReviewMetadata => {
  // Generate issues array matching the summary counts
  const issues: any[] = [];
  for (let i = 0; i < critical; i++) {
    issues.push({ severity: 'critical', id: `crit-${i}` });
  }
  for (let i = 0; i < high; i++) {
    issues.push({ severity: 'high', id: `high-${i}` });
  }
  for (let i = 0; i < medium; i++) {
    issues.push({ severity: 'medium', id: `med-${i}` });
  }
  for (let i = 0; i < low; i++) {
    issues.push({ severity: 'low', id: `low-${i}` });
  }

  return {
    timestamp: '2025-01-01T00:00:00Z',
    filesReviewed,
    issues,
    summary: {
      totalIssues,
      critical,
      high,
      medium,
      low,
      byType: {
        bug: critical,
        security: high,
        performance: medium,
        maintainability: low,
      },
    },
  };
};

const createFixMetadata = (
  totalSuggestions: number,
  overrides?: { highConfidence?: number; mediumConfidence?: number; lowConfidence?: number },
): FixMetadata => {
  const highConfidence = overrides?.highConfidence ?? Math.floor(totalSuggestions / 2);
  const mediumConfidence = overrides?.mediumConfidence ?? Math.floor(totalSuggestions / 4);
  const lowConfidence = overrides?.lowConfidence ?? totalSuggestions - highConfidence - mediumConfidence;

  return {
    timestamp: '2025-01-01T00:00:00Z',
    issuesProcessed: totalSuggestions,
    suggestions: [],
    summary: {
      totalSuggestions,
      highConfidence,
      mediumConfidence,
      lowConfidence,
      breaking: 0,
      applied: 0,
    },
  };
};

const createExtractLog = (fileConfigs: Array<{ name: string; processed: boolean }>): ExtractLog => {
  const files: ExtractLog['files'] = {};
  fileConfigs.forEach(({ name, processed }, index) => {
    files[name] = {
      hash: `hash${index}`,
      size: (index + 1) * 1024,
      lastModified: '2025-01-01T00:00:00Z',
      processed,
    };
  });
  return { timestamp: '2025-01-01T00:00:00Z', files };
};

describe('metadata-collector', () => {
  let mockGetQualityStatus: jest.Mock;

  beforeEach(async () => {
    jest.clearAllMocks();

    mockGetQualityStatus = jest.fn().mockReturnValue({
      status: 'PASSED',
      color: '#28a745',
      emoji: 'PASSED',
    });

    const formatters = await import('@/stages/report/utils/formatters.ts');
    (formatters.getQualityStatus as any) = mockGetQualityStatus;
  });

  describe('collectMetadata', () => {
    it('should collect metadata with all stages present', () => {
      const mockAnalysis = createAnalysisMetadata(
        ['project1', 'project2'],
        ['/path/to/file1.ts', '/path/to/file2.ts', '/path/to/file3.ts'],
      );
      const mockReview = createReviewMetadata(3, 7, 1, 2, 3, 1);
      const mockFix = createFixMetadata(4);

      mockGetQualityStatus.mockReturnValue({
        status: 'FAILED',
        color: '#dc3545',
        emoji: 'FAILED',
      });

      const result = collectMetadata(mockAnalysis, mockReview, mockFix);

      expect(result).toEqual({
        filesAnalyzed: 3,
        totalIssues: 7,
        critical: 1,
        high: 2,
        medium: 3,
        low: 1,
        fixSuggestions: 4,
        qualityStatus: 'FAILED',
      });

      expect(mockGetQualityStatus).toHaveBeenCalledWith({
        critical: 1,
        high: 2,
        medium: 3,
        low: 1,
      });
    });

    it('should handle custom confidence distributions in fix metadata', () => {
      const mockAnalysis = createAnalysisMetadata(['project1'], ['/path/to/file1.ts']);
      const mockReview = createReviewMetadata(1, 3, 0, 1, 2, 0);
      const mockFix = createFixMetadata(10, { highConfidence: 1, mediumConfidence: 2, lowConfidence: 7 });

      mockGetQualityStatus.mockReturnValue({
        status: 'WARNING',
        color: '#ffc107',
        emoji: 'WARNING',
      });

      const result = collectMetadata(mockAnalysis, mockReview, mockFix);

      expect(result).toEqual({
        filesAnalyzed: 1,
        totalIssues: 3,
        critical: 0,
        high: 1,
        medium: 2,
        low: 0,
        fixSuggestions: 10,
        qualityStatus: 'WARNING',
      });
    });

    describe.each([
      {
        name: 'all null metadata',
        analysis: null,
        review: null,
        fix: null,
      },
      {
        name: 'empty arrays in analysis metadata',
        analysis: createAnalysisMetadata([], []),
        review: createReviewMetadata(0, 0, 0, 0, 0, 0),
        fix: createFixMetadata(0),
      },
    ])('should handle $name', ({ analysis, review, fix }) => {
      it('returns zero values with PASSED status', () => {
        mockGetQualityStatus.mockReturnValue({
          status: 'PASSED',
          color: '#28a745',
          emoji: 'PASSED',
        });

        const result = collectMetadata(analysis, review, fix);

        expect(result).toEqual({
          filesAnalyzed: 0,
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          fixSuggestions: 0,
          qualityStatus: 'PASSED',
        });

        expect(mockGetQualityStatus).toHaveBeenCalledWith({
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        });
      });
    });

    describe.each([
      {
        name: 'null analysis',
        analysis: null,
        review: createReviewMetadata(3, 7, 0, 0, 2, 5),
        fix: createFixMetadata(3),
        expected: {
          filesAnalyzed: 0,
          totalIssues: 7,
          critical: 0,
          high: 0,
          medium: 2,
          low: 5,
          fixSuggestions: 3,
          qualityStatus: 'WARNING',
        },
      },
      {
        name: 'null review',
        analysis: createAnalysisMetadata(
          ['project1', 'project2', 'project3'],
          ['/path/to/file1.ts', '/path/to/file2.ts'],
        ),
        review: null,
        fix: createFixMetadata(0),
        expected: {
          filesAnalyzed: 2,
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          fixSuggestions: 0,
          qualityStatus: 'PASSED',
        },
      },
      {
        name: 'null fix',
        analysis: createAnalysisMetadata(['project1'], ['/path/to/file1.ts', '/path/to/file2.ts', '/path/to/file3.ts']),
        review: createReviewMetadata(3, 4, 2, 1, 1, 0),
        fix: null,
        expected: {
          filesAnalyzed: 3,
          totalIssues: 4,
          critical: 2,
          high: 1,
          medium: 1,
          low: 0,
          fixSuggestions: 0,
          qualityStatus: 'FAILED',
        },
      },
    ])('should handle $name metadata', ({ analysis, review, fix, expected }) => {
      it(`calculates correct values for ${expected.qualityStatus} status`, () => {
        mockGetQualityStatus.mockReturnValue({
          status: expected.qualityStatus,
          color: '#28a745',
          emoji: expected.qualityStatus,
        });

        const result = collectMetadata(analysis, review, fix);

        expect(result).toEqual(expected);
      });
    });
  });

  describe('collectIncrementalStats', () => {
    it('should return null when extractLog is null', () => {
      const result = collectIncrementalStats(null);

      expect(result).toBeNull();
    });

    it('should handle extract log with empty files object', () => {
      const mockExtractLog = createExtractLog([]);

      const result = collectIncrementalStats(mockExtractLog);

      expect(result).toEqual({
        totalFiles: 0,
        processedFiles: 0,
        savedFiles: 0,
        savedPercent: '0.0',
      });
    });

    describe.each([
      {
        name: 'mixed processed and unprocessed files',
        files: [
          { name: 'file1.ts', processed: true },
          { name: 'file2.ts', processed: false },
          { name: 'file3.ts', processed: true },
          { name: 'file4.ts', processed: false },
        ],
        expected: { totalFiles: 4, processedFiles: 2, savedFiles: 2, savedPercent: '50.0' },
      },
      {
        name: 'all files processed',
        files: [
          { name: 'file1.ts', processed: true },
          { name: 'file2.ts', processed: true },
          { name: 'file3.ts', processed: true },
        ],
        expected: { totalFiles: 3, processedFiles: 3, savedFiles: 0, savedPercent: '0.0' },
      },
      {
        name: 'no files processed',
        files: [
          { name: 'file1.ts', processed: false },
          { name: 'file2.ts', processed: false },
        ],
        expected: { totalFiles: 2, processedFiles: 0, savedFiles: 2, savedPercent: '100.0' },
      },
      {
        name: '1 out of 3 files saved',
        files: [
          { name: 'file1.ts', processed: true },
          { name: 'file2.ts', processed: true },
          { name: 'file3.ts', processed: false },
        ],
        expected: { totalFiles: 3, processedFiles: 2, savedFiles: 1, savedPercent: '33.3' },
      },
      {
        name: '5 out of 6 files saved',
        files: [
          { name: 'file1.ts', processed: true },
          { name: 'file2.ts', processed: false },
          { name: 'file3.ts', processed: false },
          { name: 'file4.ts', processed: false },
          { name: 'file5.ts', processed: false },
          { name: 'file6.ts', processed: false },
        ],
        expected: { totalFiles: 6, processedFiles: 1, savedFiles: 5, savedPercent: '83.3' },
      },
    ])('should calculate stats for $name', ({ files, expected }) => {
      it(`returns correct counts and percentage`, () => {
        const mockExtractLog = createExtractLog(files);

        const result = collectIncrementalStats(mockExtractLog);

        expect(result).toEqual(expected);
      });
    });

    it('should handle large numbers of files', () => {
      const files: Array<{ name: string; processed: boolean }> = [];
      for (let i = 0; i < 100; i++) {
        files.push({ name: `file${i}.ts`, processed: i % 2 === 0 });
      }

      const mockExtractLog = createExtractLog(files);

      const result = collectIncrementalStats(mockExtractLog);

      expect(result).toEqual({
        totalFiles: 100,
        processedFiles: 50,
        savedFiles: 50,
        savedPercent: '50.0',
      });
    });
  });
});
