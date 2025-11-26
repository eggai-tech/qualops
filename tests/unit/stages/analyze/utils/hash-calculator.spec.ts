import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { calculateFileHash, calculateFileHashes } from '@/stages/analyze/utils/hash-calculator';

jest.mock('node:crypto');
jest.mock('node:fs/promises');

const mockCreateHash = createHash as jest.MockedFunction<typeof createHash>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

describe('calculateFileHash', () => {
  let mockHashInstance: {
    update: jest.Mock;
    digest: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHashInstance = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('abcd1234hash'),
    };
    mockCreateHash.mockReturnValue(mockHashInstance as any);
  });

  it('should calculate SHA256 hash for file content', async () => {
    mockReadFile.mockResolvedValue('file content' as any);

    const result = await calculateFileHash('/project/file.ts');

    expect(mockReadFile).toHaveBeenCalledWith('/project/file.ts', 'utf-8');
    expect(mockCreateHash).toHaveBeenCalledWith('sha256');
    expect(mockHashInstance.update).toHaveBeenCalledWith('file content');
    expect(mockHashInstance.digest).toHaveBeenCalledWith('hex');
    expect(result).toBe('abcd1234hash');
  });

  it('should handle empty file content', async () => {
    mockReadFile.mockResolvedValue('' as any);

    const result = await calculateFileHash('/project/empty.ts');

    expect(mockHashInstance.update).toHaveBeenCalledWith('');
    expect(result).toBe('abcd1234hash');
  });

  it('should handle large file content', async () => {
    const largeContent = 'x'.repeat(1000000);
    mockReadFile.mockResolvedValue(largeContent as any);

    const result = await calculateFileHash('/project/large.ts');

    expect(mockHashInstance.update).toHaveBeenCalledWith(largeContent);
    expect(result).toBe('abcd1234hash');
  });

  it('should handle Unicode content', async () => {
    mockReadFile.mockResolvedValue('Hello 世界 🌍' as any);

    const result = await calculateFileHash('/project/unicode.ts');

    expect(mockHashInstance.update).toHaveBeenCalledWith('Hello 世界 🌍');
    expect(result).toBe('abcd1234hash');
  });

  it('should propagate file read errors', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'));

    await expect(calculateFileHash('/project/missing.ts')).rejects.toThrow('File not found');
  });

  it('should handle ENOENT errors', async () => {
    const error = new Error('ENOENT') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockReadFile.mockRejectedValue(error);

    await expect(calculateFileHash('/project/missing.ts')).rejects.toThrow('ENOENT');
  });

  it('should handle permission errors', async () => {
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockReadFile.mockRejectedValue(error);

    await expect(calculateFileHash('/project/restricted.ts')).rejects.toThrow('Permission denied');
  });

  it('should handle multiline content with various line endings', async () => {
    mockReadFile.mockResolvedValue('line1\nline2\r\nline3\rline4' as any);

    const result = await calculateFileHash('/project/multiline.ts');

    expect(mockHashInstance.update).toHaveBeenCalledWith('line1\nline2\r\nline3\rline4');
    expect(result).toBe('abcd1234hash');
  });

  it('should handle special characters in content', async () => {
    mockReadFile.mockResolvedValue('tab\there\nnull\x00byte' as any);

    const result = await calculateFileHash('/project/special.ts');

    expect(mockHashInstance.update).toHaveBeenCalledWith('tab\there\nnull\x00byte');
    expect(result).toBe('abcd1234hash');
  });
});

describe('calculateFileHashes', () => {
  let mockHashInstance: {
    update: jest.Mock;
    digest: jest.Mock;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockHashInstance = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn(),
    };
    mockCreateHash.mockReturnValue(mockHashInstance as any);
  });

  it('should calculate hashes for multiple files', async () => {
    mockReadFile.mockResolvedValueOnce('content1' as any).mockResolvedValueOnce('content2' as any);

    mockHashInstance.digest.mockReturnValueOnce('hash1').mockReturnValueOnce('hash2');

    const result = await calculateFileHashes(['/project/file1.ts', '/project/file2.ts']);

    expect(result).toEqual({
      '/project/file1.ts': 'hash1',
      '/project/file2.ts': 'hash2',
    });
  });

  it('should return empty object for empty file list', async () => {
    const result = await calculateFileHashes([]);

    expect(result).toEqual({});
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('should skip files that fail to read', async () => {
    mockReadFile
      .mockResolvedValueOnce('content1' as any)
      .mockRejectedValueOnce(new Error('Read failed'))
      .mockResolvedValueOnce('content3' as any);

    mockHashInstance.digest.mockReturnValueOnce('hash1').mockReturnValueOnce('hash3');

    const result = await calculateFileHashes([
      '/project/file1.ts',
      '/project/missing.ts',
      '/project/file3.ts',
    ]);

    expect(result).toEqual({
      '/project/file1.ts': 'hash1',
      '/project/file3.ts': 'hash3',
    });
    expect(result).not.toHaveProperty('/project/missing.ts');
  });

  it('should handle all files failing to read', async () => {
    mockReadFile.mockRejectedValue(new Error('All failed'));

    const result = await calculateFileHashes(['/project/file1.ts', '/project/file2.ts']);

    expect(result).toEqual({});
  });

  it('should process files in parallel', async () => {
    mockReadFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => resolve('content' as any), 10);
        }),
    );

    mockHashInstance.digest.mockReturnValue('hash');

    const startTime = Date.now();
    await calculateFileHashes(['/project/file1.ts', '/project/file2.ts', '/project/file3.ts']);
    const duration = Date.now() - startTime;

    expect(duration).toBeLessThan(150);
  });

  it('should handle single file', async () => {
    mockReadFile.mockResolvedValue('content' as any);
    mockHashInstance.digest.mockReturnValue('hash');

    const result = await calculateFileHashes(['/project/file.ts']);

    expect(result).toEqual({
      '/project/file.ts': 'hash',
    });
  });

  it('should handle mixed success and failure scenarios', async () => {
    mockReadFile
      .mockResolvedValueOnce('content1' as any)
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce('content3' as any)
      .mockRejectedValueOnce(new Error('EACCES'))
      .mockResolvedValueOnce('content5' as any);

    mockHashInstance.digest
      .mockReturnValueOnce('hash1')
      .mockReturnValueOnce('hash3')
      .mockReturnValueOnce('hash5');

    const result = await calculateFileHashes([
      '/project/file1.ts',
      '/project/missing.ts',
      '/project/file3.ts',
      '/project/restricted.ts',
      '/project/file5.ts',
    ]);

    expect(result).toEqual({
      '/project/file1.ts': 'hash1',
      '/project/file3.ts': 'hash3',
      '/project/file5.ts': 'hash5',
    });
    expect(Object.keys(result)).toHaveLength(3);
  });

  it('should handle duplicate file paths', async () => {
    mockReadFile.mockResolvedValue('content' as any);
    mockHashInstance.digest.mockReturnValue('hash');

    const result = await calculateFileHashes([
      '/project/file.ts',
      '/project/file.ts',
      '/project/file.ts',
    ]);

    expect(result).toEqual({
      '/project/file.ts': 'hash',
    });
    expect(mockReadFile).toHaveBeenCalledTimes(3);
  });

  it('should handle different file types', async () => {
    mockReadFile
      .mockResolvedValueOnce('typescript' as any)
      .mockResolvedValueOnce('javascript' as any)
      .mockResolvedValueOnce('json' as any);

    mockHashInstance.digest
      .mockReturnValueOnce('hash_ts')
      .mockReturnValueOnce('hash_js')
      .mockReturnValueOnce('hash_json');

    const result = await calculateFileHashes([
      '/project/file.ts',
      '/project/file.js',
      '/project/file.json',
    ]);

    expect(result).toEqual({
      '/project/file.ts': 'hash_ts',
      '/project/file.js': 'hash_js',
      '/project/file.json': 'hash_json',
    });
  });

  it('should maintain order independence in results', async () => {
    mockReadFile.mockImplementation((path: any) => {
      const delays: Record<string, number> = {
        '/project/file1.ts': 30,
        '/project/file2.ts': 10,
        '/project/file3.ts': 20,
      };
      return new Promise((resolve) => {
        setTimeout(() => resolve(`content-${path}` as any), delays[path]);
      });
    });

    mockHashInstance.digest.mockReturnValue('test-hash');

    const result = await calculateFileHashes([
      '/project/file1.ts',
      '/project/file2.ts',
      '/project/file3.ts',
    ]);

    expect(Object.keys(result)).toHaveLength(3);
    expect(result['/project/file1.ts']).toBeDefined();
    expect(result['/project/file2.ts']).toBeDefined();
    expect(result['/project/file3.ts']).toBeDefined();
  });
});
