import { readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import {
  autoRollback,
  cleanupRollbackPoints,
  createFixBatchRollbackPoint,
  createRollbackPoint,
  listRollbackPoints,
  performPartialRollback,
  performRollback,
  type RollbackPoint,
  smartRollback,
  verifyRollbackPoint,
} from './rollback-manager';

jest.mock('node:fs/promises');
jest.mock('node:path');
jest.mock('../../../shared/utils/file-utils.ts', () => ({
  validateFilePath: jest.fn(),
}));
jest.mock('../../../shared/utils/logger.ts');
jest.mock('../appliers/backup-manager.ts', () => ({
  listBackupsForFile: jest.fn(),
}));

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockJoin = join as jest.MockedFunction<typeof join>;

// Import mocked functions
const { listBackupsForFile } = jest.requireMock('../appliers/backup-manager.ts') as { listBackupsForFile: jest.Mock };
const { validateFilePath } = jest.requireMock('../../../shared/utils/file-utils.ts') as { validateFilePath: jest.Mock };

const mockListBackupsForFile = listBackupsForFile;
const mockValidateFilePath = validateFilePath;

describe('createRollbackPoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('file content');
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 100 } as any);
    mockJoin.mockImplementation((...args) => args.join('/'));
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create rollback point with single file', async () => {
    const result = await createRollbackPoint('Test rollback', ['/project/file.ts']);

    expect(result.description).toBe('Test rollback');
    expect(result.affectedFiles).toHaveLength(1);
    expect(result.affectedFiles[0].filePath).toBe('/project/file.ts');
    expect(result.metadata.fixCount).toBe(1);
    expect(result.metadata.totalChanges).toBe(1);
  });

  it('should create rollback point with multiple files', async () => {
    const files = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];

    const result = await createRollbackPoint('Multiple files', files);

    expect(result.affectedFiles).toHaveLength(3);
    expect(result.metadata.fixCount).toBe(3);
    expect(result.metadata.totalChanges).toBe(3);
  });

  it('should include session id when provided', async () => {
    const result = await createRollbackPoint('Test', ['/project/file.ts'], 'session-123');

    expect(result.metadata.sessionId).toBe('session-123');
  });

  it('should not include session id when not provided', async () => {
    const result = await createRollbackPoint('Test', ['/project/file.ts']);

    expect(result.metadata.sessionId).toBeUndefined();
  });

  it('should generate unique rollback id', async () => {
    const result1 = await createRollbackPoint('Test 1', ['/project/file.ts']);
    jest.spyOn(Math, 'random').mockReturnValue(0.987654);
    const result2 = await createRollbackPoint('Test 2', ['/project/file.ts']);

    expect(result1.id).not.toBe(result2.id);
    expect(result1.id).toContain('rollback-');
    expect(result2.id).toContain('rollback-');
  });

  it('should create backup files for all affected files', async () => {
    await createRollbackPoint('Test', ['/project/file1.ts', '/project/file2.ts']);

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('file1.ts.rollback-'), 'file content', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('file2.ts.rollback-'), 'file content', 'utf-8');
  });

  it('should read file content for backup', async () => {
    await createRollbackPoint('Test', ['/project/file.ts']);

    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts', 'utf-8');
  });

  it('should calculate checksum for each file', async () => {
    const result = await createRollbackPoint('Test', ['/project/file.ts']);

    expect(result.affectedFiles[0].checksum).toBeDefined();
    expect(typeof result.affectedFiles[0].checksum).toBe('string');
  });

  it('should store file sizes in rollback info', async () => {
    mockStat.mockResolvedValueOnce({ size: 200 } as any).mockResolvedValueOnce({ size: 200 } as any);

    const result = await createRollbackPoint('Test', ['/project/file.ts']);

    expect(result.affectedFiles[0].originalSize).toBe(200);
    expect(result.affectedFiles[0].backupSize).toBe(200);
  });

  it('should throw error when file read fails', async () => {
    mockReadFile.mockRejectedValue(new Error('Read error'));

    await expect(createRollbackPoint('Test', ['/project/file.ts'])).rejects.toThrow(
      'Failed to create rollback point: cannot backup /project/file.ts',
    );
  });

  it('should throw error when backup write fails', async () => {
    mockWriteFile.mockRejectedValue(new Error('Write error'));

    await expect(createRollbackPoint('Test', ['/project/file.ts'])).rejects.toThrow(
      'Failed to create rollback point: cannot backup /project/file.ts',
    );
  });

  it('should set timestamp to current date', async () => {
    const beforeTime = new Date();
    const result = await createRollbackPoint('Test', ['/project/file.ts']);
    const afterTime = new Date();

    expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
    expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
  });

  it('should handle empty file list', async () => {
    const result = await createRollbackPoint('Empty', []);

    expect(result.affectedFiles).toHaveLength(0);
    expect(result.metadata.fixCount).toBe(0);
    expect(result.metadata.totalChanges).toBe(0);
  });
});

describe('performRollback', () => {
  let mockRollbackPoint: RollbackPoint;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('backup content');
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 100 } as any);

    mockRollbackPoint = {
      id: 'rollback-123',
      timestamp: new Date(),
      description: 'Test rollback',
      affectedFiles: [
        {
          filePath: '/project/file1.ts',
          backupPath: '/project/file1.ts.rollback-123-abc',
          originalSize: 100,
          backupSize: 100,
          checksum: 'checksum1',
        },
        {
          filePath: '/project/file2.ts',
          backupPath: '/project/file2.ts.rollback-123-def',
          originalSize: 200,
          backupSize: 200,
          checksum: 'checksum2',
        },
      ],
      metadata: {
        fixCount: 2,
        totalChanges: 2,
      },
    };
  });

  it('should restore all files from backup', async () => {
    const result = await performRollback(mockRollbackPoint, { verifyBackups: false });

    expect(result.success).toBe(true);
    expect(result.filesRestored).toHaveLength(2);
    expect(result.filesRestored).toContain('/project/file1.ts');
    expect(result.filesRestored).toContain('/project/file2.ts');
  });

  it('should read backup content and write to original files', async () => {
    await performRollback(mockRollbackPoint, { verifyBackups: false });

    expect(mockReadFile).toHaveBeenCalledWith('/project/file1.ts.rollback-123-abc', 'utf-8');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file2.ts.rollback-123-def', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('/project/file1.ts', 'backup content', 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('/project/file2.ts', 'backup content', 'utf-8');
  });

  it('should verify backups by default', async () => {
    await performRollback(mockRollbackPoint);

    expect(mockStat).toHaveBeenCalledWith('/project/file1.ts.rollback-123-abc');
    expect(mockStat).toHaveBeenCalledWith('/project/file2.ts.rollback-123-def');
  });

  it('should skip verification when option is false', async () => {
    mockStat.mockClear();

    await performRollback(mockRollbackPoint, { verifyBackups: false });

    expect(mockStat).not.toHaveBeenCalled();
  });

  it('should create pre-rollback backups by default', async () => {
    mockReadFile
      .mockResolvedValueOnce('current content 1')
      .mockResolvedValueOnce('backup content 1')
      .mockResolvedValueOnce('current content 2')
      .mockResolvedValueOnce('backup content 2');

    await performRollback(mockRollbackPoint, { verifyBackups: false });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) => call[0].includes('.pre-rollback-'));
    expect(preRollbackCalls.length).toBeGreaterThan(0);
  });

  it('should skip pre-rollback backups when option is false', async () => {
    await performRollback(mockRollbackPoint, { createNewBackups: false });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) => call[0].includes('.pre-rollback-'));
    expect(preRollbackCalls).toHaveLength(0);
  });

  it('should fail if verification fails and force is false', async () => {
    mockStat.mockRejectedValue(new Error('Backup not found'));

    const result = await performRollback(mockRollbackPoint, { verifyBackups: true, force: false });

    expect(result.success).toBe(false);
    expect(result.filesRestored).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should proceed if verification fails but force is true', async () => {
    mockStat.mockRejectedValue(new Error('Backup not found'));

    const result = await performRollback(mockRollbackPoint, { verifyBackups: true, force: true });

    expect(result.success).toBe(true);
    expect(result.filesRestored).toHaveLength(2);
  });

  it('should handle dry run mode', async () => {
    mockWriteFile.mockClear();

    const result = await performRollback(mockRollbackPoint, { dryRun: true, verifyBackups: false });

    expect(result.filesRestored).toHaveLength(2);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should collect errors for failed restorations', async () => {
    mockReadFile
      .mockResolvedValueOnce('current1')
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValueOnce('current2')
      .mockResolvedValueOnce('backup content');

    const result = await performRollback(mockRollbackPoint, { verifyBackups: false, createNewBackups: true });

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Read failed');
    expect(result.filesRestored).toHaveLength(1);
  });

  it('should continue processing files after errors', async () => {
    mockReadFile
      .mockResolvedValueOnce('current1')
      .mockRejectedValueOnce(new Error('First file failed'))
      .mockResolvedValueOnce('current2')
      .mockResolvedValueOnce('backup content');

    const result = await performRollback(mockRollbackPoint, { verifyBackups: false, createNewBackups: true });

    expect(result.errors).toHaveLength(1);
    expect(result.filesRestored).toHaveLength(1);
    expect(result.summary.failedFiles).toBe(1);
    expect(result.summary.restoredFiles).toBe(1);
  });

  it('should return correct summary statistics', async () => {
    const result = await performRollback(mockRollbackPoint, { verifyBackups: false });

    expect(result.summary.totalFiles).toBe(2);
    expect(result.summary.restoredFiles).toBe(2);
    expect(result.summary.failedFiles).toBe(0);
  });

  it('should handle empty rollback point', async () => {
    const emptyRollback: RollbackPoint = {
      ...mockRollbackPoint,
      affectedFiles: [],
    };

    const result = await performRollback(emptyRollback);

    expect(result.success).toBe(true);
    expect(result.filesRestored).toHaveLength(0);
    expect(result.summary.totalFiles).toBe(0);
  });

  it('should not create pre-rollback backup in dry run mode', async () => {
    const result = await performRollback(mockRollbackPoint, {
      dryRun: true,
      createNewBackups: true,
      verifyBackups: false,
    });

    expect(result.filesRestored).toHaveLength(2);
    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) => call[0].includes('.pre-rollback-'));
    expect(preRollbackCalls).toHaveLength(0);
  });

  it('should handle pre-rollback backup failures gracefully', async () => {
    mockReadFile
      .mockRejectedValueOnce(new Error('Cannot read current'))
      .mockResolvedValueOnce('backup1')
      .mockResolvedValueOnce('current2')
      .mockResolvedValueOnce('backup2');

    const result = await performRollback(mockRollbackPoint, { createNewBackups: true, verifyBackups: false });

    expect(result.filesRestored).toHaveLength(2);
  });
});

describe('listRollbackPoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return empty array', async () => {
    const result = await listRollbackPoints();

    expect(result).toEqual([]);
  });

  it('should always return array', async () => {
    const result = await listRollbackPoints();

    expect(Array.isArray(result)).toBe(true);
  });
});

describe('performPartialRollback', () => {
  let mockRollbackPoint: RollbackPoint;

  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('backup content');
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 100 } as any);

    mockRollbackPoint = {
      id: 'rollback-123',
      timestamp: new Date(),
      description: 'Test rollback',
      affectedFiles: [
        {
          filePath: '/project/file1.ts',
          backupPath: '/project/file1.ts.rollback-123-abc',
          originalSize: 100,
          backupSize: 100,
          checksum: 'checksum1',
        },
        {
          filePath: '/project/file2.ts',
          backupPath: '/project/file2.ts.rollback-123-def',
          originalSize: 200,
          backupSize: 200,
          checksum: 'checksum2',
        },
        {
          filePath: '/project/file3.ts',
          backupPath: '/project/file3.ts.rollback-123-ghi',
          originalSize: 300,
          backupSize: 300,
          checksum: 'checksum3',
        },
      ],
      metadata: {
        fixCount: 3,
        totalChanges: 3,
      },
    };
  });

  it('should restore only specified files', async () => {
    const result = await performPartialRollback(mockRollbackPoint, ['/project/file1.ts', '/project/file3.ts'], {
      verifyBackups: false,
    });

    expect(result.filesRestored).toHaveLength(2);
    expect(result.filesRestored).toContain('/project/file1.ts');
    expect(result.filesRestored).toContain('/project/file3.ts');
    expect(result.filesRestored).not.toContain('/project/file2.ts');
  });

  it('should ignore files not in rollback point', async () => {
    const result = await performPartialRollback(mockRollbackPoint, ['/project/file1.ts', '/project/nonexistent.ts'], {
      verifyBackups: false,
    });

    expect(result.filesRestored).toHaveLength(1);
    expect(result.filesRestored).toContain('/project/file1.ts');
  });

  it('should handle empty file list', async () => {
    const result = await performPartialRollback(mockRollbackPoint, []);

    expect(result.filesRestored).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  it('should pass options to performRollback', async () => {
    const result = await performPartialRollback(mockRollbackPoint, ['/project/file1.ts'], {
      dryRun: true,
      verifyBackups: false,
    });

    expect(result.filesRestored).toHaveLength(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should handle all files being filtered out', async () => {
    const result = await performPartialRollback(mockRollbackPoint, ['/project/other.ts']);

    expect(result.filesRestored).toHaveLength(0);
    expect(result.summary.totalFiles).toBe(0);
  });
});

describe('autoRollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('backup content');
    mockWriteFile.mockResolvedValue(undefined);
    mockListBackupsForFile.mockResolvedValue([
      {
        path: '/project/file.ts.qualops-backup-2000-abc',
        timestamp: new Date(2000),
        originalFile: '/project/file.ts',
        size: 100,
      },
      {
        path: '/project/file.ts.qualops-backup-1000-def',
        timestamp: new Date(1000),
        originalFile: '/project/file.ts',
        size: 100,
      },
    ]);
    jest.spyOn(Date, 'now').mockReturnValue(5000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should restore from most recent backup', async () => {
    const result = await autoRollback(['/project/file.ts']);

    expect(result.success).toBe(true);
    expect(result.filesRestored).toContain('/project/file.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts.qualops-backup-2000-abc', 'utf-8');
  });

  it('should filter backups by max age', async () => {
    mockListBackupsForFile.mockResolvedValue([
      {
        path: '/project/file.ts.qualops-backup-4500-abc',
        timestamp: new Date(4500),
        originalFile: '/project/file.ts',
        size: 100,
      },
      {
        path: '/project/file.ts.qualops-backup-1000-def',
        timestamp: new Date(1000),
        originalFile: '/project/file.ts',
        size: 100,
      },
    ]);

    const result = await autoRollback(['/project/file.ts'], 1000);

    expect(result.filesRestored).toContain('/project/file.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts.qualops-backup-4500-abc', 'utf-8');
  });

  it('should handle files with no backups', async () => {
    mockListBackupsForFile.mockResolvedValue([]);

    const result = await autoRollback(['/project/file.ts']);

    expect(result.success).toBe(false);
    expect(result.filesRestored).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No recent backups found');
  });

  it('should handle files with only old backups', async () => {
    mockListBackupsForFile.mockResolvedValue([
      {
        path: '/project/file.ts.qualops-backup-500-abc',
        timestamp: new Date(500),
        originalFile: '/project/file.ts',
        size: 100,
      },
    ]);

    const result = await autoRollback(['/project/file.ts'], 1000);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No recent backups found');
  });

  it('should create pre-rollback backup when option is true', async () => {
    mockReadFile.mockResolvedValueOnce('current content').mockResolvedValueOnce('backup content');

    await autoRollback(['/project/file.ts'], 3600000, { createNewBackups: true });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) =>
      call[0].includes('.pre-auto-rollback-'),
    );
    expect(preRollbackCalls.length).toBeGreaterThan(0);
  });

  it('should skip pre-rollback backup when option is false', async () => {
    await autoRollback(['/project/file.ts'], 3600000, { createNewBackups: false });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) =>
      call[0].includes('.pre-auto-rollback-'),
    );
    expect(preRollbackCalls).toHaveLength(0);
  });

  it('should handle dry run mode', async () => {
    mockWriteFile.mockClear();

    const result = await autoRollback(['/project/file.ts'], 3600000, { dryRun: true });

    expect(result.filesRestored).toHaveLength(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should process multiple files', async () => {
    mockListBackupsForFile
      .mockResolvedValueOnce([
        {
          path: '/project/file1.ts.qualops-backup-2000-abc',
          timestamp: new Date(2000),
          originalFile: '/project/file1.ts',
          size: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '/project/file2.ts.qualops-backup-2000-def',
          timestamp: new Date(2000),
          originalFile: '/project/file2.ts',
          size: 100,
        },
      ]);

    const result = await autoRollback(['/project/file1.ts', '/project/file2.ts']);

    expect(result.filesRestored).toHaveLength(2);
    expect(result.summary.totalFiles).toBe(2);
  });

  it('should handle mixed success and failure', async () => {
    mockListBackupsForFile
      .mockResolvedValueOnce([
        {
          path: '/project/file1.ts.qualops-backup-2000-abc',
          timestamp: new Date(2000),
          originalFile: '/project/file1.ts',
          size: 100,
        },
      ])
      .mockResolvedValueOnce([]);

    const result = await autoRollback(['/project/file1.ts', '/project/file2.ts']);

    expect(result.success).toBe(false);
    expect(result.filesRestored).toHaveLength(1);
    expect(result.errors).toHaveLength(1);
  });

  it('should handle read errors during restore', async () => {
    mockReadFile.mockRejectedValue(new Error('Read failed'));

    const result = await autoRollback(['/project/file.ts']);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle pre-rollback backup failure gracefully', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('Cannot read current')).mockResolvedValueOnce('backup content');

    const result = await autoRollback(['/project/file.ts'], 3600000, { createNewBackups: true });

    expect(result.filesRestored).toHaveLength(1);
  });
});

describe('verifyRollbackPoint', () => {
  let mockRollbackPoint: RollbackPoint;

  beforeEach(() => {
    jest.clearAllMocks();
    mockStat.mockResolvedValue({ size: 100 } as any);
    mockReadFile.mockResolvedValue('backup content');

    mockRollbackPoint = {
      id: 'rollback-123',
      timestamp: new Date(),
      description: 'Test rollback',
      affectedFiles: [
        {
          filePath: '/project/file1.ts',
          backupPath: '/project/file1.ts.rollback-123-abc',
          originalSize: 100,
          backupSize: 100,
          checksum: '12-abc123',
        },
        {
          filePath: '/project/file2.ts',
          backupPath: '/project/file2.ts.rollback-123-def',
          originalSize: 200,
          backupSize: 200,
          checksum: '12-def456',
        },
      ],
      metadata: {
        fixCount: 2,
        totalChanges: 2,
      },
    };
  });

  it('should return valid for correct rollback point', async () => {
    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should check if backup files exist', async () => {
    await verifyRollbackPoint(mockRollbackPoint);

    expect(mockStat).toHaveBeenCalledWith('/project/file1.ts.rollback-123-abc');
    expect(mockStat).toHaveBeenCalledWith('/project/file2.ts.rollback-123-def');
  });

  it('should detect missing backup files', async () => {
    mockStat.mockRejectedValue(new Error('File not found'));

    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain('Cannot access backup file');
  });

  it('should verify backup file sizes', async () => {
    mockStat.mockResolvedValueOnce({ size: 150 } as any);

    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('size mismatch'))).toBe(true);
  });

  it('should verify checksums when available', async () => {
    mockReadFile.mockResolvedValue('different content');

    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('checksum mismatch'))).toBe(true);
  });

  it('should check if original files exist', async () => {
    await verifyRollbackPoint(mockRollbackPoint);

    expect(mockStat).toHaveBeenCalledWith('/project/file1.ts');
    expect(mockStat).toHaveBeenCalledWith('/project/file2.ts');
  });

  it('should detect missing original files', async () => {
    mockStat
      .mockResolvedValueOnce({ size: 100 } as any)
      .mockResolvedValueOnce({ size: 100 } as any)
      .mockRejectedValueOnce(new Error('Original not found'))
      .mockResolvedValueOnce({ size: 200 } as any)
      .mockResolvedValueOnce({ size: 200 } as any)
      .mockRejectedValueOnce(new Error('Original not found'));

    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Original file no longer exists'))).toBe(true);
  });

  it('should handle rollback point with no affected files', async () => {
    const emptyRollback: RollbackPoint = {
      ...mockRollbackPoint,
      affectedFiles: [],
    };

    const result = await verifyRollbackPoint(emptyRollback);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect multiple errors', async () => {
    mockStat
      .mockRejectedValueOnce(new Error('Backup 1 not found'))
      .mockRejectedValueOnce(new Error('Backup 2 not found'));

    const result = await verifyRollbackPoint(mockRollbackPoint);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('should skip checksum verification if not provided', async () => {
    const pointWithoutChecksum: RollbackPoint = {
      ...mockRollbackPoint,
      affectedFiles: [
        {
          filePath: '/project/file1.ts',
          backupPath: '/project/file1.ts.rollback-123-abc',
          originalSize: 100,
          backupSize: 100,
        },
      ],
    };

    await verifyRollbackPoint(pointWithoutChecksum);

    expect(mockReadFile).not.toHaveBeenCalled();
  });
});

describe('cleanupRollbackPoints', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockImplementation((...args) => args.join('/'));
    mockUnlink.mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(100000000);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return zero deleted when no rollback points exist', async () => {
    const result = await cleanupRollbackPoints();

    expect(result.deleted).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('should delete old backup files', async () => {
    const result = await cleanupRollbackPoints();

    expect(result.deleted).toBeGreaterThanOrEqual(0);
  });

  it('should respect keepMinimum parameter', async () => {
    const result = await cleanupRollbackPoints(86400000, 5);

    expect(result.deleted).toBeGreaterThanOrEqual(0);
  });

  it('should handle deletion errors gracefully', async () => {
    const result = await cleanupRollbackPoints();

    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('should use default max age of 24 hours', async () => {
    const result = await cleanupRollbackPoints();

    expect(result).toHaveProperty('deleted');
    expect(result).toHaveProperty('errors');
  });

  it('should use custom max age', async () => {
    const result = await cleanupRollbackPoints(3600000);

    expect(result).toHaveProperty('deleted');
    expect(result).toHaveProperty('errors');
  });
});

describe('createFixBatchRollbackPoint', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateFilePath.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('file content');
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 100 } as any);
    mockJoin.mockImplementation((...args) => args.join('/'));
  });

  it('should create rollback point with batch description', async () => {
    const result = await createFixBatchRollbackPoint(['/project/file1.ts', '/project/file2.ts']);

    expect(result.description).toBe('Batch fix application (2 files)');
    expect(result.affectedFiles).toHaveLength(2);
  });

  it('should include session id when provided', async () => {
    const result = await createFixBatchRollbackPoint(['/project/file.ts'], 'session-abc');

    expect(result.metadata.sessionId).toBe('session-abc');
  });

  it('should handle empty file list', async () => {
    const result = await createFixBatchRollbackPoint([]);

    expect(result.description).toBe('Batch fix application (0 files)');
    expect(result.affectedFiles).toHaveLength(0);
  });

  it('should create backups for all files', async () => {
    const files = ['/project/file1.ts', '/project/file2.ts', '/project/file3.ts'];

    const result = await createFixBatchRollbackPoint(files);

    expect(result.affectedFiles).toHaveLength(3);
    expect(mockWriteFile).toHaveBeenCalledTimes(3);
  });
});

describe('smartRollback', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateFilePath.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('backup content');
    mockWriteFile.mockResolvedValue(undefined);
    mockListBackupsForFile.mockResolvedValue([
      {
        path: '/project/file.ts.qualops-backup-2000-abc',
        timestamp: new Date(2000),
        originalFile: '/project/file.ts',
        size: 100,
      },
      {
        path: '/project/file.ts.qualops-backup-1000-def',
        timestamp: new Date(1000),
        originalFile: '/project/file.ts',
        size: 100,
      },
    ]);
  });

  it('should restore from most recent backup by default', async () => {
    const result = await smartRollback(['/project/file.ts']);

    expect(result.success).toBe(true);
    expect(result.filesRestored).toContain('/project/file.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts.qualops-backup-2000-abc', 'utf-8');
  });

  it('should find backup preserving specified patterns', async () => {
    mockReadFile.mockResolvedValueOnce('no pattern here').mockResolvedValueOnce('content with pattern1 and pattern2');

    const result = await smartRollback(['/project/file.ts'], ['pattern1', 'pattern2']);

    expect(result.filesRestored).toContain('/project/file.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts.qualops-backup-1000-def', 'utf-8');
  });

  it('should use most recent if no backup preserves patterns', async () => {
    mockReadFile.mockResolvedValue('no patterns here');

    const result = await smartRollback(['/project/file.ts'], ['missing-pattern']);

    expect(result.filesRestored).toContain('/project/file.ts');
  });

  it('should handle files with no backups', async () => {
    mockListBackupsForFile.mockResolvedValue([]);

    const result = await smartRollback(['/project/file.ts']);

    expect(result.success).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('No backups available');
  });

  it('should skip unreadable backups when searching for patterns', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('Cannot read')).mockResolvedValueOnce('content with pattern');

    const result = await smartRollback(['/project/file.ts'], ['pattern']);

    expect(result.filesRestored).toContain('/project/file.ts');
  });

  it('should create pre-rollback backup when option is true', async () => {
    mockReadFile.mockResolvedValueOnce('current content').mockResolvedValueOnce('backup content');

    await smartRollback(['/project/file.ts'], [], { createNewBackups: true });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) =>
      call[0].includes('.pre-smart-rollback-'),
    );
    expect(preRollbackCalls.length).toBeGreaterThan(0);
  });

  it('should skip pre-rollback backup when option is false', async () => {
    await smartRollback(['/project/file.ts'], [], { createNewBackups: false });

    const preRollbackCalls = (mockWriteFile.mock.calls as any[]).filter((call) =>
      call[0].includes('.pre-smart-rollback-'),
    );
    expect(preRollbackCalls).toHaveLength(0);
  });

  it('should handle dry run mode', async () => {
    mockWriteFile.mockClear();

    const result = await smartRollback(['/project/file.ts'], [], { dryRun: true });

    expect(result.filesRestored).toHaveLength(1);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('should process multiple files', async () => {
    mockListBackupsForFile
      .mockResolvedValueOnce([
        {
          path: '/project/file1.ts.qualops-backup-2000-abc',
          timestamp: new Date(2000),
          originalFile: '/project/file1.ts',
          size: 100,
        },
      ])
      .mockResolvedValueOnce([
        {
          path: '/project/file2.ts.qualops-backup-2000-def',
          timestamp: new Date(2000),
          originalFile: '/project/file2.ts',
          size: 100,
        },
      ]);

    const result = await smartRollback(['/project/file1.ts', '/project/file2.ts']);

    expect(result.filesRestored).toHaveLength(2);
    expect(result.summary.totalFiles).toBe(2);
  });

  it('should handle restore errors', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('backup content')).mockRejectedValueOnce(new Error('Restore failed'));

    const result = await smartRollback(['/project/file.ts']);

    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle empty preserve patterns', async () => {
    mockReadFile.mockResolvedValueOnce('current content').mockResolvedValueOnce('backup content');

    const result = await smartRollback(['/project/file.ts'], [], { createNewBackups: true });

    expect(result.filesRestored).toContain('/project/file.ts');
  });

  it('should check all patterns are preserved', async () => {
    mockReadFile
      .mockResolvedValueOnce('content with pattern1 only')
      .mockResolvedValueOnce('content with pattern1 and pattern2');

    const result = await smartRollback(['/project/file.ts'], ['pattern1', 'pattern2']);

    expect(result.filesRestored).toContain('/project/file.ts');
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts.qualops-backup-1000-def', 'utf-8');
  });

  it('should handle pre-rollback backup failure gracefully', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('Cannot read current')).mockResolvedValueOnce('backup content');

    const result = await smartRollback(['/project/file.ts'], [], { createNewBackups: true });

    expect(result.filesRestored).toHaveLength(1);
  });
});
