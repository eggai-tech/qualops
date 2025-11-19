import type { ExtractLog } from '@/stages/analyze/utils/extract-log.ts';
import { processBatchForAnalysis } from '@/stages/analyze/processors/batch-processor.ts';

jest.mock('@/shared/utils/filters.ts');
jest.mock('@/shared/utils/logger.ts');
jest.mock('@/stages/analyze/processors/file-processor.ts');

const mockShouldProcessFile = jest.fn();
const mockPrepareFilesForProcessing = jest.fn();

jest.mock('@/shared/utils/filters.ts', () => ({
  shouldProcessFile: (...args: unknown[]) => mockShouldProcessFile(...args),
}));

jest.mock('@/stages/analyze/processors/file-processor.ts', () => ({
  prepareFilesForProcessing: (...args: unknown[]) => mockPrepareFilesForProcessing(...args),
}));

describe('processBatchForAnalysis', () => {
  const mockExtractLog: ExtractLog = {
    timestamp: new Date().toISOString(),
    files: {},
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldProcessFile.mockReturnValue(true);
    mockPrepareFilesForProcessing.mockResolvedValue({
      validFiles: [],
      skippedCount: 0,
    });
  });

  it('should throw error for unknown analysis mode', async () => {
    const files = ['file1.ts', 'file2.ts'];

    await expect(processBatchForAnalysis(files, mockExtractLog, 'invalid' as any)).rejects.toThrow(
      'Unknown analysis mode: invalid',
    );
  });

  it('should handle files mode', async () => {
    const files = ['src/file1.ts', 'src/file2.ts', 'src/file3.js'];
    mockPrepareFilesForProcessing.mockResolvedValue({
      validFiles: ['src/file1.ts', 'src/file2.ts'],
      skippedCount: 0,
    });

    const result = await processBatchForAnalysis(files, mockExtractLog, 'files');

    expect(mockPrepareFilesForProcessing).toHaveBeenCalled();
    expect(result.validFiles).toEqual(['src/file1.ts', 'src/file2.ts']);
  });

  it('should handle projects mode', async () => {
    const files = ['src/file1.ts', 'src/file2.ts'];
    mockPrepareFilesForProcessing.mockResolvedValue({
      validFiles: files,
      skippedCount: 0,
    });

    const result = await processBatchForAnalysis(files, mockExtractLog, 'projects');

    expect(mockPrepareFilesForProcessing).toHaveBeenCalledWith(files, mockExtractLog);
    expect(result.validFiles).toEqual(files);
  });

  it('should handle git mode', async () => {
    const files = ['src/changed1.ts', 'src/changed2.ts'];
    mockPrepareFilesForProcessing.mockResolvedValue({
      validFiles: files,
      skippedCount: 0,
    });

    const result = await processBatchForAnalysis(files, mockExtractLog, 'git');

    expect(mockPrepareFilesForProcessing).toHaveBeenCalledWith(files, mockExtractLog);
    expect(result.validFiles).toEqual(files);
  });

  it('should return empty result when no files provided', async () => {
    const result = await processBatchForAnalysis([], mockExtractLog, 'files');

    expect(result.validFiles).toEqual([]);
    expect(result.skippedCount).toBe(0);
  });

  it('should return empty result when all files filtered out', async () => {
    mockShouldProcessFile.mockReturnValue(false);
    const files = ['file1.ts', 'file2.ts'];

    const result = await processBatchForAnalysis(files, mockExtractLog, 'files');

    expect(result.validFiles).toEqual([]);
    expect(result.skippedCount).toBe(0);
    expect(mockPrepareFilesForProcessing).not.toHaveBeenCalled();
  });
});
