import { readFile, stat } from 'node:fs/promises';

import { getCurrentSessionPaths } from '@/shared/runtime/session-context';
import { writeMetadataFile } from '@/shared/utils/file-utils';
import { logger } from '@/shared/utils/logger';
import {
  type ExtractLog,
  getFilesToProcess,
  loadExtractLog,
  saveExtractLog,
  shouldProcessFile,
  updateExtractLog,
  updateFileInExtractLog,
} from '@/stages/analyze/utils/extract-log';
import { calculateFileHash } from '@/stages/analyze/utils/hash-calculator';

jest.mock('node:fs/promises');
jest.mock('@/shared/runtime/session-context');
jest.mock('@/shared/utils/file-utils');
jest.mock('@/shared/utils/logger');
jest.mock('@/stages/analyze/utils/hash-calculator');

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockGetCurrentSessionPaths = getCurrentSessionPaths as jest.MockedFunction<typeof getCurrentSessionPaths>;
const mockWriteMetadataFile = writeMetadataFile as jest.MockedFunction<typeof writeMetadataFile>;
const mockCalculateFileHash = calculateFileHash as jest.MockedFunction<typeof calculateFileHash>;
const mockLogger = logger as jest.Mocked<typeof logger>;

describe('loadExtractLog', () => {
  const mockExtractLogPath = '/session/extract-log.json';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue({
      extractLog: () => mockExtractLogPath,
    } as any);
  });

  it('should load and parse existing extract log', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    const result = await loadExtractLog();

    expect(mockReadFile).toHaveBeenCalledWith(mockExtractLogPath, 'utf-8');
    expect(result).toEqual(existingLog);
  });

  it('should return default log when file does not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    const result = await loadExtractLog();

    expect(result).toEqual({
      timestamp: expect.any(String),
      files: {},
    });
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should return default log when JSON parsing fails', async () => {
    mockReadFile.mockResolvedValue('invalid json {');

    const result = await loadExtractLog();

    expect(result).toEqual({
      timestamp: expect.any(String),
      files: {},
    });
  });

  it('should return default log when file is empty', async () => {
    mockReadFile.mockResolvedValue('');

    const result = await loadExtractLog();

    expect(result).toEqual({
      timestamp: expect.any(String),
      files: {},
    });
  });

  it('should handle permission errors gracefully', async () => {
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockReadFile.mockRejectedValue(error);

    const result = await loadExtractLog();

    expect(result).toEqual({
      timestamp: expect.any(String),
      files: {},
    });
  });

  it('should load log with multiple files', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
        '/project/file2.ts': {
          hash: 'hash2',
          size: 2000,
          lastModified: '2025-01-01T01:00:00.000Z',
          processed: false,
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    const result = await loadExtractLog();

    expect(result).toEqual(existingLog);
    expect(Object.keys(result.files)).toHaveLength(2);
  });

  it('should load log with empty files object', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    const result = await loadExtractLog();

    expect(result).toEqual(existingLog);
    expect(Object.keys(result.files)).toHaveLength(0);
  });
});

describe('saveExtractLog', () => {
  const mockExtractLogPath = '/session/extract-log.json';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue({
      extractLog: () => mockExtractLogPath,
    } as any);
  });

  it('should save extract log to file', async () => {
    const log: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockWriteMetadataFile.mockResolvedValue(undefined);

    await saveExtractLog(log);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(mockExtractLogPath, log);
  });

  it('should save empty log', async () => {
    const log: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockWriteMetadataFile.mockResolvedValue(undefined);

    await saveExtractLog(log);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(mockExtractLogPath, log);
  });

  it('should propagate write errors', async () => {
    const log: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockWriteMetadataFile.mockRejectedValue(new Error('Disk full'));

    await expect(saveExtractLog(log)).rejects.toThrow('Disk full');
  });

  it('should save log with multiple files', async () => {
    const log: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
        '/project/file2.ts': {
          hash: 'hash2',
          size: 2000,
          lastModified: '2025-01-01T01:00:00.000Z',
          processed: false,
        },
        '/project/file3.ts': {
          hash: 'hash3',
          size: 3000,
          lastModified: '2025-01-01T02:00:00.000Z',
          processed: true,
        },
      },
    };
    mockWriteMetadataFile.mockResolvedValue(undefined);

    await saveExtractLog(log);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(mockExtractLogPath, log);
  });
});

describe('shouldProcessFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true when file has no log entry', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
    expect(mockCalculateFileHash).not.toHaveBeenCalled();
  });

  it('should return true when file is not processed', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: false,
        },
      },
    };

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
    expect(mockCalculateFileHash).not.toHaveBeenCalled();
  });

  it('should return false when file is processed and hash unchanged', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockCalculateFileHash.mockResolvedValue('hash1');

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(false);
    expect(mockCalculateFileHash).toHaveBeenCalledWith('/project/file1.ts');
  });

  it('should return true when file is processed but hash changed', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockCalculateFileHash.mockResolvedValue('hash2');

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
    expect(mockCalculateFileHash).toHaveBeenCalledWith('/project/file1.ts');
  });

  it('should return true when hash calculation fails', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockCalculateFileHash.mockRejectedValue(new Error('File not found'));

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
  });

  it('should return true when hash calculation throws ENOENT', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    const error = new Error('File not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockCalculateFileHash.mockRejectedValue(error);

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
  });

  it('should handle log entry with missing processed flag', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: false,
        },
      },
    };

    const result = await shouldProcessFile('/project/file1.ts', extractLog);

    expect(result).toBe(true);
  });
});

describe('updateExtractLog', () => {
  const mockExtractLogPath = '/session/extract-log.json';

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentSessionPaths.mockReturnValue({
      extractLog: () => mockExtractLogPath,
    } as any);
    mockWriteMetadataFile.mockResolvedValue(undefined);
  });

  it('should update log with new file entry', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    await updateExtractLog('/project/file1.ts', 'hash1', 1000);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(mockExtractLogPath, {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: expect.any(String),
          processed: true,
        },
      },
    });
  });

  it('should update existing file entry', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'oldHash',
          size: 500,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: false,
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    await updateExtractLog('/project/file1.ts', 'newHash', 1500);

    expect(mockWriteMetadataFile).toHaveBeenCalledWith(mockExtractLogPath, {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'newHash',
          size: 1500,
          lastModified: expect.any(String),
          processed: true,
        },
      },
    });
  });

  it('should handle concurrent updates sequentially', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    let loadCallCount = 0;
    mockReadFile.mockImplementation(() => {
      loadCallCount++;
      if (loadCallCount === 1) {
        return Promise.resolve(JSON.stringify(existingLog));
      }
      return Promise.resolve(
        JSON.stringify({
          ...existingLog,
          files: {
            '/project/file1.ts': {
              hash: 'hash1',
              size: 1000,
              lastModified: expect.any(String),
              processed: true,
            },
          },
        }),
      );
    });

    await Promise.all([
      updateExtractLog('/project/file1.ts', 'hash1', 1000),
      updateExtractLog('/project/file2.ts', 'hash2', 2000),
    ]);

    expect(mockWriteMetadataFile).toHaveBeenCalledTimes(2);
  });

  it('should clean up queue after successful update', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    await updateExtractLog('/project/file1.ts', 'hash1', 1000);

    await updateExtractLog('/project/file2.ts', 'hash2', 2000);

    expect(mockWriteMetadataFile).toHaveBeenCalledTimes(2);
  });

  it('should clean up queue after failed update', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));
    mockWriteMetadataFile.mockRejectedValueOnce(new Error('Write failed')).mockResolvedValueOnce(undefined);

    await expect(updateExtractLog('/project/file1.ts', 'hash1', 1000)).rejects.toThrow('Write failed');

    await updateExtractLog('/project/file2.ts', 'hash2', 2000);

    expect(mockWriteMetadataFile).toHaveBeenCalledTimes(2);
  });

  it('should handle multiple files in concurrent updates', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    await Promise.all([
      updateExtractLog('/project/file1.ts', 'hash1', 1000),
      updateExtractLog('/project/file2.ts', 'hash2', 2000),
      updateExtractLog('/project/file3.ts', 'hash3', 3000),
    ]);

    expect(mockWriteMetadataFile).toHaveBeenCalledTimes(3);
  });

  it('should preserve existing files when updating new file', async () => {
    const existingLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/existing.ts': {
          hash: 'existingHash',
          size: 5000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockReadFile.mockResolvedValue(JSON.stringify(existingLog));

    await updateExtractLog('/project/file1.ts', 'hash1', 1000);

    const savedLog = mockWriteMetadataFile.mock.calls[0][1] as ExtractLog;
    expect(savedLog.files['/project/existing.ts']).toEqual({
      hash: 'existingHash',
      size: 5000,
      lastModified: '2025-01-01T00:00:00.000Z',
      processed: true,
    });
    expect(savedLog.files['/project/file1.ts']).toBeDefined();
  });
});

describe('getFilesToProcess', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return all files when log is empty', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual(allFiles);
  });

  it('should return only unprocessed files', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    mockCalculateFileHash.mockResolvedValue('hash1');

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual(['/project/file2.ts', '/project/file3.ts']);
  });

  it('should return files with changed hashes', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
        '/project/file2.ts': {
          hash: 'hash2',
          size: 2000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    mockCalculateFileHash.mockImplementation((path: string) => {
      if (path === '/project/file1.ts') return Promise.resolve('hash1_changed');
      if (path === '/project/file2.ts') return Promise.resolve('hash2');
      if (path === '/project/file3.ts') return Promise.resolve('hash3');
      return Promise.resolve('hash');
    });

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual(['/project/file1.ts', '/project/file3.ts']);
  });

  it('should return empty array when all files are up to date', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
        '/project/file2.ts': {
          hash: 'hash2',
          size: 2000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts'];
    mockCalculateFileHash.mockImplementation((path: string) => {
      if (path === '/project/file1.ts') return Promise.resolve('hash1');
      if (path === '/project/file2.ts') return Promise.resolve('hash2');
      return Promise.resolve('hash');
    });

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual([]);
  });

  it('should return empty array when file list is empty', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    const allFiles: string[] = [];

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual([]);
  });

  it('should handle files with hash calculation errors', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts'];
    mockCalculateFileHash.mockRejectedValueOnce(new Error('Read failed'));

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual(['/project/file1.ts', '/project/file2.ts']);
  });

  it('should process files in parallel', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    let callOrder = 0;
    const callOrders: number[] = [];

    mockCalculateFileHash.mockImplementation(() => {
      callOrders.push(callOrder++);
      return Promise.resolve('hash');
    });

    await getFilesToProcess(allFiles, extractLog);

    expect(callOrders).toEqual([]);
  });

  it('should handle mixed processed and unprocessed files', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'hash1',
          size: 1000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
        '/project/file2.ts': {
          hash: 'hash2',
          size: 2000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: false,
        },
      },
    };
    const allFiles = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];
    mockCalculateFileHash.mockImplementation((path: string) => {
      if (path === '/project/file1.ts') return Promise.resolve('hash1');
      return Promise.resolve('hash');
    });

    const result = await getFilesToProcess(allFiles, extractLog);

    expect(result).toEqual(['/project/file2.ts', '/project/file3.ts']);
  });
});

describe('updateFileInExtractLog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should update file entry with hash and stats', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockCalculateFileHash.mockResolvedValue('hash1');
    mockStat.mockResolvedValue({
      size: 1000,
      mtime: new Date('2025-01-01T12:00:00.000Z'),
    } as any);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(extractLog.files['/project/file1.ts']).toEqual({
      hash: 'hash1',
      size: 1000,
      lastModified: '2025-01-01T12:00:00.000Z',
      processed: true,
    });
  });

  it('should update existing file entry', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/file1.ts': {
          hash: 'oldHash',
          size: 500,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: false,
        },
      },
    };
    mockCalculateFileHash.mockResolvedValue('newHash');
    mockStat.mockResolvedValue({
      size: 1500,
      mtime: new Date('2025-01-01T12:00:00.000Z'),
    } as any);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(extractLog.files['/project/file1.ts']).toEqual({
      hash: 'newHash',
      size: 1500,
      lastModified: '2025-01-01T12:00:00.000Z',
      processed: true,
    });
  });

  it('should log warning when hash calculation fails', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockCalculateFileHash.mockRejectedValue(new Error('Hash calculation failed'));

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to update extract log for /project/file1.ts:',
      expect.any(Error),
    );
    expect(extractLog.files['/project/file1.ts']).toBeUndefined();
  });

  it('should log warning when stat fails', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockCalculateFileHash.mockResolvedValue('hash1');
    mockStat.mockRejectedValue(new Error('Stat failed') as any);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(mockLogger.warn).toHaveBeenCalledWith(
      'Failed to update extract log for /project/file1.ts:',
      expect.any(Error),
    );
    expect(extractLog.files['/project/file1.ts']).toBeUndefined();
  });

  it('should handle file not found error', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    const error = new Error('File not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockCalculateFileHash.mockRejectedValue(error);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to update extract log for /project/file1.ts:', error);
    expect(extractLog.files['/project/file1.ts']).toBeUndefined();
  });

  it('should handle permission error', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockCalculateFileHash.mockRejectedValue(error);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(mockLogger.warn).toHaveBeenCalledWith('Failed to update extract log for /project/file1.ts:', error);
    expect(extractLog.files['/project/file1.ts']).toBeUndefined();
  });

  it('should not modify log when update fails', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {
        '/project/existing.ts': {
          hash: 'existingHash',
          size: 5000,
          lastModified: '2025-01-01T00:00:00.000Z',
          processed: true,
        },
      },
    };
    mockCalculateFileHash.mockRejectedValue(new Error('Failed'));

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(extractLog.files['/project/existing.ts']).toEqual({
      hash: 'existingHash',
      size: 5000,
      lastModified: '2025-01-01T00:00:00.000Z',
      processed: true,
    });
    expect(extractLog.files['/project/file1.ts']).toBeUndefined();
  });

  it('should handle multiple updates to same log', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockCalculateFileHash.mockResolvedValueOnce('hash1').mockResolvedValueOnce('hash2');
    mockStat
      .mockResolvedValueOnce({
        size: 1000,
        mtime: new Date('2025-01-01T12:00:00.000Z'),
      } as any)
      .mockResolvedValueOnce({
        size: 2000,
        mtime: new Date('2025-01-01T13:00:00.000Z'),
      } as any);

    await updateFileInExtractLog('/project/file1.ts', extractLog);
    await updateFileInExtractLog('/project/file2.ts', extractLog);

    expect(Object.keys(extractLog.files)).toHaveLength(2);
    expect(extractLog.files['/project/file1.ts']).toBeDefined();
    expect(extractLog.files['/project/file2.ts']).toBeDefined();
  });

  it('should preserve processed flag as true', async () => {
    const extractLog: ExtractLog = {
      timestamp: '2025-01-01T00:00:00.000Z',
      files: {},
    };
    mockCalculateFileHash.mockResolvedValue('hash1');
    mockStat.mockResolvedValue({
      size: 1000,
      mtime: new Date('2025-01-01T12:00:00.000Z'),
    } as any);

    await updateFileInExtractLog('/project/file1.ts', extractLog);

    expect(extractLog.files['/project/file1.ts'].processed).toBe(true);
  });
});
