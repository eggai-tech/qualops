import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  ensureDirectory,
  fileExists,
  readMetadataFile,
  writeMetadataFile,
} from '@/shared/utils/file-utils';

jest.mock('node:fs/promises');
jest.mock('node:path');

const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockDirname = dirname as jest.MockedFunction<typeof dirname>;

describe('ensureDirectory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create directory recursively', async () => {
    mockDirname.mockReturnValue('/project/src');
    mockMkdir.mockResolvedValue(undefined);

    await ensureDirectory('/project/src/file.txt');

    expect(mockMkdir).toHaveBeenCalledWith('/project/src', { recursive: true });
  });

  it('should propagate mkdir errors', async () => {
    mockDirname.mockReturnValue('/project/src');
    mockMkdir.mockRejectedValue(new Error('Permission denied'));

    await expect(ensureDirectory('/project/src/file.txt')).rejects.toThrow('Permission denied');
  });
});

describe('writeMetadataFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDirname.mockReturnValue('/project/src');
    mockMkdir.mockResolvedValue(undefined);
  });

  it('should write JSON data with formatting', async () => {
    const data = { key: 'value', nested: { prop: 123 } };
    mockWriteFile.mockResolvedValue(undefined);

    await writeMetadataFile('/project/src/file.json', data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/project/src/file.json',
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  });

  it('should ensure directory exists before writing', async () => {
    mockWriteFile.mockResolvedValue(undefined);

    await writeMetadataFile('/project/src/file.json', { test: true });

    expect(mockMkdir).toHaveBeenCalledWith('/project/src', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalled();
  });

  it('should handle write errors', async () => {
    mockWriteFile.mockRejectedValue(new Error('Disk full'));

    await expect(writeMetadataFile('/project/src/file.json', {})).rejects.toThrow('Disk full');
  });

  it('should serialize primitives', async () => {
    mockWriteFile.mockResolvedValue(undefined);

    await writeMetadataFile('/project/file.json', 'string value');

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/project/file.json',
      JSON.stringify('string value', null, 2),
      'utf-8',
    );
  });

  it('should serialize arrays', async () => {
    const data = [1, 2, 3, { nested: true }];
    mockWriteFile.mockResolvedValue(undefined);

    await writeMetadataFile('/project/file.json', data);

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/project/file.json',
      JSON.stringify(data, null, 2),
      'utf-8',
    );
  });
});

describe('readMetadataFile', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should read and parse JSON file', async () => {
    const data = { key: 'value', count: 42 };
    mockReadFile.mockResolvedValue(JSON.stringify(data));

    const result = await readMetadataFile('/project/file.json');

    expect(result).toEqual(data);
    expect(mockReadFile).toHaveBeenCalledWith('/project/file.json', 'utf-8');
  });

  it('should return null for non-existent file', async () => {
    const error = new Error('File not found') as NodeJS.ErrnoException;
    error.code = 'ENOENT';
    mockReadFile.mockRejectedValue(error);

    const result = await readMetadataFile('/project/file.json');

    expect(result).toBeNull();
  });

  it('should throw for invalid JSON', async () => {
    mockReadFile.mockResolvedValue('invalid json {');

    await expect(readMetadataFile('/project/file.json')).rejects.toThrow();
  });

  it('should throw for non-ENOENT errors', async () => {
    const error = new Error('Permission denied') as NodeJS.ErrnoException;
    error.code = 'EACCES';
    mockReadFile.mockRejectedValue(error);

    await expect(readMetadataFile('/project/file.json')).rejects.toThrow('Permission denied');
  });

  it('should parse array JSON', async () => {
    const data = [1, 2, 3];
    mockReadFile.mockResolvedValue(JSON.stringify(data));

    const result = await readMetadataFile<number[]>('/project/file.json');

    expect(result).toEqual(data);
  });

  it('should parse primitive JSON', async () => {
    mockReadFile.mockResolvedValue('"string value"');

    const result = await readMetadataFile<string>('/project/file.json');

    expect(result).toBe('string value');
  });
});

describe('fileExists', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should return true for existing file', async () => {
    mockReadFile.mockResolvedValue('content');

    const result = await fileExists('/project/file.txt');

    expect(result).toBe(true);
  });

  it('should return false for non-existent file', async () => {
    mockReadFile.mockRejectedValue(new Error('Not found'));

    const result = await fileExists('/project/file.txt');

    expect(result).toBe(false);
  });

  it('should return false for permission errors', async () => {
    mockReadFile.mockRejectedValue(new Error('Permission denied'));

    const result = await fileExists('/project/file.txt');

    expect(result).toBe(false);
  });
});
