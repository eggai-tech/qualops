import * as sessionContext from '@/shared/runtime/session-context';
import { withErrorHandling } from '@/shared/utils/error-handling';
import * as fileUtils from '@/shared/utils/file-utils';
import * as logger from '@/shared/utils/logger';

jest.mock('@/shared/utils/file-utils');
jest.mock('@/shared/utils/logger');
jest.mock('@/shared/runtime/session-context');
jest.mock('@/config/config', () => ({
  CRITICAL_STAGES: ['analyze', 'report'],
}));

const mockWriteMetadataFile = fileUtils.writeMetadataFile as jest.MockedFunction<
  typeof fileUtils.writeMetadataFile
>;
const mockGetCurrentSessionPaths = sessionContext.getCurrentSessionPaths as jest.MockedFunction<
  typeof sessionContext.getCurrentSessionPaths
>;
const mockLoggerInfo = logger.logger.info as jest.MockedFunction<typeof logger.logger.info>;
const mockLoggerError = logger.logger.error as jest.MockedFunction<typeof logger.logger.error>;

describe('withErrorHandling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue({
      errorLog: (stage: string) => `/session/error-${stage}.json`,
      base: () => '/session',
      reportRoot: () => '/reports',
      issuesDir: () => '/reports/issues',
      issues: () => '/reports/issues',
      analysis: () => '/session/analysis.json',
      reviewSummary: () => '/session/review-summary.json',
      rootCauseMetadata: () => '/session/root-cause-metadata.json',
      fixSummary: () => '/session/fix-summary.json',
      overallReport: () => '/session/overall-report.json',
      judgeDecision: () => '/session/judge-decision.json',
      cache: () => '/session/cache.json',
      extractLog: () => '/session/extract-log.json',
      diffReport: () => '/session/diff-report.html',
      tokenStats: () => '/session/token-stats.json',
      metadata: () => '/session/metadata.json',
      sessionReport: () => '/session/report.html',
      mainReport: () => '/reports/index.html',
      timingStats: () => '/session/timing-stats.json',
    });
  });

  it('should return success with result when operation succeeds', async () => {
    const mockFn = jest.fn().mockResolvedValue('success result');

    const result = await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(result).toEqual({ success: true, result: 'success result' });
    expect(mockFn).toHaveBeenCalled();
  });

  it('should log start and completion messages', async () => {
    const mockFn = jest.fn().mockResolvedValue('result');

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(mockLoggerInfo).toHaveBeenCalledWith('test-stage: Starting test-operation');
    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringMatching(/test-stage: Completed in \d+ms/),
    );
  });

  it('should return failure without result when operation fails', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('operation failed'));
    mockWriteMetadataFile.mockResolvedValue();

    const result = await withErrorHandling('non-critical', 'test-operation', mockFn);

    expect(result).toEqual({ success: false });
    expect(result.result).toBeUndefined();
  });

  it('should log error message on failure', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('operation failed'));
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('non-critical', 'test-operation', mockFn);

    expect(mockLoggerError).toHaveBeenCalledWith('non-critical: Failed - operation failed');
  });

  it('should write error metadata on failure', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('operation failed'));
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith('/session/error-test-stage.json', {
      stage: 'test-stage',
      operation: 'test-operation',
      error: 'operation failed',
      stack: expect.any(String),
      timestamp: expect.stringMatching(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/),
      duration: expect.any(Number),
    });
  });

  it('should include stack trace in error metadata', async () => {
    const error = new Error('test error');
    const mockFn = jest.fn().mockRejectedValue(error);
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    const callArg = mockWriteMetadataFile.mock.calls[0][1] as any;
    expect(callArg.stack).toBeDefined();
    expect(callArg.stack).toContain('Error: test error');
  });

  it('should handle non-Error rejections', async () => {
    const mockFn = jest.fn().mockRejectedValue('string error');
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(
      '/session/error-test-stage.json',
      expect.objectContaining({
        error: 'string error',
        stack: undefined,
      }),
    );
  });

  it('should continue when metadata write fails', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('operation failed'));
    mockWriteMetadataFile.mockRejectedValue(new Error('write failed'));

    const result = await withErrorHandling('non-critical', 'test-operation', mockFn);

    expect(result).toEqual({ success: false });
  });

  it('should throw error for critical stage failures', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('critical failure'));
    mockWriteMetadataFile.mockResolvedValue();

    await expect(withErrorHandling('analyze', 'test-operation', mockFn)).rejects.toThrow(
      'Critical stage failed: analyze',
    );
  });

  it('should throw error for report stage failures', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('report failure'));
    mockWriteMetadataFile.mockResolvedValue();

    await expect(withErrorHandling('report', 'test-operation', mockFn)).rejects.toThrow(
      'Critical stage failed: report',
    );
  });

  it('should not throw for non-critical stage failures', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('non-critical failure'));
    mockWriteMetadataFile.mockResolvedValue();

    await expect(withErrorHandling('extract', 'test-operation', mockFn)).resolves.toEqual({
      success: false,
    });
  });

  it('should measure operation duration', async () => {
    const mockFn = jest
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve('done'), 10)));

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(mockLoggerInfo).toHaveBeenCalledWith(expect.stringMatching(/Completed in \d+ms/));
  });

  it('should measure duration even on failure', async () => {
    const mockFn = jest
      .fn()
      .mockImplementation(
        () => new Promise((_, reject) => setTimeout(() => reject(new Error('fail')), 10)),
      );
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('non-critical', 'test-operation', mockFn);

    const callArg = mockWriteMetadataFile.mock.calls[0][1] as any;
    expect(callArg.duration).toBeGreaterThan(0);
  });

  it('should include timestamp in ISO format', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('fail'));
    mockWriteMetadataFile.mockResolvedValue();

    const beforeTime = new Date().toISOString();
    await withErrorHandling('non-critical', 'test-operation', mockFn);
    const afterTime = new Date().toISOString();

    const callArg = mockWriteMetadataFile.mock.calls[0][1] as any;
    expect(callArg.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(callArg.timestamp >= beforeTime).toBe(true);
    expect(callArg.timestamp <= afterTime).toBe(true);
  });

  it('should preserve original error when critical stage fails', async () => {
    const originalError = new Error('original error');
    const mockFn = jest.fn().mockRejectedValue(originalError);
    mockWriteMetadataFile.mockResolvedValue();

    let error: Error | undefined;

    try {
      await withErrorHandling('analyze', 'test-operation', mockFn);
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeDefined();
    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Critical stage failed: analyze');
  });

  it('should handle async function that returns undefined', async () => {
    const mockFn = jest.fn().mockResolvedValue(undefined);

    const result = await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(result).toEqual({ success: true, result: undefined });
  });

  it('should handle async function that returns null', async () => {
    const mockFn = jest.fn().mockResolvedValue(null);

    const result = await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(result).toEqual({ success: true, result: null });
  });

  it('should handle async function that returns complex objects', async () => {
    const complexResult = { data: [1, 2, 3], meta: { count: 3 } };
    const mockFn = jest.fn().mockResolvedValue(complexResult);

    const result = await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(result).toEqual({ success: true, result: complexResult });
  });

  it('should use correct error log path for stage', async () => {
    const mockFn = jest.fn().mockRejectedValue(new Error('fail'));
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('custom-stage', 'test-operation', mockFn);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(
      '/session/error-custom-stage.json',
      expect.any(Object),
    );
  });

  it('should call function exactly once', async () => {
    const mockFn = jest.fn().mockResolvedValue('result');

    await withErrorHandling('test-stage', 'test-operation', mockFn);

    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should handle null error objects', async () => {
    const mockFn = jest.fn().mockRejectedValue(null);
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('non-critical', 'test-operation', mockFn);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(
      '/session/error-non-critical.json',
      expect.objectContaining({
        error: 'null',
        stack: undefined,
      }),
    );
  });

  it('should handle number error rejections', async () => {
    const mockFn = jest.fn().mockRejectedValue(42);
    mockWriteMetadataFile.mockResolvedValue();

    await withErrorHandling('non-critical', 'test-operation', mockFn);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(
      '/session/error-non-critical.json',
      expect.objectContaining({
        error: '42',
      }),
    );
  });
});
