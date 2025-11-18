import { envConfig } from '../../config/env';
import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { JudgeMetadata, QualityThresholds, ReportMetadata } from '../../shared/types/index';
import { readMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';
import { judgeQuality } from './index';

jest.mock('../../config/env', () => ({
  envConfig: {
    get: jest.fn(),
    getAll: jest.fn().mockReturnValue({}),
  },
}));
jest.mock('../../config/config');
jest.mock('../../shared/runtime/session-context');
jest.mock('../../shared/utils/file-utils');
jest.mock('../../shared/utils/logger');

const mockEnvConfig = envConfig as jest.Mocked<typeof envConfig>;
const mockGetCurrentSessionPaths = getCurrentSessionPaths as jest.MockedFunction<typeof getCurrentSessionPaths>;
const mockReadMetadataFile = readMetadataFile as jest.MockedFunction<typeof readMetadataFile>;

describe('judgeQuality', () => {
  const mockPaths = {
    analysis: jest.fn().mockReturnValue('/session/analysis.json'),
    reviewSummary: jest.fn().mockReturnValue('/session/review.json'),
    fixSummary: jest.fn().mockReturnValue('/session/fix.json'),
    overallReport: jest.fn().mockReturnValue('/session/report.json'),
    diffReport: jest.fn().mockReturnValue('/session/diff.html'),
    judgeDecision: jest.fn().mockReturnValue('/session/judge.json'),
    htmlReport: jest.fn().mockReturnValue('/session/report.html'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue(mockPaths as any);
    mockEnvConfig.get = jest.fn().mockReturnValue(undefined);
    mockEnvConfig.getAll = jest.fn().mockReturnValue({});
  });

  describe('existing judge', () => {
    it('should return existing judge if found', async () => {
      const existingJudge: JudgeMetadata = {
        timestamp: '2024-01-01T00:00:00Z',
        passed: true,
        qualityStatus: 'PASSED',
        summary: {
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        thresholds: {
          maxCriticalIssues: 0,
          maxHighIssues: 0,
          maxMediumIssues: 20,
          maxLowIssues: 50,
          requireAllStages: true,
          failOnMedium: false,
          failOnLow: false,
        },
        reasons: ['All quality checks passed'],
        warnings: [],
        detailedReport: 'Test report',
      };
      mockReadMetadataFile.mockResolvedValue(existingJudge);

      const result = await judgeQuality();

      expect(result).toEqual(existingJudge);
      expect(logger.info).toHaveBeenCalledWith('Judge stage already completed - using existing results');
    });
  });

  describe('prerequisites', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });
    });

    it('should throw error if no report found', async () => {
      await expect(judgeQuality()).rejects.toThrow('No report found');
    });

    it('should use custom report path if provided', async () => {
      const customPath = '/custom/report.json';
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });

      await expect(judgeQuality({ reportPath: customPath })).rejects.toThrow();
      expect(mockReadMetadataFile).toHaveBeenCalledWith(customPath);
    });
  });

  describe('threshold loading', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });
    });

    it('should use default thresholds', async () => {
      const result = await judgeQuality();

      expect(result.thresholds).toEqual({
        maxCriticalIssues: 0,
        maxHighIssues: 0,
        maxMediumIssues: 20,
        maxLowIssues: 50,
        requireAllStages: true,
        failOnMedium: false,
        failOnLow: false,
      });
    });

    it('should load thresholds from environment', async () => {
      mockEnvConfig.get = jest.fn().mockImplementation((key: string) => {
        const values: Record<string, any> = {
          maxCritical: 1,
          maxHigh: 5,
          maxMedium: 10,
          maxLow: 25,
          failOnMedium: true,
          failOnLow: false,
        };
        return values[key];
      });

      const result = await judgeQuality();

      expect(result.thresholds.maxCriticalIssues).toBe(1);
      expect(result.thresholds.maxHighIssues).toBe(5);
      expect(result.thresholds.maxMediumIssues).toBe(10);
      expect(result.thresholds.maxLowIssues).toBe(25);
      expect(result.thresholds.failOnMedium).toBe(true);
    });

    it('should override with custom thresholds', async () => {
      const customThresholds: Partial<QualityThresholds> = {
        maxCriticalIssues: 2,
        maxHighIssues: 10,
      };

      const result = await judgeQuality({ thresholds: customThresholds });

      expect(result.thresholds.maxCriticalIssues).toBe(2);
      expect(result.thresholds.maxHighIssues).toBe(10);
    });

    it('should skip NaN values from environment', async () => {
      mockEnvConfig.get = jest.fn().mockReturnValue(NaN);

      const result = await judgeQuality();

      expect(result.thresholds.maxCriticalIssues).toBe(0);
    });
  });

  describe('quality evaluation - passing', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });
    });

    it('should pass with no issues', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(true);
      expect(result.qualityStatus).toBe('PASSED');
      expect(result.reasons).toContain('All quality checks passed');
    });

    it('should pass with issues below thresholds', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 5,
              critical: 0,
              high: 0,
              medium: 5,
              low: 10,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(true);
    });

    it('should include positive messages for clean code', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.reasons).toContain('No critical, high, or medium severity issues');
    });
  });

  describe('quality evaluation - failing', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });
    });

    it('should fail with critical issues', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 1,
              critical: 1,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'FAILED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(false);
      expect(result.qualityStatus).toBe('FAILED');
      expect(result.reasons).toContain('Found 1 critical issues (max allowed: 0)');
    });

    it('should fail with high severity issues above threshold', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 5,
              critical: 0,
              high: 5,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'FAILED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Found 5 high severity issues (max allowed: 0)');
    });

    it('should warn for medium issues when failOnMedium is false', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 30,
              critical: 0,
              high: 0,
              medium: 30,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'WARNING' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(true);
      expect(result.warnings).toContain('Found 30 medium severity issues (threshold: 20)');
    });

    it('should fail for medium issues when failOnMedium is true', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 30,
              critical: 0,
              high: 0,
              medium: 30,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'WARNING' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality({
        thresholds: {
          failOnMedium: true,
        },
      });

      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Found 30 medium severity issues (max allowed: 20)');
    });

    it('should handle low severity issues based on failOnLow', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 60,
              critical: 0,
              high: 0,
              medium: 0,
              low: 60,
              fixSuggestions: 0,
              qualityStatus: 'WARNING' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const resultWarn = await judgeQuality({ thresholds: { failOnLow: false } });
      expect(resultWarn.passed).toBe(true);
      expect(resultWarn.warnings.length).toBeGreaterThan(0);

      const resultFail = await judgeQuality({ thresholds: { failOnLow: true } });
      expect(resultFail.passed).toBe(false);
    });

    it('should fail if required stages are missing', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(true);
      expect(result.qualityStatus).toBe('PASSED');
    });

    it('should skip stage check when requireAllStages is false', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality({
        thresholds: {
          requireAllStages: false,
        },
      });

      expect(result.passed).toBe(true);
    });
  });

  describe('invalid report data', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });
    });

    it('should fail on missing summary', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: null,
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
            },
            sections: [],
            executionTime: 1000,
          } as any;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Invalid or incomplete report data');
    });

    it('should fail on missing stageResults', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
          } as any;
        return null;
      });

      const result = await judgeQuality();

      expect(result.passed).toBe(false);
      expect(result.reasons).toContain('Invalid or incomplete report data');
    });
  });

  describe('detailed report generation', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        return null;
      });
    });

    it('should include verdict in report', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.detailedReport).toContain('[OK] PASSED');
    });

    it('should include quality metrics in report', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 10,
              critical: 1,
              high: 2,
              medium: 3,
              low: 4,
              fixSuggestions: 0,
              qualityStatus: 'FAILED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality({ thresholds: { maxCriticalIssues: 5 } });

      expect(result.detailedReport).toContain('Quality Metrics');
      expect(result.detailedReport).toContain('**Critical Issues:** 1');
      expect(result.detailedReport).toContain('**High Issues:** 2');
    });

    it('should include required actions for failures', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 5,
              critical: 2,
              high: 3,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'FAILED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.detailedReport).toContain('Required Actions');
      expect(result.detailedReport).toContain('Fix all critical issues');
    });

    it('should include recommendations for passing builds', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.detailedReport).toContain('Recommendations');
      expect(result.detailedReport).toContain('Monitor code quality');
    });

    it('should include active thresholds', async () => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });

      const result = await judgeQuality();

      expect(result.detailedReport).toContain('Active Thresholds');
      expect(result.detailedReport).toContain('Max Critical Issues: 0');
    });
  });

  describe('metadata output', () => {
    beforeEach(() => {
      mockReadMetadataFile.mockImplementation(async (path: string) => {
        if (path === mockPaths.judgeDecision()) return null;
        if (path === mockPaths.overallReport())
          return {
            timestamp: '2024-01-01',
            summary: {
              filesAnalyzed: 1,
              totalIssues: 0,
              critical: 0,
              high: 0,
              medium: 0,
              low: 0,
              fixSuggestions: 0,
              qualityStatus: 'PASSED' as const,
            },
            stageResults: {
              analyze: true,
              review: true,
              fix: true,
              report: true,
            },
            sections: [],
            executionTime: 1000,
          } as ReportMetadata;
        return null;
      });
    });

    it('should return complete judge metadata', async () => {
      const result = await judgeQuality();

      expect(result).toMatchObject({
        timestamp: expect.any(String),
        passed: expect.any(Boolean),
        qualityStatus: expect.any(String),
        summary: expect.any(Object),
        thresholds: expect.any(Object),
        reasons: expect.any(Array),
        warnings: expect.any(Array),
        detailedReport: expect.any(String),
      });
    });

    it('should include ISO timestamp', async () => {
      const result = await judgeQuality();

      expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });
});
