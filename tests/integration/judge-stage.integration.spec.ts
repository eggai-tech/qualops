import type { QualityThresholds, ReportMetadata } from '@/shared/types/index.ts';
import { judgeQuality } from '@/stages/judge/index.ts';

const mockGetCurrentSessionPaths = jest.fn();
const mockReadMetadataFile = jest.fn();
const mockEnvConfig = {
  get: jest.fn(),
};

jest.mock('@/shared/runtime/session-context.ts', () => ({
  getCurrentSessionPaths: (...args: unknown[]) => mockGetCurrentSessionPaths(...args),
}));

jest.mock('@/shared/utils/file-utils.ts', () => {
  const actual = jest.requireActual('../../shared/utils/file-utils.ts');
  return {
    ...actual,
    readMetadataFile: (...args: unknown[]) => mockReadMetadataFile(...args),
  };
});

jest.mock('@/config/env.ts', () => ({
  envConfig: {
    get: (...args: unknown[]) => mockEnvConfig.get(...args),
  },
}));

describe('Judge Stage Integration', () => {
  beforeEach(() => {
    mockGetCurrentSessionPaths.mockReturnValue({
      judgeDecision: () => '/test/.qualops/judge.json',
      overallReport: () => '/test/.qualops/report.json',
    });

    mockEnvConfig.get.mockReturnValue(undefined);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should return existing judge metadata if already completed', async () => {
    const existingJudge = {
      timestamp: new Date().toISOString(),
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
      detailedReport: 'Report content',
    };

    mockReadMetadataFile.mockResolvedValueOnce(existingJudge);

    const result = await judgeQuality();

    expect(result).toEqual(existingJudge);
  });

  it('should pass quality gate when no issues are found', async () => {
    const cleanReport: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 10,
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        fixSuggestions: 0,
        qualityStatus: 'PASSED',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: true,
      },
      sections: [],
      executionTime: 30000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(cleanReport);

    const result = await judgeQuality();

    expect(result.passed).toBe(true);
    expect(result.qualityStatus).toBe('PASSED');
    expect(result.summary.totalIssues).toBe(0);
    expect(result.reasons).toContain('All quality checks passed');
  });

  it('should fail quality gate when critical issues exceed threshold', async () => {
    const reportWithCritical: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 10,
        totalIssues: 3,
        critical: 3,
        high: 0,
        medium: 0,
        low: 0,
        fixSuggestions: 0,
        qualityStatus: 'FAILED',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: false,
      },
      sections: [],
      executionTime: 45000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(reportWithCritical);

    const result = await judgeQuality();

    expect(result.passed).toBe(false);
    expect(result.qualityStatus).toBe('FAILED');
    expect(result.summary.critical).toBe(3);
    expect(result.reasons.some((r) => r.includes('critical issues'))).toBe(true);
  });

  it('should fail quality gate when high issues exceed threshold', async () => {
    const reportWithHigh: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 5,
        critical: 0,
        high: 5,
        medium: 0,
        low: 0,
        fixSuggestions: 2,
        qualityStatus: 'FAILED',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: false,
      },
      sections: [],
      executionTime: 30000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(reportWithHigh);

    const result = await judgeQuality();

    expect(result.passed).toBe(false);
    expect(result.qualityStatus).toBe('FAILED');
    expect(result.summary.high).toBe(5);
    expect(result.reasons.some((r) => r.includes('high severity issues'))).toBe(true);
  });

  it('should warn about medium issues when failOnMedium is false', async () => {
    const reportWithMedium: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 25,
        critical: 0,
        high: 0,
        medium: 25,
        low: 0,
        fixSuggestions: 5,
        qualityStatus: 'WARNING',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: true,
      },
      sections: [],
      executionTime: 35000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(reportWithMedium);

    const result = await judgeQuality();

    expect(result.passed).toBe(true);
    expect(result.qualityStatus).toBe('PASSED');
    expect(result.warnings.some((w) => w.includes('medium severity issues'))).toBe(true);
  });

  it('should fail on medium issues when failOnMedium is true', async () => {
    const reportWithMedium: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 25,
        critical: 0,
        high: 0,
        medium: 25,
        low: 0,
        fixSuggestions: 5,
        qualityStatus: 'WARNING',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: false,
      },
      sections: [],
      executionTime: 35000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(reportWithMedium);

    const result = await judgeQuality({
      thresholds: {
        failOnMedium: true,
        maxMediumIssues: 20,
      },
    });

    expect(result.passed).toBe(false);
    expect(result.qualityStatus).toBe('FAILED');
    expect(result.reasons.some((r) => r.includes('medium severity issues'))).toBe(true);
  });

  it('should fail when required stages are missing', async () => {
    const reportWithMissingStages: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        fixSuggestions: 0,
        qualityStatus: 'PASSED',
      },
      stageResults: {
        analyze: true,
        review: false,
        fix: false,
      },
      sections: [],
      executionTime: 15000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(reportWithMissingStages);

    const result = await judgeQuality();

    expect(result.passed).toBe(false);
    expect(result.qualityStatus).toBe('FAILED');
    expect(result.reasons.some((r) => r.includes('Missing required stages'))).toBe(true);
  });

  it('should respect custom thresholds from options', async () => {
    const report: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 15,
        critical: 0,
        high: 0,
        medium: 15,
        low: 0,
        fixSuggestions: 0,
        qualityStatus: 'WARNING',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: false,
      },
      sections: [],
      executionTime: 30000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(report);

    const customThresholds: Partial<QualityThresholds> = {
      maxMediumIssues: 10,
      failOnMedium: true,
    };

    const result = await judgeQuality({ thresholds: customThresholds });

    expect(result.passed).toBe(false);
    expect(result.thresholds.maxMediumIssues).toBe(10);
    expect(result.thresholds.failOnMedium).toBe(true);
  });

  it('should load thresholds from environment config', async () => {
    mockEnvConfig.get.mockImplementation((key: string) => {
      const values: Record<string, number | boolean> = {
        maxCritical: 1,
        maxHigh: 5,
        maxMedium: 30,
        maxLow: 100,
        failOnMedium: true,
        failOnLow: false,
      };
      return values[key];
    });

    const report: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 5,
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        fixSuggestions: 0,
        qualityStatus: 'PASSED',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: false,
      },
      sections: [],
      executionTime: 25000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(report);

    const result = await judgeQuality();

    expect(result.thresholds.maxCriticalIssues).toBe(1);
    expect(result.thresholds.maxHighIssues).toBe(5);
    expect(result.thresholds.maxMediumIssues).toBe(30);
    expect(result.thresholds.maxLowIssues).toBe(100);
    expect(result.thresholds.failOnMedium).toBe(true);
  });

  it('should generate detailed report with recommendations', async () => {
    const report: ReportMetadata = {
      timestamp: new Date().toISOString(),
      summary: {
        filesAnalyzed: 10,
        totalIssues: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
        fixSuggestions: 3,
        qualityStatus: 'PASSED',
      },
      stageResults: {
        analyze: true,
        review: true,
        fix: true,
      },
      sections: [],
      executionTime: 40000,
    };

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(report);

    const result = await judgeQuality();

    expect(result.detailedReport).toContain('PASSED');
    expect(result.detailedReport).toContain('Recommendations');
    expect(result.detailedReport).toContain('automated fixes available');
  });

  it('should throw error if report is missing', async () => {
    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(null);

    await expect(judgeQuality()).rejects.toThrow('No report found');
  });

  it('should handle invalid report data gracefully', async () => {
    const invalidReport = {
      timestamp: new Date().toISOString(),
      summary: null,
      stageResults: null,
      sections: [],
      executionTime: 0,
    } as unknown as ReportMetadata;

    mockReadMetadataFile.mockResolvedValueOnce(null).mockResolvedValueOnce(invalidReport);

    const result = await judgeQuality();

    expect(result.passed).toBe(false);
    expect(result.reasons).toContain('Invalid or incomplete report data');
  });
});
