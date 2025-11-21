import { existsSync } from 'node:fs';

import { glob } from 'glob';

import { parseFilePatterns } from '@/cli/parsers/file-parser';
import { ConfigService } from '@/config/config';
import { logger } from '@/shared/utils/logger';

jest.mock('glob');
jest.mock('node:fs');
jest.mock('@/shared/utils/logger', () => ({
  logger: {
    warn: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    error: jest.fn(),
  },
}));
jest.mock('@/config/config');

const mockGlob = glob as jest.MockedFunction<typeof glob>;
const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;

interface MockConfigInstance {
  get: jest.Mock<string[] | undefined, [string]>;
}

describe('parseFilePatterns', () => {
  let mockConfigInstance: MockConfigInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetAllMocks();

    mockConfigInstance = {
      get: jest.fn((key: string) => {
        if (key === 'skipPatterns') {
          return ['node_modules/**', '.git/**'];
        }
        return undefined;
      }),
    };

    (ConfigService.getInstance as jest.Mock).mockReturnValue(mockConfigInstance);
    mockGlob.mockReset();
    mockExistsSync.mockReset();
  });

  it('should return empty array for empty string', async () => {
    const result = await parseFilePatterns('');
    expect(result).toEqual([]);
  });

  it('should return empty array for whitespace-only string', async () => {
    const result = await parseFilePatterns('   ');
    expect(result).toEqual([]);
  });

  it('should handle single file path that exists', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns('src/test.ts');

    expect(mockExistsSync).toHaveBeenCalledWith('src/test.ts');
    expect(result).toEqual(['src/test.ts']);
  });

  it('should warn when file does not exist', async () => {
    mockExistsSync.mockReturnValue(false);

    const result = await parseFilePatterns('src/missing.ts');

    expect(mockExistsSync).toHaveBeenCalledWith('src/missing.ts');
    expect(logger.warn).toHaveBeenCalledWith('File does not exist: src/missing.ts');
    expect(result).toEqual([]);
  });

  it('should handle glob pattern with asterisk', async () => {
    mockGlob.mockResolvedValue(['src/file1.ts', 'src/file2.ts']);

    const result = await parseFilePatterns('src/*.ts');

    expect(mockGlob).toHaveBeenCalledWith('src/*.ts', {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });
    expect(result).toEqual(['src/file1.ts', 'src/file2.ts']);
  });

  it('should handle glob pattern with double asterisk', async () => {
    mockGlob.mockResolvedValue(['src/deep/file.ts']);

    const result = await parseFilePatterns('src/**/*.ts');

    expect(mockGlob).toHaveBeenCalledWith('src/**/*.ts', {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });
    expect(result).toEqual(['src/deep/file.ts']);
  });

  it('should handle glob pattern with braces splits on comma', async () => {
    mockGlob.mockResolvedValueOnce(['src/file1.ts']);
    mockExistsSync.mockReturnValue(false);

    const result = await parseFilePatterns('src/*.{ts,tsx}');

    expect(mockGlob).toHaveBeenCalledWith('src/*.{ts', {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });
    expect(mockExistsSync).toHaveBeenCalledWith('tsx}');
    expect(result).toEqual(['src/file1.ts']);
  });

  it('should handle glob pattern with question mark', async () => {
    mockGlob.mockResolvedValue(['src/file1.ts']);
    mockExistsSync.mockReturnValue(false);

    const result = await parseFilePatterns('src/file?.ts');

    expect(mockGlob).toHaveBeenCalledWith('src/file?.ts', {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });
    expect(result).toEqual(['src/file1.ts']);
  });

  it('should warn when glob pattern matches no files', async () => {
    mockGlob.mockResolvedValue([]);

    const result = await parseFilePatterns('src/*.nonexistent');

    expect(logger.warn).toHaveBeenCalledWith('No files found matching pattern: src/*.nonexistent');
    expect(result).toEqual([]);
  });

  it('should log debug when glob pattern matches files', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);

    const result = await parseFilePatterns('*.ts');

    expect(logger.debug).toHaveBeenCalledWith('Found 2 files matching pattern: *.ts');
    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should handle multiple comma-separated file paths', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns('file1.ts,file2.ts,file3.ts');

    expect(mockExistsSync).toHaveBeenCalledTimes(3);
    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should handle comma-separated patterns with whitespace', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns(' file1.ts , file2.ts , file3.ts ');

    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should handle mix of files and glob patterns', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlob.mockResolvedValue(['src/file2.ts', 'src/file3.ts']);

    const result = await parseFilePatterns('file1.ts,src/*.ts');

    expect(result).toEqual(['file1.ts', 'src/file2.ts', 'src/file3.ts']);
  });

  it('should filter out non-TypeScript files and tsx files', async () => {
    mockGlob.mockResolvedValue(['file.ts', 'file.js', 'file.tsx', 'file.json']);

    const result = await parseFilePatterns('*.*');

    expect(result).toEqual(['file.ts']);
  });

  it('should filter out .d.ts declaration files', async () => {
    mockGlob.mockResolvedValue(['file.ts', 'types.d.ts', 'index.d.ts']);

    const result = await parseFilePatterns('*.ts');

    expect(result).toEqual(['file.ts']);
  });

  it('should remove duplicate files', async () => {
    mockGlob.mockResolvedValueOnce(['file1.ts', 'file2.ts']).mockResolvedValueOnce(['file2.ts', 'file3.ts']);

    const result = await parseFilePatterns('pattern1/*,pattern2/*');

    expect(result).toEqual(['file1.ts', 'file2.ts', 'file3.ts']);
  });

  it('should log info when filtering reduces file count', async () => {
    mockGlob.mockResolvedValue(['file.ts', 'file.js', 'file.d.ts', 'file.json']);

    const result = await parseFilePatterns('*.*');

    expect(logger.info).toHaveBeenCalledWith('Filtered to 1 TypeScript files (from 4 total)');
    expect(result).toEqual(['file.ts']);
  });

  it('should not log info when no filtering occurs', async () => {
    mockGlob.mockResolvedValue(['file1.ts', 'file2.ts']);

    const result = await parseFilePatterns('*.ts');

    expect(logger.info).not.toHaveBeenCalled();
    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should handle invalid glob pattern gracefully', async () => {
    mockGlob.mockRejectedValue(new Error('Invalid pattern'));
    mockExistsSync.mockReturnValue(false);

    const result = await parseFilePatterns('invalid[pattern');

    expect(logger.warn).toHaveBeenCalled();
    expect(result).toEqual([]);
  });

  it('should filter empty patterns after trim', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns('file1.ts,  ,file2.ts');

    expect(mockExistsSync).toHaveBeenCalledTimes(2);
    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should handle trailing commas', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns('file1.ts,file2.ts,');

    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should handle leading commas', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns(',file1.ts,file2.ts');

    expect(result).toEqual(['file1.ts', 'file2.ts']);
  });

  it('should use skip patterns from config', async () => {
    mockGlob.mockResolvedValue(['file.ts']);

    await parseFilePatterns('**/*.ts');

    expect(mockConfigInstance.get).toHaveBeenCalledWith('skipPatterns');
    expect(mockGlob).toHaveBeenCalledWith('**/*.ts', {
      nodir: true,
      ignore: ['node_modules/**', '.git/**'],
    });
  });

  it('should handle undefined skip patterns from config', async () => {
    mockConfigInstance.get.mockReturnValue(undefined);
    mockGlob.mockResolvedValue(['file.ts']);

    await parseFilePatterns('*.ts');

    expect(mockGlob).toHaveBeenCalledWith('*.ts', {
      nodir: true,
      ignore: [],
    });
  });

  it('should handle empty skip patterns from config', async () => {
    mockConfigInstance.get.mockReturnValue([]);
    mockGlob.mockResolvedValue(['file.ts']);

    await parseFilePatterns('*.ts');

    expect(mockGlob).toHaveBeenCalledWith('*.ts', {
      nodir: true,
      ignore: [],
    });
  });

  it('should process all patterns even if some fail', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlob.mockRejectedValueOnce(new Error('Invalid'));

    const result = await parseFilePatterns('invalid[,file.ts');

    expect(result).toEqual(['file.ts']);
  });

  it('should handle glob pattern returning .d.ts files and filter them', async () => {
    mockGlob.mockResolvedValueOnce(['index.d.ts', 'types.d.ts', 'impl.ts']);

    const result = await parseFilePatterns('lib/**/*.ts');

    expect(result).toEqual(['impl.ts']);
  });

  it('should handle multiple glob patterns', async () => {
    mockGlob
      .mockResolvedValueOnce(['src/file1.ts'])
      .mockResolvedValueOnce(['lib/file2.ts'])
      .mockResolvedValueOnce(['test/file3.ts']);

    const result = await parseFilePatterns('src/*.ts,lib/*.ts,test/*.ts');

    expect(mockGlob).toHaveBeenCalledTimes(3);
    expect(result).toEqual(['src/file1.ts', 'lib/file2.ts', 'test/file3.ts']);
  });

  it('should filter out .tsx files as they are not .ts', async () => {
    mockGlob.mockResolvedValueOnce(['utils.ts']).mockResolvedValueOnce(['component.tsx']);

    const result = await parseFilePatterns('*.{ts,tsx}');

    expect(result).toEqual(['utils.ts']);
  });

  it('should handle nested .d.ts in path correctly', async () => {
    mockGlob.mockResolvedValueOnce(['src/types.d.ts/file.ts', 'src/file.d.ts']);

    const result = await parseFilePatterns('other/**/*.ts');

    expect(result).toEqual(['src/types.d.ts/file.ts']);
  });

  it('should maintain file order when no duplicates', async () => {
    mockExistsSync.mockReturnValue(true);

    const result = await parseFilePatterns('a.ts,b.ts,c.ts');

    expect(result).toEqual(['a.ts', 'b.ts', 'c.ts']);
  });

  it('should handle complex pattern combinations', async () => {
    mockExistsSync.mockReturnValue(true);
    mockGlob.mockResolvedValueOnce(['src/a.ts']).mockResolvedValueOnce([]).mockResolvedValueOnce(['test/c.ts']);

    const result = await parseFilePatterns('exact.ts,src/**/*.ts,lib/**/*.tsx,test/*.ts');

    expect(result).toEqual(['exact.ts', 'src/a.ts', 'test/c.ts']);
  });

  it('should handle single comma as pattern', async () => {
    const result = await parseFilePatterns(',');
    expect(result).toEqual([]);
  });

  it('should handle multiple commas as pattern', async () => {
    const result = await parseFilePatterns(',,,');
    expect(result).toEqual([]);
  });

  it('should detect glob patterns with asterisk anywhere in string', async () => {
    mockGlob.mockResolvedValue(['file.ts']);

    await parseFilePatterns('prefix*suffix');

    expect(mockGlob).toHaveBeenCalledWith('prefix*suffix', expect.any(Object));
  });

  it('should detect glob patterns with braces anywhere in string', async () => {
    mockGlob.mockResolvedValueOnce(['file.ts']);
    mockExistsSync.mockReturnValue(false);

    await parseFilePatterns('file.{ts,js}');

    expect(mockGlob).toHaveBeenCalledWith('file.{ts', expect.any(Object));
    expect(mockExistsSync).toHaveBeenCalledWith('js}');
  });

  it('should detect glob patterns with question mark anywhere in string', async () => {
    mockGlob.mockResolvedValue(['file.ts']);

    await parseFilePatterns('file?.ts');

    expect(mockGlob).toHaveBeenCalledWith('file?.ts', expect.any(Object));
  });

  it('should handle null-like input gracefully', async () => {
    const result = await parseFilePatterns(null as unknown as string);
    expect(result).toEqual([]);
  });

  it('should handle undefined input gracefully', async () => {
    const result = await parseFilePatterns(undefined as unknown as string);
    expect(result).toEqual([]);
  });
});
