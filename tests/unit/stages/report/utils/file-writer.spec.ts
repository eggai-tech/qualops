import { writeFile } from 'node:fs/promises';
import * as path from 'node:path';

import {
  type FileWriteOptions,
  getFileSizeSummary,
  validateContent,
  writeCIReport,
  writeCSVReport,
  writeHTMLReport,
  writeJSONReport,
  writeMarkdownReport,
  writeMultipleReports,
  writeReportFile,
} from '@/stages/report/utils/file-writer.ts';

jest.mock('node:fs/promises');
jest.mock('@/shared/runtime/session-context.ts');
jest.mock('@/shared/utils/file-utils.ts', () => ({
  validateFilePath: jest.fn(),
  ensureDirectoryExists: jest.fn(),
}));
jest.mock('@/shared/utils/logger.ts');

const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockGetCurrentSessionPaths = jest.requireMock('@/shared/runtime/session-context.ts')
  .getCurrentSessionPaths as jest.Mock;
const mockLogger = jest.requireMock('@/shared/utils/logger.ts').logger;

jest.requireMock('@/shared/utils/file-utils.ts') as {
  validateFilePath: jest.Mock;
  ensureDirectoryExists: jest.Mock;
};

describe('file-writer', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetCurrentSessionPaths.mockReturnValue({
      sessionReport: () => '/test/session/reports/report.html',
      sessionDir: () => '/test/session',
    });

    mockWriteFile.mockResolvedValue(undefined);

    mockLogger.info = jest.fn();
    mockLogger.error = jest.fn();
  });

  describe('writeReportFile', () => {
    it('should write file with default options', async () => {
      const content = 'test content';
      const fileName = 'test.txt';

      const result = await writeReportFile(fileName, content);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), content, 'utf-8');
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Wrote test.txt report'));
      expect(result).toBe(path.join('/test/session/reports', fileName));
    });

    it('should write file with custom encoding', async () => {
      const content = 'test content';
      const fileName = 'test.txt';
      const options: FileWriteOptions = { encoding: 'ascii' };

      await writeReportFile(fileName, content, options);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), content, 'ascii');
    });

    it('should skip directory creation when createDir is false', async () => {
      const content = 'test content';
      const fileName = 'test.txt';
      const options: FileWriteOptions = { createDir: false };

      await writeReportFile(fileName, content, options);

      expect(mockWriteFile).toHaveBeenCalled();
    });

    it('should use session report path for report.html', async () => {
      const content = '<html></html>';
      const fileName = 'report.html';

      const result = await writeReportFile(fileName, content);

      expect(result).toBe('/test/session/reports/report.html');
    });

    it('should use directory path for non-report.html files', async () => {
      const content = 'test';
      const fileName = 'custom.txt';

      const result = await writeReportFile(fileName, content);

      expect(result).toBe(path.join('/test/session/reports', fileName));
    });

    it('should throw error when write fails', async () => {
      const error = new Error('Write failed');
      mockWriteFile.mockRejectedValue(error);

      await expect(writeReportFile('test.txt', 'content')).rejects.toThrow('Write failed');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to write'));
    });

    it('should log error with filename on failure', async () => {
      mockWriteFile.mockRejectedValue(new Error('Disk full'));

      try {
        await writeReportFile('important.txt', 'content');
      } catch {
        // Expected error, testing error handling
      }

      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('important.txt'));
    });

    it('should handle empty content', async () => {
      await writeReportFile('empty.txt', '');

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), '', 'utf-8');
    });

    it('should handle special characters in filename', async () => {
      const fileName = 'test-file_123.json';

      const result = await writeReportFile(fileName, '{}');

      expect(result).toContain(fileName);
    });
  });

  describe('writeMultipleReports', () => {
    it('should write multiple files concurrently', async () => {
      const reports = [
        { fileName: 'file1.txt', content: 'content1' },
        { fileName: 'file2.txt', content: 'content2' },
        { fileName: 'file3.txt', content: 'content3' },
      ];

      const result = await writeMultipleReports(reports);

      expect(result).toHaveLength(3);
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringContaining('Successfully wrote 3 report files'));
    });

    it('should pass custom options to each write', async () => {
      const reports = [
        { fileName: 'file1.txt', content: 'content1', options: { encoding: 'ascii' as BufferEncoding } },
        { fileName: 'file2.txt', content: 'content2', options: { createDir: false } },
      ];

      await writeMultipleReports(reports);

      expect(mockWriteFile).toHaveBeenCalledTimes(2);
      const calls = mockWriteFile.mock.calls;

      const call1 = calls.find((call) => call[1] === 'content1');
      const call2 = calls.find((call) => call[1] === 'content2');

      expect(call1).toBeDefined();
      expect(call1[2]).toBe('ascii');
      expect(call2).toBeDefined();
      expect(call2[2]).toBe('utf-8');
    });

    it('should throw error if any write fails', async () => {
      mockWriteFile.mockRejectedValueOnce(new Error('Write failed'));

      const reports = [
        { fileName: 'file1.txt', content: 'content1' },
        { fileName: 'file2.txt', content: 'content2' },
      ];

      await expect(writeMultipleReports(reports)).rejects.toThrow('Write failed');
      expect(mockLogger.error).toHaveBeenCalledWith(expect.stringContaining('Failed to write some report files'));
    });

    it('should handle empty reports array', async () => {
      const result = await writeMultipleReports([]);

      expect(result).toHaveLength(0);
      expect(mockWriteFile).not.toHaveBeenCalled();
    });

    it('should return all file paths in order', async () => {
      mockGetCurrentSessionPaths.mockReturnValue({
        sessionReport: () => '/test/reports/report.html',
        sessionDir: () => '/test',
      });

      const reports = [
        { fileName: 'a.txt', content: 'a' },
        { fileName: 'b.txt', content: 'b' },
      ];

      const result = await writeMultipleReports(reports);

      expect(result[0]).toContain('a.txt');
      expect(result[1]).toContain('b.txt');
    });
  });

  describe('writeHTMLReport', () => {
    it('should write HTML content to report.html', async () => {
      const htmlContent = '<html><body>Test</body></html>';

      const result = await writeHTMLReport(htmlContent);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), htmlContent, 'utf-8');
      expect(result).toBe('/test/session/reports/report.html');
    });

    it('should use utf-8 encoding', async () => {
      await writeHTMLReport('<html></html>');

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'utf-8');
    });

    it('should handle large HTML content', async () => {
      const largeHtml = '<html>' + 'x'.repeat(10000) + '</html>';

      await writeHTMLReport(largeHtml);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), largeHtml, 'utf-8');
    });
  });

  describe('writeJSONReport', () => {
    it('should stringify JSON data with formatting', async () => {
      const jsonData = { test: 'value', nested: { key: 'data' } };

      await writeJSONReport(jsonData);

      const expectedContent = JSON.stringify(jsonData, null, 2);
      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expectedContent, 'utf-8');
    });

    it('should write to report.json', async () => {
      const result = await writeJSONReport({ data: 'test' });

      expect(result).toContain('report.json');
    });

    it('should handle arrays', async () => {
      const jsonData = [1, 2, 3, 4, 5];

      await writeJSONReport(jsonData);

      const expectedContent = JSON.stringify(jsonData, null, 2);
      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expectedContent, 'utf-8');
    });

    it('should handle null values', async () => {
      const jsonData = { value: null, other: 'test' };

      await writeJSONReport(jsonData);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('"value": null'), 'utf-8');
    });

    it('should handle empty object', async () => {
      await writeJSONReport({});

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), '{}', 'utf-8');
    });

    it('should handle complex nested structures', async () => {
      const jsonData = {
        level1: {
          level2: {
            level3: {
              value: 'deep',
            },
          },
        },
      };

      await writeJSONReport(jsonData);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('deep'), 'utf-8');
    });
  });

  describe('writeCSVReport', () => {
    it('should write CSV content with default type', async () => {
      const csvContent = 'header1,header2\nvalue1,value2';

      const result = await writeCSVReport(csvContent);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), csvContent, 'utf-8');
      expect(result).toContain('issues.csv');
    });

    it('should use custom type in filename', async () => {
      const csvContent = 'data';

      const result = await writeCSVReport(csvContent, 'metrics');

      expect(result).toContain('metrics.csv');
    });

    it('should handle empty CSV content', async () => {
      await writeCSVReport('');

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), '', 'utf-8');
    });

    it('should handle CSV with special characters', async () => {
      const csvContent = 'name,value\n"test, value",123';

      await writeCSVReport(csvContent);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), csvContent, 'utf-8');
    });

    it('should handle multiline CSV', async () => {
      const csvContent = 'a,b,c\n1,2,3\n4,5,6\n7,8,9';

      await writeCSVReport(csvContent);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), csvContent, 'utf-8');
    });
  });

  describe('writeMarkdownReport', () => {
    it('should write markdown content to report.md', async () => {
      const markdownContent = '# Title\n\nContent here';

      const result = await writeMarkdownReport(markdownContent);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), markdownContent, 'utf-8');
      expect(result).toContain('report.md');
    });

    it('should handle markdown with code blocks', async () => {
      const markdown = '```typescript\nconst x = 5;\n```';

      await writeMarkdownReport(markdown);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), markdown, 'utf-8');
    });

    it('should handle markdown with lists', async () => {
      const markdown = '- Item 1\n- Item 2\n- Item 3';

      await writeMarkdownReport(markdown);

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), markdown, 'utf-8');
    });

    it('should handle empty markdown', async () => {
      await writeMarkdownReport('');

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), '', 'utf-8');
    });
  });

  describe('writeCIReport', () => {
    it('should write CI data as formatted JSON', async () => {
      const ciData = {
        status: 'passed',
        coverage: 85,
        issues: 0,
      };

      const result = await writeCIReport(ciData);

      const expectedContent = JSON.stringify(ciData, null, 2);
      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expectedContent, 'utf-8');
      expect(result).toContain('ci-report.json');
    });

    it('should handle complex CI data structures', async () => {
      const ciData = {
        build: { status: 'success', duration: 120 },
        tests: { passed: 50, failed: 0 },
        metrics: [1, 2, 3],
      };

      await writeCIReport(ciData);

      const expectedContent = JSON.stringify(ciData, null, 2);
      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expectedContent, 'utf-8');
    });

    it('should handle empty CI data', async () => {
      await writeCIReport({});

      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), '{}', 'utf-8');
    });
  });

  describe('getFileSizeSummary', () => {
    it('should calculate size for small content', () => {
      const content = 'hello';

      const result = getFileSizeSummary(content);

      expect(result).toContain('KB');
      expect(result).toContain('bytes');
    });

    it('should calculate size for large content', () => {
      const content = 'x'.repeat(10000);

      const result = getFileSizeSummary(content);

      expect(result).toContain('9.77 KB');
      expect(result).toContain('10000 bytes');
    });

    it('should handle empty content', () => {
      const result = getFileSizeSummary('');

      expect(result).toBe('0.00 KB (0 bytes)');
    });

    it('should handle unicode characters correctly', () => {
      const content = '你好世界';

      const result = getFileSizeSummary(content);

      expect(result).toContain('bytes');
    });

    it('should format decimals to 2 places', () => {
      const content = 'x'.repeat(1234);

      const result = getFileSizeSummary(content);

      expect(result).toMatch(/\d+\.\d{2} KB/);
    });

    it('should handle very large content', () => {
      const content = 'x'.repeat(1000000);

      const result = getFileSizeSummary(content);

      expect(result).toContain('976.56 KB');
    });
  });

  describe('validateContent', () => {
    describe('json validation', () => {
      it('should validate valid JSON', () => {
        const content = '{"key": "value"}';

        const result = validateContent(content, 'json');

        expect(result).toBe(true);
      });

      it('should reject invalid JSON', () => {
        const content = '{key: value}';

        const result = validateContent(content, 'json');

        expect(result).toBe(false);
      });

      it('should validate JSON arrays', () => {
        const content = '[1, 2, 3]';

        const result = validateContent(content, 'json');

        expect(result).toBe(true);
      });

      it('should reject empty JSON', () => {
        const content = '';

        const result = validateContent(content, 'json');

        expect(result).toBe(false);
      });

      it('should reject whitespace-only JSON', () => {
        const content = '   ';

        const result = validateContent(content, 'json');

        expect(result).toBe(false);
      });
    });

    describe('html validation', () => {
      it('should validate HTML with html tag', () => {
        const content = '<html><body>Test</body></html>';

        const result = validateContent(content, 'html');

        expect(result).toBe(true);
      });

      it('should validate HTML with DOCTYPE', () => {
        const content = '<!DOCTYPE html><html></html>';

        const result = validateContent(content, 'html');

        expect(result).toBe(true);
      });

      it('should reject content without HTML markers', () => {
        const content = 'just plain text';

        const result = validateContent(content, 'html');

        expect(result).toBe(false);
      });

      it('should reject empty HTML', () => {
        const content = '';

        const result = validateContent(content, 'html');

        expect(result).toBe(false);
      });

      it('should handle case-insensitive HTML tags', () => {
        const content = '<HTML><BODY>Test</BODY></HTML>';

        const result = validateContent(content, 'html');

        expect(result).toBe(false);
      });
    });

    describe('csv validation', () => {
      it('should validate CSV with commas', () => {
        const content = 'a,b,c\n1,2,3';

        const result = validateContent(content, 'csv');

        expect(result).toBe(true);
      });

      it('should validate CSV with newlines only', () => {
        const content = 'header\nvalue';

        const result = validateContent(content, 'csv');

        expect(result).toBe(true);
      });

      it('should reject content without CSV markers', () => {
        const content = 'plain text without separators';

        const result = validateContent(content, 'csv');

        expect(result).toBe(false);
      });

      it('should reject empty CSV', () => {
        const content = '';

        const result = validateContent(content, 'csv');

        expect(result).toBe(false);
      });

      it('should handle single column CSV', () => {
        const content = 'column1\nvalue1\nvalue2';

        const result = validateContent(content, 'csv');

        expect(result).toBe(true);
      });
    });

    describe('markdown validation', () => {
      it('should validate markdown with headers', () => {
        const content = '# Header\n\nContent';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(true);
      });

      it('should validate markdown with bold', () => {
        const content = '**bold text**';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(true);
      });

      it('should validate markdown with italic', () => {
        const content = '*italic text*';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(true);
      });

      it('should reject content without markdown markers', () => {
        const content = 'plain text';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(false);
      });

      it('should reject empty markdown', () => {
        const content = '';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(false);
      });

      it('should handle lists with asterisks', () => {
        const content = '* item 1\n* item 2';

        const result = validateContent(content, 'markdown');

        expect(result).toBe(true);
      });
    });
  });
});
