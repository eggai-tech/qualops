import { stat } from 'node:fs/promises';

import { logger } from '../../../shared/utils/logger';
import { calculateFileHash, type ExtractLog } from '../utils/extract-log';
import { prepareFilesForProcessing, processFile } from './file-processor';

jest.mock('node:fs/promises');
jest.mock('../../../shared/utils/logger');
jest.mock('../utils/extract-log');

const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockCalculateFileHash = calculateFileHash as jest.MockedFunction<typeof calculateFileHash>;

describe('processFile', () => {
  let extractLog: ExtractLog;

  beforeEach(() => {
    jest.clearAllMocks();
    extractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
  });

  it('should process file successfully and add to extract log', async () => {
    const mockDate = new Date('2025-01-01T12:00:00.000Z');
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: mockDate,
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('abc123hash');

    const result = await processFile('/project/file.ts', extractLog);

    expect(result).toBe(true);
    expect(mockStat).toHaveBeenCalledWith('/project/file.ts');
    expect(mockCalculateFileHash).toHaveBeenCalledWith('/project/file.ts');
    expect(extractLog.files['/project/file.ts']).toEqual({
      hash: 'abc123hash',
      size: 1024,
      lastModified: '2025-01-01T12:00:00.000Z',
      processed: false,
    });
  });

  it('should set processed to false initially', async () => {
    mockStat.mockResolvedValue({
      size: 2048,
      mtime: new Date('2025-01-02T00:00:00.000Z'),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('def456hash');

    await processFile('/project/new-file.ts', extractLog);

    expect(extractLog.files['/project/new-file.ts'].processed).toBe(false);
  });

  it('should return false and log warning when stat fails', async () => {
    const error = new Error('File not found');
    mockStat.mockRejectedValue(error);

    const result = await processFile('/project/missing.ts', extractLog);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to process file'), 'File not found');
    expect(extractLog.files).not.toHaveProperty('/project/missing.ts');
  });

  it('should return false and log warning when hash calculation fails', async () => {
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    const error = new Error('Hash calculation failed');
    mockCalculateFileHash.mockRejectedValue(error);

    const result = await processFile('/project/file.ts', extractLog);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to process file'),
      'Hash calculation failed',
    );
    expect(extractLog.files).not.toHaveProperty('/project/file.ts');
  });

  it('should handle ENOENT error', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockStat.mockRejectedValue(error);

    const result = await processFile('/project/missing.ts', extractLog);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it('should handle permission denied error', async () => {
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockStat.mockRejectedValue(error);

    const result = await processFile('/project/restricted.ts', extractLog);

    expect(result).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('/project/restricted.ts'),
      'Permission denied',
    );
  });

  it('should handle file with zero size', async () => {
    mockStat.mockResolvedValue({
      size: 0,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('emptyhash');

    const result = await processFile('/project/empty.ts', extractLog);

    expect(result).toBe(true);
    expect(extractLog.files['/project/empty.ts'].size).toBe(0);
  });

  it('should handle very large file', async () => {
    mockStat.mockResolvedValue({
      size: 10 * 1024 * 1024,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('largehash');

    const result = await processFile('/project/large.ts', extractLog);

    expect(result).toBe(true);
    expect(extractLog.files['/project/large.ts'].size).toBe(10 * 1024 * 1024);
  });

  it('should overwrite existing entry in extract log', async () => {
    extractLog.files['/project/file.ts'] = {
      hash: 'oldhash',
      size: 500,
      lastModified: '2024-12-01T00:00:00.000Z',
      processed: true,
    };

    mockStat.mockResolvedValue({
      size: 1024,
      mtime: new Date('2025-01-01T00:00:00.000Z'),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('newhash');

    await processFile('/project/file.ts', extractLog);

    expect(extractLog.files['/project/file.ts']).toEqual({
      hash: 'newhash',
      size: 1024,
      lastModified: '2025-01-01T00:00:00.000Z',
      processed: false,
    });
  });

  it('should format mtime as ISO string', async () => {
    const mockDate = new Date('2025-03-15T14:30:45.123Z');
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: mockDate,
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('hash');

    await processFile('/project/file.ts', extractLog);

    expect(extractLog.files['/project/file.ts'].lastModified).toBe('2025-03-15T14:30:45.123Z');
  });

  it('should not modify extract log when processing fails', async () => {
    const initialFiles = { ...extractLog.files };
    mockStat.mockRejectedValue(new Error('Stat failed'));

    await processFile('/project/file.ts', extractLog);

    expect(extractLog.files).toEqual(initialFiles);
  });
});

describe('prepareFilesForProcessing', () => {
  let extractLog: ExtractLog;

  beforeEach(() => {
    jest.clearAllMocks();
    extractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
  });

  it('should process all valid files', async () => {
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValueOnce('hash1').mockResolvedValueOnce('hash2').mockResolvedValueOnce('hash3');

    const files = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result).toEqual({
      validFiles: files,
      skippedCount: 0,
    });
    expect(Object.keys(extractLog.files)).toHaveLength(3);
  });

  it('should skip failed files and count them', async () => {
    mockStat
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any);
    mockCalculateFileHash.mockResolvedValueOnce('hash1').mockResolvedValueOnce('hash2');

    const files = ['/project/file1.ts', '/project/missing.ts', '/project/file3.ts'];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result).toEqual({
      validFiles: ['/project/file1.ts', '/project/file3.ts'],
      skippedCount: 1,
    });
    expect(Object.keys(extractLog.files)).toHaveLength(2);
  });

  it('should return empty array when all files fail', async () => {
    mockStat.mockRejectedValue(new Error('All failed'));

    const files = ['/project/file1.ts', '/project/file2.ts'];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result).toEqual({
      validFiles: [],
      skippedCount: 2,
    });
    expect(Object.keys(extractLog.files)).toHaveLength(0);
  });

  it('should handle empty file list', async () => {
    const result = await prepareFilesForProcessing([], extractLog);

    expect(result).toEqual({
      validFiles: [],
      skippedCount: 0,
    });
    expect(mockStat).not.toHaveBeenCalled();
  });

  it('should process files sequentially', async () => {
    const callOrder: string[] = [];

    mockStat.mockImplementation((path: any) => {
      callOrder.push(path);
      return Promise.resolve({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any);
    });
    mockCalculateFileHash.mockResolvedValue('hash');

    const files = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    await prepareFilesForProcessing(files, extractLog);

    expect(callOrder).toEqual(files);
  });

  it('should count multiple skipped files correctly', async () => {
    mockStat
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('Failed'))
      .mockRejectedValueOnce(new Error('Failed'))
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('Failed'));
    mockCalculateFileHash.mockResolvedValue('hash');

    const files = [
      '/project/file1.ts',
      '/project/file2.ts',
      '/project/file3.ts',
      '/project/file4.ts',
      '/project/file5.ts',
    ];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result.skippedCount).toBe(3);
    expect(result.validFiles).toHaveLength(2);
  });

  it('should preserve order of valid files', async () => {
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('hash');

    const files = ['/project/z.ts', '/project/a.ts', '/project/m.ts'];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result.validFiles).toEqual(files);
  });

  it('should handle single file', async () => {
    mockStat.mockResolvedValue({
      size: 1024,
      mtime: new Date(),
      isFile: () => true,
    } as any);
    mockCalculateFileHash.mockResolvedValue('hash');

    const result = await prepareFilesForProcessing(['/project/file.ts'], extractLog);

    expect(result).toEqual({
      validFiles: ['/project/file.ts'],
      skippedCount: 0,
    });
  });

  it('should handle mixed success and failure', async () => {
    mockStat
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({
        size: 2048,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce({
        size: 512,
        mtime: new Date(),
        isFile: () => true,
      } as any);
    mockCalculateFileHash.mockResolvedValue('hash');

    const files = [
      '/project/valid1.ts',
      '/project/missing.ts',
      '/project/valid2.ts',
      '/project/restricted.ts',
      '/project/valid3.ts',
    ];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result).toEqual({
      validFiles: ['/project/valid1.ts', '/project/valid2.ts', '/project/valid3.ts'],
      skippedCount: 2,
    });
  });

  it('should add all valid files to extract log with correct metadata', async () => {
    const mockDate1 = new Date('2025-01-01T00:00:00.000Z');
    const mockDate2 = new Date('2025-01-02T00:00:00.000Z');

    mockStat
      .mockResolvedValueOnce({
        size: 1000,
        mtime: mockDate1,
        isFile: () => true,
      } as any)
      .mockResolvedValueOnce({
        size: 2000,
        mtime: mockDate2,
        isFile: () => true,
      } as any);
    mockCalculateFileHash.mockResolvedValueOnce('hash1').mockResolvedValueOnce('hash2');

    const files = ['/project/file1.ts', '/project/file2.ts'];
    await prepareFilesForProcessing(files, extractLog);

    expect(extractLog.files['/project/file1.ts']).toEqual({
      hash: 'hash1',
      size: 1000,
      lastModified: '2025-01-01T00:00:00.000Z',
      processed: false,
    });
    expect(extractLog.files['/project/file2.ts']).toEqual({
      hash: 'hash2',
      size: 2000,
      lastModified: '2025-01-02T00:00:00.000Z',
      processed: false,
    });
  });

  it('should continue processing after encountering failures', async () => {
    mockStat
      .mockRejectedValueOnce(new Error('First failed'))
      .mockResolvedValueOnce({
        size: 1024,
        mtime: new Date(),
        isFile: () => true,
      } as any)
      .mockRejectedValueOnce(new Error('Third failed'))
      .mockResolvedValueOnce({
        size: 2048,
        mtime: new Date(),
        isFile: () => true,
      } as any);
    mockCalculateFileHash.mockResolvedValue('hash');

    const files = ['/project/fail1.ts', '/project/success1.ts', '/project/fail2.ts', '/project/success2.ts'];
    const result = await prepareFilesForProcessing(files, extractLog);

    expect(result.validFiles).toEqual(['/project/success1.ts', '/project/success2.ts']);
    expect(result.skippedCount).toBe(2);
    expect(mockStat).toHaveBeenCalledTimes(4);
  });
});
