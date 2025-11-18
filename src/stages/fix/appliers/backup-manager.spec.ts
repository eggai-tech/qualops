import { readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import {
  type BackupMetadata,
  cleanupOldBackups,
  createBackup,
  createBackupWithMetadata,
  createNamedBackup,
  listAllBackups,
  listBackupsForFile,
  restoreFromBackup,
  verifyBackup,
} from './backup-manager';

jest.mock('node:fs/promises');
jest.mock('node:path');
jest.mock('../../../shared/utils/file-utils.ts', () => ({
  validateFilePath: jest.fn(),
}));
jest.mock('../../../shared/utils/logger.ts');

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockReaddir = readdir as jest.MockedFunction<typeof readdir>;
const mockStat = stat as jest.MockedFunction<typeof stat>;
const mockUnlink = unlink as jest.MockedFunction<typeof unlink>;
const mockBasename = basename as jest.MockedFunction<typeof basename>;
const mockDirname = dirname as jest.MockedFunction<typeof dirname>;
const mockJoin = join as jest.MockedFunction<typeof join>;

const { validateFilePath } = jest.requireMock('../../../shared/utils/file-utils.ts') as { validateFilePath: jest.Mock };
const mockValidateFilePath = validateFilePath;

describe('createBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockValidateFilePath.mockResolvedValue(undefined);
    mockReadFile.mockResolvedValue('file content');
    mockWriteFile.mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create backup with timestamp and random suffix', async () => {
    const result = await createBackup('/project/test.ts');

    expect(result).toContain('/project/test.ts.qualops-backup-1234567890-');
    expect(result.length).toBeGreaterThan(40);
    expect(mockWriteFile).toHaveBeenCalledWith(result, 'file content', 'utf-8');
  });

  it('should read file content if not provided', async () => {
    await createBackup('/project/test.ts');

    expect(mockReadFile).toHaveBeenCalledWith('/project/test.ts', 'utf-8');
  });

  it('should use provided content instead of reading file', async () => {
    await createBackup('/project/test.ts', 'custom content');

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), 'custom content', 'utf-8');
  });

  it('should throw error on read failure', async () => {
    mockReadFile.mockRejectedValue(new Error('Read failed'));

    await expect(createBackup('/project/test.ts')).rejects.toThrow('Backup creation failed: Read failed');
  });

  it('should throw error on write failure', async () => {
    mockWriteFile.mockRejectedValue(new Error('Write failed'));

    await expect(createBackup('/project/test.ts')).rejects.toThrow('Backup creation failed: Write failed');
  });

  it('should handle non-Error thrown values', async () => {
    mockWriteFile.mockRejectedValue('String error message');

    await expect(createBackup('/project/test.ts')).rejects.toThrow('Backup creation failed: String error message');
  });

  it('should handle empty content', async () => {
    mockReadFile.mockResolvedValue('');
    await createBackup('/project/test.ts', '');

    const callArgs = mockWriteFile.mock.calls[0];
    expect(callArgs[1]).toBe('');
    expect(callArgs[2]).toBe('utf-8');
  });

  it('should handle large content', async () => {
    const largeContent = 'x'.repeat(1000000);
    await createBackup('/project/test.ts', largeContent);

    expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), largeContent, 'utf-8');
  });
});

describe('createBackupWithMetadata', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('file content');
    mockWriteFile.mockResolvedValue(undefined);
    mockStat.mockResolvedValue({ size: 1024 } as any);
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
    jest.spyOn(Math, 'random').mockReturnValue(0.123456789);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create backup with metadata', async () => {
    const result = await createBackupWithMetadata('/project/test.ts');

    expect(result.originalFile).toBe('/project/test.ts');
    expect(result.backupFile).toContain('/project/test.ts.qualops-backup-1234567890-');
    expect(result.size).toBe(1024);
    expect(result.checksum).toBeDefined();
    expect(result.timestamp).toBeDefined();
  });

  it('should write metadata file', async () => {
    await createBackupWithMetadata('/project/test.ts');

    const metadataCall = (mockWriteFile.mock.calls as any[]).find((call) => call[0].includes('.metadata.json'));
    expect(metadataCall).toBeDefined();
    expect(metadataCall[1]).toContain('"originalFile"');
  });

  it('should calculate file checksum', async () => {
    const result = await createBackupWithMetadata('/project/test.ts');

    expect(result.checksum).toBeDefined();
    expect(typeof result.checksum).toBe('string');
    expect(result.checksum.length).toBeGreaterThan(0);
  });

  it('should include file size in metadata', async () => {
    const result = await createBackupWithMetadata('/project/test.ts');

    expect(result.size).toBe(1024);
  });

  it('should include timestamp in ISO format', async () => {
    const result = await createBackupWithMetadata('/project/test.ts');

    expect(() => new Date(result.timestamp)).not.toThrow();
    expect(result.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('should throw error on stat failure', async () => {
    mockStat.mockRejectedValue(new Error('Stat failed'));

    await expect(createBackupWithMetadata('/project/test.ts')).rejects.toThrow(
      'Backup with metadata creation failed: Stat failed',
    );
  });

  it('should throw error on metadata write failure', async () => {
    mockWriteFile.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Metadata write failed'));

    await expect(createBackupWithMetadata('/project/test.ts')).rejects.toThrow(
      'Backup with metadata creation failed: Metadata write failed',
    );
  });

  it('should handle non-Error thrown in metadata creation', async () => {
    mockStat.mockRejectedValue('stat failed for unknown reason');

    await expect(createBackupWithMetadata('/project/test.ts')).rejects.toThrow(
      'Backup with metadata creation failed: stat failed for unknown reason',
    );
  });
});

describe('restoreFromBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('backup content');
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('should restore file from backup', async () => {
    const backupPath = '/project/test.ts.qualops-backup-1234567890-abc';

    await restoreFromBackup(backupPath);

    expect(mockReadFile).toHaveBeenCalledWith(backupPath, 'utf-8');
    expect(mockWriteFile).toHaveBeenCalledWith('/project/test.ts', 'backup content', 'utf-8');
  });

  it('should extract original path from backup name', async () => {
    const backupPath = '/project/src/file.ts.qualops-backup-1234567890-xyz';

    await restoreFromBackup(backupPath);

    expect(mockWriteFile).toHaveBeenCalledWith('/project/src/file.ts', 'backup content', 'utf-8');
  });

  it('should use provided target path', async () => {
    const backupPath = '/project/test.ts.qualops-backup-123-abc';
    const targetPath = '/project/restored.ts';

    await restoreFromBackup(backupPath, targetPath);

    expect(mockWriteFile).toHaveBeenCalledWith(targetPath, 'backup content', 'utf-8');
  });

  it('should throw error if original path cannot be determined', async () => {
    const backupPath = '/project/invalid-backup-name';

    await expect(restoreFromBackup(backupPath)).rejects.toThrow(
      'Restore failed: Cannot determine original file path from backup name',
    );
  });

  it('should throw error on read failure', async () => {
    mockReadFile.mockRejectedValue(new Error('Read failed'));

    await expect(restoreFromBackup('/project/test.ts.qualops-backup-123-abc')).rejects.toThrow(
      'Restore failed: Read failed',
    );
  });

  it('should throw error on write failure', async () => {
    mockWriteFile.mockRejectedValue(new Error('Write failed'));

    await expect(restoreFromBackup('/project/test.ts.qualops-backup-123-abc')).rejects.toThrow(
      'Restore failed: Write failed',
    );
  });

  it('should handle non-Error thrown during restore', async () => {
    mockReadFile.mockRejectedValue('permission denied');

    await expect(restoreFromBackup('/project/test.ts.qualops-backup-123-abc')).rejects.toThrow(
      'Restore failed: permission denied',
    );
  });
});

describe('listBackupsForFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDirname.mockReturnValue('/project');
    mockBasename.mockReturnValue('test.ts');
    mockJoin.mockImplementation((...args) => args.join('/'));
  });

  it('should list backups for specific file', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa', 'test.ts.qualops-backup-222-bbb'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date('2024-01-01') } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toHaveLength(2);
    expect(result[0].path).toBe('/project/test.ts.qualops-backup-222-bbb');
    expect(result[1].path).toBe('/project/test.ts.qualops-backup-111-aaa');
  });

  it('should filter out metadata files', async () => {
    mockReaddir.mockResolvedValue([
      'test.ts.qualops-backup-111-aaa',
      'test.ts.qualops-backup-111-aaa.metadata.json',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toHaveLength(1);
    expect(result[0].path).toBe('/project/test.ts.qualops-backup-111-aaa');
  });

  it('should sort backups by timestamp descending', async () => {
    mockReaddir.mockResolvedValue([
      'test.ts.qualops-backup-1000-aaa',
      'test.ts.qualops-backup-3000-ccc',
      'test.ts.qualops-backup-2000-bbb',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result[0].timestamp.getTime()).toBe(3000);
    expect(result[1].timestamp.getTime()).toBe(2000);
    expect(result[2].timestamp.getTime()).toBe(1000);
  });

  it('should extract timestamp from filename', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-1234567890-abc'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date('2020-01-01') } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result[0].timestamp.getTime()).toBe(1234567890);
  });

  it('should use mtime if timestamp extraction fails', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-invalid-abc'] as any);
    const mtime = new Date('2024-01-01');
    mockStat.mockResolvedValue({ size: 100, mtime } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result[0].timestamp).toEqual(mtime);
  });

  it('should include backup metadata', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 512, mtime: new Date() } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result[0].size).toBe(512);
    expect(result[0].originalFile).toBe('/project/test.ts');
  });

  it('should return empty array for directory with no backups', async () => {
    mockReaddir.mockResolvedValue(['other-file.ts', 'another.ts'] as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toEqual([]);
  });

  it('should handle stat errors gracefully', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa', 'test.ts.qualops-backup-222-bbb'] as any);
    mockStat
      .mockResolvedValueOnce({ size: 100, mtime: new Date() } as any)
      .mockRejectedValueOnce(new Error('Stat failed'));

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toHaveLength(1);
  });

  it('should handle readdir errors', async () => {
    mockReaddir.mockRejectedValue(new Error('Directory not found'));

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toEqual([]);
  });

  it('should filter backups for only the specified file', async () => {
    mockReaddir.mockResolvedValue([
      'test.ts.qualops-backup-111-aaa',
      'other.ts.qualops-backup-222-bbb',
      'test.ts.qualops-backup-333-ccc',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listBackupsForFile('/project/test.ts');

    expect(result).toHaveLength(2);
    expect(result.every((b) => b.path.includes('test.ts'))).toBe(true);
  });
});

describe('listAllBackups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockImplementation((...args) => args.join('/'));
  });

  it('should list all backups in directory', async () => {
    mockReaddir.mockResolvedValue([
      'file1.ts.qualops-backup-111-aaa',
      'file2.ts.qualops-backup-222-bbb',
      'regular-file.ts',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listAllBackups('/project');

    expect(result).toHaveLength(2);
  });

  it('should filter out metadata files', async () => {
    mockReaddir.mockResolvedValue([
      'file.ts.qualops-backup-111-aaa',
      'file.ts.qualops-backup-111-aaa.metadata.json',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listAllBackups('/project');

    expect(result).toHaveLength(1);
  });

  it('should extract original file paths', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listAllBackups('/project');

    expect(result[0].originalFile).toBe('/project/test.ts');
  });

  it('should skip backups with invalid names', async () => {
    mockReaddir.mockResolvedValue(['invalid-backup-name', 'test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listAllBackups('/project');

    expect(result).toHaveLength(1);
  });

  it('should sort by timestamp descending', async () => {
    mockReaddir.mockResolvedValue([
      'file.ts.qualops-backup-1000-a',
      'file.ts.qualops-backup-3000-c',
      'file.ts.qualops-backup-2000-b',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    const result = await listAllBackups('/project');

    expect(result[0].timestamp.getTime()).toBe(3000);
    expect(result[2].timestamp.getTime()).toBe(1000);
  });

  it('should return empty array on error', async () => {
    mockReaddir.mockRejectedValue(new Error('Access denied'));

    const result = await listAllBackups('/project');

    expect(result).toEqual([]);
  });

  it('should handle stat errors gracefully', async () => {
    mockReaddir.mockResolvedValue(['file1.ts.qualops-backup-111-aaa', 'file2.ts.qualops-backup-222-bbb'] as any);
    mockStat
      .mockResolvedValueOnce({ size: 100, mtime: new Date() } as any)
      .mockRejectedValueOnce(new Error('Stat failed'));

    const result = await listAllBackups('/project');

    expect(result).toHaveLength(1);
  });
});

describe('cleanupOldBackups', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockImplementation((...args) => args.join('/'));
    mockUnlink.mockResolvedValue(undefined);
  });

  it('should delete backups exceeding keepPerFile limit', async () => {
    const backups = Array.from({ length: 10 }, (_, i) => ({
      path: `/project/test.ts.qualops-backup-${1000 + i}-abc`,
      timestamp: new Date(Date.now() - i * 1000),
      originalFile: '/project/test.ts',
      size: 100,
    }));

    mockReaddir.mockResolvedValue(backups.map((b) => b.path.split('/').pop()!) as any);
    mockStat.mockImplementation((path) => {
      const backup = backups.find((b) => b.path === path);
      return Promise.resolve({ size: backup!.size, mtime: backup!.timestamp } as any);
    });

    const result = await cleanupOldBackups('/project', 5);

    expect(result.deleted).toBe(10);
  });

  it('should delete backups older than maxAgeDays', async () => {
    const oldDate = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    const recentDate = new Date();

    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa', 'test.ts.qualops-backup-222-bbb'] as any);
    mockStat
      .mockResolvedValueOnce({ size: 100, mtime: oldDate } as any)
      .mockResolvedValueOnce({ size: 100, mtime: recentDate } as any);

    const result = await cleanupOldBackups('/project', 10, 30);

    expect(result.deleted).toBeGreaterThan(0);
  });

  it('should delete metadata files along with backups', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } as any);
    mockUnlink.mockResolvedValue(undefined);

    await cleanupOldBackups('/project', 0, 30);

    expect(mockUnlink).toHaveBeenCalledWith('/project/test.ts.qualops-backup-111-aaa');
    expect(mockUnlink).toHaveBeenCalledWith('/project/test.ts.qualops-backup-111-aaa.metadata.json');
  });

  it('should handle missing metadata files gracefully', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } as any);
    mockUnlink.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Metadata not found'));

    const result = await cleanupOldBackups('/project', 0, 30);

    expect(result.deleted).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it('should track deletion errors', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) } as any);
    mockUnlink.mockRejectedValue(new Error('Delete failed'));

    const result = await cleanupOldBackups('/project', 0, 30);

    expect(result.deleted).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('Delete failed');
  });

  it('should group backups by original file', async () => {
    mockReaddir.mockResolvedValue([
      'file1.ts.qualops-backup-111-aaa',
      'file1.ts.qualops-backup-222-bbb',
      'file2.ts.qualops-backup-333-ccc',
      'file2.ts.qualops-backup-444-ddd',
    ] as any);
    mockStat.mockResolvedValue({ size: 100, mtime: new Date() } as any);

    await cleanupOldBackups('/project', 1);

    expect(mockUnlink).toHaveBeenCalledTimes(8);
  });

  it('should keep most recent backups', async () => {
    const timestamps = [3000, 2000, 1000];
    mockReaddir.mockResolvedValue(timestamps.map((t) => `test.ts.qualops-backup-${t}-abc`) as any);
    mockStat.mockImplementation((path) => {
      const timestamp = parseInt((path as string).match(/backup-(\d+)-/)?.[1] || '0');
      return Promise.resolve({ size: 100, mtime: new Date(timestamp) } as any);
    });

    const result = await cleanupOldBackups('/project', 2);

    expect(result.deleted).toBeGreaterThan(0);
    const deletedPaths = mockUnlink.mock.calls.map((call) => call[0] as string);
    expect(deletedPaths.some((p) => p.includes('-1000-'))).toBe(true);
  });

  it('should return minimal deleted when few recent backups', async () => {
    mockReaddir.mockResolvedValue(['test.ts.qualops-backup-111-aaa'] as any);
    const recentDate = new Date(Date.now() - 1000);
    mockStat.mockResolvedValue({ size: 100, mtime: recentDate } as any);

    const result = await cleanupOldBackups('/project', 5, 30);

    expect(result.deleted).toBeLessThan(5);
  });

  it('should handle readdir errors', async () => {
    mockReaddir.mockRejectedValue(new Error('Access denied'));

    const result = await cleanupOldBackups('/project');

    expect(result.deleted).toBe(0);
    expect(result.errors).toBeDefined();
  });
});

describe('verifyBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStat.mockResolvedValue({ size: 100 } as any);
    mockReadFile.mockResolvedValue('backup content');
  });

  it('should verify valid backup without metadata', async () => {
    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should verify valid backup with metadata but no checksum', async () => {
    const content = 'backup content';
    const metadata = {
      originalFile: '/project/test.ts',
      backupFile: '/project/test.ts.qualops-backup-111-aaa',
      timestamp: new Date().toISOString(),
      size: 100,
    };
    mockReadFile.mockResolvedValueOnce(content).mockResolvedValueOnce(JSON.stringify(metadata));

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(true);
  });

  it('should detect checksum mismatch', async () => {
    const metadata: BackupMetadata = {
      originalFile: '/project/test.ts',
      backupFile: '/project/test.ts.qualops-backup-111-aaa',
      timestamp: new Date().toISOString(),
      size: 100,
      checksum: 'wrong-checksum',
    };
    mockReadFile
      .mockResolvedValueOnce('backup content')
      .mockResolvedValueOnce(JSON.stringify(metadata))
      .mockResolvedValueOnce('different content');

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Backup checksum mismatch - file may be corrupted');
  });

  it('should handle missing backup file', async () => {
    mockStat.mockRejectedValue(new Error('File not found'));

    const result = await verifyBackup('/project/nonexistent.qualops-backup-111-aaa');

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('should handle unreadable backup', async () => {
    mockReadFile.mockRejectedValue(new Error('Permission denied'));

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(false);
  });

  it('should handle missing metadata gracefully', async () => {
    mockReadFile.mockResolvedValueOnce('backup content').mockRejectedValueOnce(new Error('Metadata not found'));

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(true);
  });

  it('should handle invalid metadata JSON', async () => {
    mockReadFile.mockResolvedValueOnce('backup content').mockResolvedValueOnce('invalid json');

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(true);
  });

  it('should handle metadata without checksum', async () => {
    const metadata = {
      originalFile: '/project/test.ts',
      backupFile: '/project/test.ts.qualops-backup-111-aaa',
      timestamp: new Date().toISOString(),
      size: 100,
    };
    mockReadFile.mockResolvedValueOnce('backup content').mockResolvedValueOnce(JSON.stringify(metadata));

    const result = await verifyBackup('/project/test.ts.qualops-backup-111-aaa');

    expect(result.valid).toBe(true);
  });
});

describe('createNamedBackup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockReadFile.mockResolvedValue('file content');
    mockWriteFile.mockResolvedValue(undefined);
    jest.spyOn(Date, 'now').mockReturnValue(1234567890);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should create backup with custom name', async () => {
    const result = await createNamedBackup('/project/test.ts', 'pre-refactor');

    expect(result).toBe('/project/test.ts.qualops-backup-pre-refactor-1234567890');
    expect(mockWriteFile).toHaveBeenCalledWith(result, 'file content', 'utf-8');
  });

  it('should use provided content', async () => {
    await createNamedBackup('/project/test.ts', 'custom', 'custom content');

    expect(mockReadFile).not.toHaveBeenCalled();
    expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), 'custom content', 'utf-8');
  });

  it('should handle special characters in name', async () => {
    const result = await createNamedBackup('/project/test.ts', 'fix-bug-#123');

    expect(result).toContain('/project/test.ts.qualops-backup-fix-bug-#123-1234567890');
    expect(mockWriteFile).toHaveBeenCalledWith(result, 'file content', 'utf-8');
  });
});

describe('edge cases and error handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should handle very long file paths', async () => {
    const longPath = '/project/' + 'a'.repeat(200) + '.ts';
    mockReadFile.mockResolvedValue('content');
    mockWriteFile.mockResolvedValue(undefined);

    await expect(createBackup(longPath)).resolves.toBeDefined();
  });

  it('should handle unicode in file names', async () => {
    mockReadFile.mockResolvedValue('content');
    mockWriteFile.mockResolvedValue(undefined);

    await expect(createBackup('/project/测试.ts')).resolves.toBeDefined();
  });

  it('should handle concurrent backup operations', async () => {
    mockReadFile.mockResolvedValue('content');
    mockWriteFile.mockResolvedValue(undefined);
    jest.spyOn(Math, 'random').mockReturnValueOnce(0.1).mockReturnValueOnce(0.9);

    const [backup1, backup2] = await Promise.all([createBackup('/project/test.ts'), createBackup('/project/test.ts')]);

    expect(backup1).not.toBe(backup2);
  });

  it('should handle empty directory in listBackups', async () => {
    mockReaddir.mockResolvedValue([] as any);

    const result = await listAllBackups('/empty');

    expect(result).toEqual([]);
  });

  it('should handle binary content in backups', async () => {
    const binaryContent = Buffer.from([0x00, 0x01, 0x02, 0xff]).toString('utf-8');
    mockReadFile.mockResolvedValue(binaryContent);
    mockWriteFile.mockResolvedValue(undefined);

    await expect(createBackup('/project/binary.dat', binaryContent)).resolves.toBeDefined();
  });
});
