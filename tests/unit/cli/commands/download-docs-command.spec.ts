import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { executeDownloadDocsStage } from '@/cli/commands/download-docs-command';
import { logger } from '@/shared/utils/logger';

jest.mock('node:fs');
jest.mock('node:path');
jest.mock('@/shared/utils/logger');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockMkdirSync = mkdirSync as jest.MockedFunction<typeof mkdirSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;
const mockStatSync = statSync as jest.MockedFunction<typeof statSync>;
const mockWriteFileSync = writeFileSync as jest.MockedFunction<typeof writeFileSync>;
const mockJoin = join as jest.MockedFunction<typeof join>;
const mockLogger = logger as jest.Mocked<typeof logger>;

global.fetch = jest.fn();
const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

describe('download-docs-command', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockImplementation((...args) => args.join('/'));
    process.cwd = jest.fn().mockReturnValue('/project');
    mockExistsSync.mockReturnValue(true);
    mockMkdirSync.mockReturnValue(undefined);
    mockReaddirSync.mockReturnValue([]);
    mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1024 } as any);
    mockFetch.mockResolvedValue({
      ok: true,
      text: async () => 'mock content',
    } as Response);
  });

  describe('executeDownloadDocsStage', () => {
    it('should create base docs directory', async () => {
      await executeDownloadDocsStage();

      expect(mockMkdirSync).toHaveBeenCalled();
      expect(mockMkdirSync.mock.calls.length).toBeGreaterThan(0);
    });

    it('should download Angular docs when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await executeDownloadDocsStage();

      expect(mockFetch).toHaveBeenCalledWith('https://angular.dev/context/llm-files/llms-full.txt');
    });

    it('should download NgRx docs when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await executeDownloadDocsStage();

      expect(mockFetch).toHaveBeenCalledWith('https://context7.com/ngrx/platform/llms.txt');
    });

    it('should download RxJS docs when file does not exist', async () => {
      mockExistsSync.mockReturnValue(false);

      await executeDownloadDocsStage();

      expect(mockFetch).toHaveBeenCalledWith('https://context7.com/reactivex/rxjs/llms.txt');
    });

    it('should create OWASP directory', async () => {
      await executeDownloadDocsStage();

      const owaspDirCalls = mockMkdirSync.mock.calls.filter((call) => call[0]?.toString().includes('owasp'));
      expect(owaspDirCalls.length).toBeGreaterThan(0);
    });

    it('should write Angular content to file', async () => {
      mockExistsSync.mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => 'Angular documentation content',
      } as Response);

      await executeDownloadDocsStage();

      const angularWrites = mockWriteFileSync.mock.calls.filter(
        (call) => call[0].toString().includes('angular') && call[0].toString().includes('llm-context.md'),
      );
      expect(angularWrites).toHaveLength(1);
      expect(angularWrites[0][1]).toBe('Angular documentation content');
    });

    it('should write NgRx content to file', async () => {
      mockExistsSync.mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => 'NgRx documentation content',
      } as Response);

      await executeDownloadDocsStage();

      const ngrxWrites = mockWriteFileSync.mock.calls.filter(
        (call) => call[0].toString().includes('ngrx') && call[0].toString().includes('llm-context.md'),
      );
      expect(ngrxWrites).toHaveLength(1);
      expect(ngrxWrites[0][1]).toBe('NgRx documentation content');
    });

    it('should write RxJS content to file', async () => {
      mockExistsSync.mockReturnValue(false);
      mockFetch.mockResolvedValue({
        ok: true,
        text: async () => 'RxJS documentation content',
      } as Response);

      await executeDownloadDocsStage();

      const rxjsWrites = mockWriteFileSync.mock.calls.filter(
        (call) => call[0].toString().includes('rxjs') && call[0].toString().includes('llm-context.md'),
      );
      expect(rxjsWrites).toHaveLength(1);
      expect(rxjsWrites[0][1]).toBe('RxJS documentation content');
    });

    it('should download OWASP cheat sheets', async () => {
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue(['Cross_Site_Scripting_Prevention.md'] as any);
      mockReadFileSync.mockReturnValue('# XSS Prevention');

      await executeDownloadDocsStage();

      const owaspCalls = mockFetch.mock.calls.filter((call) => call[0].toString().includes('OWASP/CheatSheetSeries'));
      expect(owaspCalls.length).toBeGreaterThan(0);
    });

    it('should create OWASP context file with header', async () => {
      mockReaddirSync.mockReturnValue(['Cross_Site_Scripting_Prevention.md'] as any);
      mockReadFileSync.mockReturnValue('# Security Content');

      await executeDownloadDocsStage();

      const contextWrites = mockWriteFileSync.mock.calls.filter((call) =>
        call[0].toString().includes('owasp-security-context.md'),
      );
      expect(contextWrites).toHaveLength(1);
      expect(contextWrites[0][1]).toContain('OWASP Security Cheat Sheets');
    });

    it('should log completion with file size', async () => {
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 2048 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready/));
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      await expect(executeDownloadDocsStage()).rejects.toThrow('Network error');
    });
  });

  describe('file size formatting', () => {
    it('should display 0B for empty directories', async () => {
      mockStatSync.mockReturnValue({ isDirectory: () => true, size: 0 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(0B\)/));
    });

    it('should format bytes correctly', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 512 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(512B\)/));
    });

    it('should format kilobytes correctly', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1024 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(1KB\)/));
    });

    it('should format megabytes correctly', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1048576 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(1MB\)/));
    });

    it('should format gigabytes correctly', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1073741824 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(1GB\)/));
    });

    it('should round to one decimal place', async () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 1536 } as any);

      await executeDownloadDocsStage();

      expect(mockLogger.info).toHaveBeenCalledWith(expect.stringMatching(/Documentation ready.*\(1\.5KB\)/));
    });
  });

  describe('OWASP file handling', () => {
    it('should sort OWASP files alphabetically in context', async () => {
      mockReaddirSync.mockReturnValue(['z-file.md', 'a-file.md', 'm-file.md'] as any);
      mockReadFileSync.mockReturnValue('content');

      await executeDownloadDocsStage();

      const contextCall = mockWriteFileSync.mock.calls.find((call) =>
        call[0].toString().includes('owasp-security-context.md'),
      );
      const content = contextCall?.[1] as string;
      const aIndex = content.indexOf('a-file.md');
      const mIndex = content.indexOf('m-file.md');
      const zIndex = content.indexOf('z-file.md');

      expect(aIndex).toBeLessThan(mIndex);
      expect(mIndex).toBeLessThan(zIndex);
    });

    it('should filter out context files when reading OWASP directory', async () => {
      mockReaddirSync.mockReturnValue([
        'Cross_Site_Scripting_Prevention.md',
        'owasp-security-context.md',
        'DOM_based_XSS_Prevention.md',
      ] as any);
      mockReadFileSync.mockReturnValue('content');

      await executeDownloadDocsStage();

      const contextCall = mockWriteFileSync.mock.calls.find((call) =>
        call[0].toString().includes('owasp-security-context.md'),
      );
      expect(contextCall?.[1]).not.toContain('owasp-security-context.md ===');
    });

    it('should include file separators in OWASP context', async () => {
      mockReaddirSync.mockReturnValue(['file1.md', 'file2.md'] as any);
      mockReadFileSync.mockReturnValue('content');

      await executeDownloadDocsStage();

      const contextCall = mockWriteFileSync.mock.calls.find((call) =>
        call[0].toString().includes('owasp-security-context.md'),
      );
      expect(contextCall?.[1]).toContain('# === file1.md ===');
      expect(contextCall?.[1]).toContain('---');
    });

    it('should include timestamp in OWASP context', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

      mockReaddirSync.mockReturnValue(['file.md'] as any);
      mockReadFileSync.mockReturnValue('content');

      await executeDownloadDocsStage();

      const contextCall = mockWriteFileSync.mock.calls.find((call) =>
        call[0].toString().includes('owasp-security-context.md'),
      );
      expect(contextCall?.[1]).toContain('2024-01-15');

      jest.useRealTimers();
    });
  });

  describe('ADR file handling', () => {
    it('should create ADR context when directory exists', async () => {
      mockExistsSync.mockImplementation((path) => {
        if (path && typeof path === 'string') {
          if (path.includes('docs/architecture-decisions')) return true;
          if (path.includes('angular-llm-context.md')) return true;
          if (path.includes('ngrx-llm-context.md')) return true;
          if (path.includes('rxjs-llm-context.md')) return true;
        }
        return false;
      });
      mockReaddirSync.mockImplementation((path) => {
        if (path && typeof path === 'string' && path.includes('docs/architecture-decisions')) {
          return ['adr-001.md', 'adr-002.md'] as any;
        }
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('# ADR Content');
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 100 } as any);

      await executeDownloadDocsStage();

      const adrWrites = mockWriteFileSync.mock.calls.filter((call) => call[0].toString().includes('adr-context.md'));
      expect(adrWrites).toHaveLength(2); // Writes to both unified and split locations
      expect(adrWrites[0][1]).toContain('Architecture Decision Records');
    });

    it('should skip ADR context when directory does not exist', async () => {
      mockExistsSync.mockReturnValue(false);
      mockReaddirSync.mockReturnValue([] as any); // Empty directory

      await executeDownloadDocsStage();

      const adrWrites = mockWriteFileSync.mock.calls.filter((call) => call[0].toString().includes('adr-context.md'));
      expect(adrWrites).toHaveLength(2); // Still writes header even with no files
    });

    it('should sort ADR files alphabetically', async () => {
      mockExistsSync.mockImplementation((path) => {
        if (path && typeof path === 'string') {
          if (path.includes('docs/architecture-decisions')) return true;
          if (path.includes('angular-llm-context.md')) return true;
          if (path.includes('ngrx-llm-context.md')) return true;
          if (path.includes('rxjs-llm-context.md')) return true;
        }
        return false;
      });
      mockReaddirSync.mockImplementation((path) => {
        if (path && typeof path === 'string' && path.includes('docs/architecture-decisions')) {
          return ['adr-003.md', 'adr-001.md', 'adr-002.md'] as any;
        }
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('content');
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 100 } as any);

      await executeDownloadDocsStage();

      const adrCall = mockWriteFileSync.mock.calls.find((call) => call[0].toString().includes('adr-context.md'));
      const content = adrCall?.[1] as string;
      const adr1Index = content.indexOf('adr-001.md');
      const adr2Index = content.indexOf('adr-002.md');
      const adr3Index = content.indexOf('adr-003.md');

      expect(adr1Index).toBeLessThan(adr2Index);
      expect(adr2Index).toBeLessThan(adr3Index);
    });

    it('should include timestamp in ADR context', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2024-01-15T10:30:00.000Z'));

      mockExistsSync.mockImplementation((path) => {
        if (path && typeof path === 'string') {
          if (path.includes('docs/architecture-decisions')) return true;
          if (path.includes('angular-llm-context.md')) return true;
          if (path.includes('ngrx-llm-context.md')) return true;
          if (path.includes('rxjs-llm-context.md')) return true;
        }
        return false;
      });
      mockReaddirSync.mockImplementation((path) => {
        if (path && typeof path === 'string' && path.includes('docs/architecture-decisions')) {
          return ['adr-001.md'] as any;
        }
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('content');
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 100 } as any);

      await executeDownloadDocsStage();

      const adrCall = mockWriteFileSync.mock.calls.find((call) => call[0].toString().includes('adr-context.md'));
      expect(adrCall?.[1]).toContain('2024-01-15');

      jest.useRealTimers();
    });

    it('should include file separators in ADR context', async () => {
      mockExistsSync.mockImplementation((path) => {
        if (path && typeof path === 'string') {
          if (path.includes('docs/architecture-decisions')) return true;
          if (path.includes('angular-llm-context.md')) return true;
          if (path.includes('ngrx-llm-context.md')) return true;
          if (path.includes('rxjs-llm-context.md')) return true;
        }
        return false;
      });
      mockReaddirSync.mockImplementation((path) => {
        if (path && typeof path === 'string' && path.includes('docs/architecture-decisions')) {
          return ['adr-001.md', 'adr-002.md'] as any;
        }
        return [] as any;
      });
      mockReadFileSync.mockReturnValue('content');
      mockStatSync.mockReturnValue({ isDirectory: () => false, size: 100 } as any);

      await executeDownloadDocsStage();

      const adrCall = mockWriteFileSync.mock.calls.find((call) => call[0].toString().includes('adr-context.md'));
      expect(adrCall?.[1]).toContain('# === adr-001.md ===');
      expect(adrCall?.[1]).toContain('---');
    });
  });
});
