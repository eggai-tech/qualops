import { readFile } from 'node:fs/promises';

import type { ReviewIssue } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';
import {
  generateCodeSection,
  generateDirectoryHeader,
  generateFileHeader,
  generateIssueCard,
} from '../templates/components.ts';
import {
  buildFileTree,
  type FixSuggestion,
  generateSafeId,
  groupIssuesByFile,
  sortDirectoriesByIssues,
} from '../utils/data-transformer.ts';
import { escapeHtml } from '../utils/formatters.ts';
import { generateIssuesSection } from './issues-generator.ts';

jest.mock('node:fs/promises');
jest.mock('../../../shared/utils/file-utils.ts', () => ({
  validateFilePath: jest.fn(),
}));
jest.mock('../../../shared/utils/logger.ts');
jest.mock('../templates/components.ts');
jest.mock('../utils/data-transformer.ts');
jest.mock('../utils/formatters.ts');

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;
const mockGenerateCodeSection = generateCodeSection as jest.MockedFunction<typeof generateCodeSection>;
const mockGenerateDirectoryHeader = generateDirectoryHeader as jest.MockedFunction<typeof generateDirectoryHeader>;
const mockGenerateFileHeader = generateFileHeader as jest.MockedFunction<typeof generateFileHeader>;
const mockGenerateIssueCard = generateIssueCard as jest.MockedFunction<typeof generateIssueCard>;
const mockBuildFileTree = buildFileTree as jest.MockedFunction<typeof buildFileTree>;
const mockGenerateSafeId = generateSafeId as jest.MockedFunction<typeof generateSafeId>;
const mockGroupIssuesByFile = groupIssuesByFile as jest.MockedFunction<typeof groupIssuesByFile>;
const mockSortDirectoriesByIssues = sortDirectoriesByIssues as jest.MockedFunction<typeof sortDirectoriesByIssues>;
const mockEscapeHtml = escapeHtml as jest.MockedFunction<typeof escapeHtml>;

const { validateFilePath } = jest.requireMock('../../../shared/utils/file-utils.ts') as { validateFilePath: jest.Mock };
const mockValidateFilePath = validateFilePath;

describe('issues-generator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEscapeHtml.mockImplementation((text) => text);
    mockGenerateSafeId.mockImplementation((id) => id.replace(/[^a-zA-Z0-9]/g, '-'));
  });

  describe('generateIssuesSection', () => {
    const createMockIssue = (overrides?: Partial<ReviewIssue>): ReviewIssue => ({
      id: 'issue-1',
      file: '/path/to/file.ts',
      line: 10,
      description: 'Test issue',
      severity: 'high',
      type: 'bug',
      location: 'line 10',
      suggestion: 'Fix the issue',
      reasoning: 'This is a problem',
      category: 'logic',
      confidence: 8,
      context: 'const x = 1;',
      ...overrides,
    });

    describe('basic functionality', () => {
      it('should generate issues section with single issue', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path/to', { files: ['/path/to/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path/to', { files: ['/path/to/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/to/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Directory Header</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File Header</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Issue Card</div>');
        mockReadFile.mockResolvedValue('const x = 1;\nconst y = 2;\n');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('Directory Header');
        expect(result).toContain('File Header');
        expect(result).toContain('Issue Card');
      });

      it('should generate issues section with multiple issues', async () => {
        const issues = [
          createMockIssue({ id: 'issue-1', file: '/path/file1.ts' }),
          createMockIssue({ id: 'issue-2', file: '/path/file2.ts' }),
        ];
        const fileTree = new Map([['/path', { files: ['/path/file1.ts', '/path/file2.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([
          ['/path', { files: ['/path/file1.ts', '/path/file2.ts'], issues }],
        ]);
        mockGroupIssuesByFile.mockReturnValue(
          new Map([
            ['/path/file1.ts', [issues[0]]],
            ['/path/file2.ts', [issues[1]]],
          ]),
        );
        mockGenerateDirectoryHeader.mockReturnValue('<div>Directory</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateFileHeader).toHaveBeenCalledTimes(2);
        expect(mockGenerateIssueCard).toHaveBeenCalledTimes(2);
      });

      it('should handle empty issues array', async () => {
        mockBuildFileTree.mockReturnValue(new Map());
        mockSortDirectoriesByIssues.mockReturnValue([]);

        const result = await generateIssuesSection([], null);

        expect(result).toBe('');
      });
    });

    describe('file tree handling', () => {
      it('should build file tree from issues', async () => {
        const issues = [createMockIssue()];
        mockBuildFileTree.mockReturnValue(new Map());
        mockSortDirectoriesByIssues.mockReturnValue([]);

        await generateIssuesSection(issues, null);

        expect(mockBuildFileTree).toHaveBeenCalledWith(issues);
      });

      it('should sort directories by issues', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/dir', { files: [], issues }]]);
        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([]);

        await generateIssuesSection(issues, null);

        expect(mockSortDirectoriesByIssues).toHaveBeenCalledWith(fileTree);
      });

      it('should handle multiple directories', async () => {
        const issues = [createMockIssue({ file: '/dir1/file.ts' }), createMockIssue({ file: '/dir2/file.ts' })];
        const fileTree = new Map([
          ['/dir1', { files: ['/dir1/file.ts'], issues: [issues[0]] }],
          ['/dir2', { files: ['/dir2/file.ts'], issues: [issues[1]] }],
        ]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([
          ['/dir1', { files: ['/dir1/file.ts'], issues: [issues[0]] }],
          ['/dir2', { files: ['/dir2/file.ts'], issues: [issues[1]] }],
        ]);
        mockGroupIssuesByFile
          .mockReturnValueOnce(new Map([['/dir1/file.ts', [issues[0]]]]))
          .mockReturnValueOnce(new Map([['/dir2/file.ts', [issues[1]]]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateDirectoryHeader).toHaveBeenCalledTimes(2);
      });
    });

    describe('code preview generation', () => {
      it('should read file for code preview', async () => {
        const issues = [createMockIssue({ file: '/test/file.ts', location: 'line 5' })];
        const fileTree = new Map([['/test', { files: ['/test/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/test', { files: ['/test/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/test/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('line1\nline2\nline3\nline4\nline5\n');

        await generateIssuesSection(issues, null);

        expect(mockReadFile).toHaveBeenCalledWith('/test/file.ts', 'utf-8');
      });

      it('should handle file read errors gracefully', async () => {
        const issues = [createMockIssue({ file: '/test/file.ts' })];
        const fileTree = new Map([['/test', { files: ['/test/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/test', { files: ['/test/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/test/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockRejectedValue(new Error('File not found'));

        const result = await generateIssuesSection(issues, null);

        expect(logger.warn).toHaveBeenCalled();
        expect(result).toContain('Card');
      });

      it('should handle validation errors', async () => {
        const issues = [createMockIssue({ file: '/test/file.ts' })];
        const fileTree = new Map([['/test', { files: ['/test/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/test', { files: ['/test/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/test/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockValidateFilePath.mockRejectedValue(new Error('Invalid path'));

        const result = await generateIssuesSection(issues, null);

        expect(logger.warn).toHaveBeenCalled();
        expect(result).toContain('Card');
      });
    });

    describe('fix suggestions handling', () => {
      it('should handle fix suggestions when provided', async () => {
        const issues = [createMockIssue({ id: 'issue-1' })];
        const fixSuggestions: { suggestions: FixSuggestion[] } = {
          suggestions: [
            {
              issueId: 'issue-1',
              file: '/path/to/file.ts',
              line: 10,
              originalCode: 'const x = 1;',
              suggestedCode: 'const x = 2;',
              explanation: 'Fix explanation',
              confidence: 'high',
              breaking: false,
              applied: false,
            },
          ],
        };
        const fileTree = new Map([['/path/to', { files: ['/path/to/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path/to', { files: ['/path/to/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/to/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('const x = 1;\nconst y = 2;\n');

        await generateIssuesSection(issues, fixSuggestions);

        expect(mockGenerateIssueCard).toHaveBeenCalled();
        const callArg = mockGenerateIssueCard.mock.calls[0][1];
        expect(callArg).toContain('Suggested Fix');
      });

      it('should handle no matching fix suggestion', async () => {
        const issues = [createMockIssue({ id: 'issue-1' })];
        const fixSuggestions: { suggestions: FixSuggestion[] } = {
          suggestions: [
            {
              issueId: 'issue-2',
              file: '/path/file.ts',
              line: 10,
              originalCode: 'code',
              suggestedCode: 'fixed',
              explanation: 'explanation',
              confidence: 'high',
              breaking: false,
              applied: false,
            },
          ],
        };
        const fileTree = new Map([['/path/to', { files: ['/path/to/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path/to', { files: ['/path/to/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/to/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');
        mockGenerateCodeSection.mockReturnValue('<div>Code</div>');

        await generateIssuesSection(issues, fixSuggestions);

        expect(mockGenerateCodeSection).toHaveBeenCalled();
      });

      it('should handle null fix suggestions', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');
        mockGenerateCodeSection.mockReturnValue('<div>Code</div>');

        await generateIssuesSection(issues, null);

        expect(mockGenerateCodeSection).toHaveBeenCalled();
      });
    });

    describe('directory and file headers', () => {
      it('should generate directory header with correct data', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path/to', { files: ['/path/to/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path/to', { files: ['/path/to/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/to/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateDirectoryHeader).toHaveBeenCalledWith('/path/to', expect.any(String), issues);
      });

      it('should generate file header with issue count', async () => {
        const issues = [createMockIssue(), createMockIssue({ id: 'issue-2' })];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateFileHeader).toHaveBeenCalledWith('file.ts', expect.any(String), 2);
      });

      it('should extract file name from path', async () => {
        const issues = [createMockIssue({ file: '/very/long/path/to/my-file.ts' })];
        const fileTree = new Map([['/very/long/path/to', { files: ['/very/long/path/to/my-file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([
          ['/very/long/path/to', { files: ['/very/long/path/to/my-file.ts'], issues }],
        ]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/very/long/path/to/my-file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateFileHeader).toHaveBeenCalledWith('my-file.ts', expect.any(String), 1);
      });
    });

    describe('safe ID generation', () => {
      it('should generate safe IDs for directories', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path/to', { files: ['/path/to/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path/to', { files: ['/path/to/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/to/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateSafeId).toHaveBeenCalledWith('/path/to');
      });

      it('should generate safe IDs for files', async () => {
        const issues = [createMockIssue({ file: '/path/file.ts' })];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateSafeId).toHaveBeenCalledWith('/path/file.ts');
      });
    });

    describe('HTML structure', () => {
      it('should include directory section wrapper', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('directory-section');
        expect(result).toContain('directory-content');
      });

      it('should include file section wrapper', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('file-section');
        expect(result).toContain('file-content');
      });

      it('should hide content by default', async () => {
        const issues = [createMockIssue()];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('display: none');
      });
    });

    describe('edge cases', () => {
      it('should handle issue with missing file field', async () => {
        const issues = [createMockIssue({ file: undefined })];
        const fileTree = new Map([['unknown', { files: ['unknown'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['unknown', { files: ['unknown'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['unknown', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('Card');
      });

      it('should handle very long file paths', async () => {
        const longPath = '/very/long/path/with/many/directories/file.ts';
        const issues = [createMockIssue({ file: longPath })];
        const fileTree = new Map([['/very/long/path/with/many/directories', { files: [longPath], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([
          ['/very/long/path/with/many/directories', { files: [longPath], issues }],
        ]);
        mockGroupIssuesByFile.mockReturnValue(new Map([[longPath, issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('Card');
      });

      it('should handle multiple issues in same file', async () => {
        const issues = [
          createMockIssue({ id: 'i1', file: '/file.ts', line: 10 }),
          createMockIssue({ id: 'i2', file: '/file.ts', line: 20 }),
          createMockIssue({ id: 'i3', file: '/file.ts', line: 30 }),
        ];
        const fileTree = new Map([['', { files: ['/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['', { files: ['/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockGenerateIssueCard).toHaveBeenCalledTimes(3);
      });
    });

    describe('async operations', () => {
      it('should handle parallel file reads', async () => {
        const issues = [createMockIssue({ file: '/file1.ts' }), createMockIssue({ file: '/file2.ts' })];
        const fileTree = new Map([
          ['', { files: ['/file1.ts'], issues: [issues[0]] }],
          ['', { files: ['/file2.ts'], issues: [issues[1]] }],
        ]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([
          ['', { files: ['/file1.ts'], issues: [issues[0]] }],
          ['', { files: ['/file2.ts'], issues: [issues[1]] }],
        ]);
        mockGroupIssuesByFile
          .mockReturnValueOnce(new Map([['/file1.ts', [issues[0]]]]))
          .mockReturnValueOnce(new Map([['/file2.ts', [issues[1]]]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValue('<div>Card</div>');
        mockReadFile.mockResolvedValue('code');

        await generateIssuesSection(issues, null);

        expect(mockReadFile).toHaveBeenCalledTimes(2);
      });

      it('should handle Promise.all for issue cards', async () => {
        const issues = [createMockIssue({ id: 'i1' }), createMockIssue({ id: 'i2' })];
        const fileTree = new Map([['/path', { files: ['/path/file.ts'], issues }]]);

        mockBuildFileTree.mockReturnValue(fileTree);
        mockSortDirectoriesByIssues.mockReturnValue([['/path', { files: ['/path/file.ts'], issues }]]);
        mockGroupIssuesByFile.mockReturnValue(new Map([['/path/file.ts', issues]]));
        mockGenerateDirectoryHeader.mockReturnValue('<div>Dir</div>');
        mockGenerateFileHeader.mockReturnValue('<div>File</div>');
        mockGenerateIssueCard.mockResolvedValueOnce('<div>Card1</div>').mockResolvedValueOnce('<div>Card2</div>');
        mockReadFile.mockResolvedValue('code');

        const result = await generateIssuesSection(issues, null);

        expect(result).toContain('Card1');
        expect(result).toContain('Card2');
      });
    });
  });
});
