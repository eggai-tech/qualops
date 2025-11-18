import { shouldProcessFile } from '../../../shared/utils/filters';
import { logger } from '../../../shared/utils/logger';
import { getChangedFiles } from './changed-files';
import { executeGitCommand } from './git-utils';

jest.mock('../../../shared/utils/logger');
jest.mock('./git-utils');
jest.mock('../../../shared/utils/filters');

const mockExecuteGitCommand = executeGitCommand as jest.MockedFunction<typeof executeGitCommand>;
const mockLogger = logger as jest.Mocked<typeof logger>;
const mockShouldProcessFile = shouldProcessFile as jest.MockedFunction<typeof shouldProcessFile>;

describe('changed-files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockShouldProcessFile.mockReturnValue(true);
  });

  describe('getChangedFiles', () => {
    it('should return changed TypeScript files', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nsrc/utils.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(mockLogger.git).toHaveBeenCalledWith('Getting changed files: main..HEAD');
      expect(mockExecuteGitCommand).toHaveBeenCalledWith(['diff', '--name-only', '--diff-filter=ACMRT', 'main...HEAD']);
      expect(mockExecuteGitCommand).toHaveBeenCalledWith(['diff', '--cached', '--name-only', '--diff-filter=ACMRT']);
      expect(mockExecuteGitCommand).toHaveBeenCalledWith(['diff', '--name-only', '--diff-filter=ACMRT']);
      expect(mockExecuteGitCommand).toHaveBeenCalledWith(['ls-files', '--others', '--exclude-standard']);
      expect(result).toEqual(['src/app.ts', 'src/utils.ts']);
      expect(mockLogger.git).toHaveBeenCalledWith('Found 2 changed TypeScript files');
    });

    it('should use default base when not provided', async () => {
      mockExecuteGitCommand.mockReturnValue('');

      await getChangedFiles();

      expect(mockLogger.git).toHaveBeenCalledWith('Getting changed files: main..HEAD');
      expect(mockExecuteGitCommand).toHaveBeenCalledWith(['diff', '--name-only', '--diff-filter=ACMRT', 'main...HEAD']);
    });

    it('should use custom base branch', async () => {
      mockExecuteGitCommand.mockReturnValue('');

      await getChangedFiles('develop');

      expect(mockLogger.git).toHaveBeenCalledWith('Getting changed files: develop..HEAD');
      expect(mockExecuteGitCommand).toHaveBeenCalledWith([
        'diff',
        '--name-only',
        '--diff-filter=ACMRT',
        'develop...HEAD',
      ]);
    });

    it('should combine files from all git commands', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('committed.ts')
        .mockReturnValueOnce('staged.ts')
        .mockReturnValueOnce('unstaged.ts')
        .mockReturnValueOnce('untracked.ts');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['committed.ts', 'staged.ts', 'unstaged.ts', 'untracked.ts']);
    });

    it('should deduplicate files across different git commands', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nsrc/utils.ts')
        .mockReturnValueOnce('src/app.ts')
        .mockReturnValueOnce('src/utils.ts')
        .mockReturnValueOnce('src/new.ts');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts', 'src/utils.ts', 'src/new.ts']);
    });

    it('should filter out non-TypeScript files', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nsrc/styles.css\nsrc/readme.md\nsrc/utils.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should filter out node_modules files', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nnode_modules/package/index.ts\nnode_modules/lib/util.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts']);
    });

    it('should filter using shouldProcessFile', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nsrc/test.spec.ts\nsrc/types.d.ts\nsrc/utils.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      mockShouldProcessFile.mockImplementation((file) => !file.includes('spec') && !file.includes('.d.ts'));

      const result = await getChangedFiles('main');

      expect(mockShouldProcessFile).toHaveBeenCalledWith('src/app.ts');
      expect(mockShouldProcessFile).toHaveBeenCalledWith('src/test.spec.ts');
      expect(mockShouldProcessFile).toHaveBeenCalledWith('src/types.d.ts');
      expect(mockShouldProcessFile).toHaveBeenCalledWith('src/utils.ts');
      expect(result).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should return empty array when no files changed', async () => {
      mockExecuteGitCommand.mockReturnValue('');

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
      expect(mockLogger.git).toHaveBeenCalledWith('Getting changed files: main..HEAD');
    });

    it('should handle empty committedFiles', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('')
        .mockReturnValueOnce('staged.ts')
        .mockReturnValueOnce('unstaged.ts')
        .mockReturnValueOnce('untracked.ts');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['staged.ts', 'unstaged.ts', 'untracked.ts']);
    });

    it('should handle empty stagedFiles', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('committed.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('unstaged.ts')
        .mockReturnValueOnce('untracked.ts');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['committed.ts', 'unstaged.ts', 'untracked.ts']);
    });

    it('should handle empty unstagedFiles', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('committed.ts')
        .mockReturnValueOnce('staged.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('untracked.ts');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['committed.ts', 'staged.ts', 'untracked.ts']);
    });

    it('should handle empty untrackedFiles', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('committed.ts')
        .mockReturnValueOnce('staged.ts')
        .mockReturnValueOnce('unstaged.ts')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['committed.ts', 'staged.ts', 'unstaged.ts']);
    });

    it('should return empty array when all commands return empty', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
    });

    it('should return empty array when all files filtered out', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/styles.css\nsrc/readme.md')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
      expect(mockLogger.git).toHaveBeenCalledWith('Found 0 changed TypeScript files');
    });

    it('should trim whitespace from file paths', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('  src/app.ts  \n  src/utils.ts  ')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts', 'src/utils.ts']);
    });

    it('should handle files with multiple extensions', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('component.spec.ts\ncomponent.ts\nutils.test.ts\nutils.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      mockShouldProcessFile.mockImplementation((file) => !file.includes('spec') && !file.includes('test'));

      const result = await getChangedFiles('main');

      expect(result).toEqual(['component.ts', 'utils.ts']);
    });

    it('should handle deeply nested file paths', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('apps/platform/services/api/gateway/src/main.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['apps/platform/services/api/gateway/src/main.ts']);
    });

    it('should handle tsx files', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('Component.tsx\nApp.tsx')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      mockShouldProcessFile.mockReturnValue(true);

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
    });

    it('should return empty array on executeGitCommand error', async () => {
      mockExecuteGitCommand.mockImplementation(() => {
        throw new Error('git command failed');
      });

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith('Error getting changed files:', 'git command failed');
    });

    it('should handle error with non-Error object', async () => {
      mockExecuteGitCommand.mockImplementation(() => {
        throw { message: 'custom error' };
      });

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalledWith('Error getting changed files:', 'custom error');
    });

    it('should handle error on first git command', async () => {
      mockExecuteGitCommand.mockImplementationOnce(() => {
        throw new Error('Failed to get committed files');
      });

      const result = await getChangedFiles('main');

      expect(result).toEqual([]);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('should handle mixed file types correctly', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nsrc/style.css\nsrc/readme.md')
        .mockReturnValueOnce('src/utils.ts\nsrc/image.png')
        .mockReturnValueOnce('src/service.ts\nsrc/config.json')
        .mockReturnValueOnce('src/new.ts\nsrc/package.json');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts', 'src/utils.ts', 'src/service.ts', 'src/new.ts']);
    });

    it('should preserve file order', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('z-file.ts\na-file.ts\nm-file.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['z-file.ts', 'a-file.ts', 'm-file.ts']);
    });

    it('should handle single file change', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts']);
      expect(mockLogger.git).toHaveBeenCalledWith('Found 1 changed TypeScript files');
    });

    it('should handle commit SHA as base', async () => {
      mockExecuteGitCommand.mockReturnValue('');

      await getChangedFiles('abc123def456');

      expect(mockLogger.git).toHaveBeenCalledWith('Getting changed files: abc123def456..HEAD');
      expect(mockExecuteGitCommand).toHaveBeenCalledWith([
        'diff',
        '--name-only',
        '--diff-filter=ACMRT',
        'abc123def456...HEAD',
      ]);
    });

    it('should handle many changed files', async () => {
      const manyFiles = Array.from({ length: 100 }, (_, i) => `file-${i}.ts`).join('\n');
      mockExecuteGitCommand
        .mockReturnValueOnce(manyFiles)
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toHaveLength(100);
      expect(mockLogger.git).toHaveBeenCalledWith('Found 100 changed TypeScript files');
    });

    it('should filter each file through shouldProcessFile', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('file1.ts\nfile2.ts\nfile3.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      mockShouldProcessFile.mockReturnValueOnce(true).mockReturnValueOnce(false).mockReturnValueOnce(true);

      const result = await getChangedFiles('main');

      expect(result).toEqual(['file1.ts', 'file3.ts']);
    });

    it('should handle files in node_modules subdirectories', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/app.ts\nnode_modules/@types/node/index.ts\nnode_modules/lib/deep/path/file.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/app.ts']);
    });

    it('should handle empty lines in file list', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('file1.ts\n\n\nfile2.ts\n\n')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['file1.ts', 'file2.ts']);
    });

    it('should handle files with special characters', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('src/my-app-v2.ts\nsrc/utils_helper.ts')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('');

      const result = await getChangedFiles('main');

      expect(result).toEqual(['src/my-app-v2.ts', 'src/utils_helper.ts']);
    });

    it('should call all git commands even if some return empty', async () => {
      mockExecuteGitCommand
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('')
        .mockReturnValueOnce('new-file.ts');

      const result = await getChangedFiles('main');

      expect(mockExecuteGitCommand).toHaveBeenCalledTimes(4);
      expect(result).toEqual(['new-file.ts']);
    });
  });
});
