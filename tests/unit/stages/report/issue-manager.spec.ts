import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ReviewIssue } from '@/shared/types/index.ts';
import { IssueManager } from '@/stages/report/issue-manager.ts';

jest.mock('node:fs');
jest.mock('node:fs/promises');
jest.mock('node:path');
jest.mock('@/shared/utils/logger.ts');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>;
const mockMkdir = mkdir as jest.MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as jest.MockedFunction<typeof writeFile>;
const mockJoin = join as jest.MockedFunction<typeof join>;

describe('IssueManager', () => {
  let issueManager: IssueManager;
  const issuesDir = '/test/issues';

  beforeEach(() => {
    jest.clearAllMocks();
    mockJoin.mockImplementation((...paths) => paths.join('/'));
    issueManager = new IssueManager(issuesDir);
  });

  describe('initialize', () => {
    it('should create issues directory', async () => {
      mockMkdir.mockResolvedValue(undefined);

      await issueManager.initialize();

      expect(mockMkdir).toHaveBeenCalledWith(issuesDir, { recursive: true });
    });
  });

  describe('getNextIssueId', () => {
    it('should return 1 when directory does not exist', () => {
      mockExistsSync.mockReturnValue(false);

      const result = issueManager.getNextIssueId();

      expect(result).toBe(1);
      expect(mockExistsSync).toHaveBeenCalledWith(issuesDir);
    });

    it('should return 1 when directory is empty', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([] as any);

      const result = issueManager.getNextIssueId();

      expect(result).toBe(1);
    });

    it('should return next ID based on existing files', () => {
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue([
        'ISSUE-001-bug.md',
        'ISSUE-002-error.md',
        'other-file.txt',
        'ISSUE-003-warning.md',
      ] as any);

      const result = issueManager.getNextIssueId();

      expect(result).toBe(4); // 3 matching files + 1
    });
  });

  describe('sanitizeTitle', () => {
    it('should return default for empty title', () => {
      expect(issueManager.sanitizeTitle('')).toBe('untitled-issue');
    });

    it('should return default for null/undefined title', () => {
      expect(issueManager.sanitizeTitle(null as any)).toBe('untitled-issue');
      expect(issueManager.sanitizeTitle(undefined as any)).toBe('untitled-issue');
    });

    it('should convert to lowercase and replace spaces with hyphens', () => {
      expect(issueManager.sanitizeTitle('Fix Memory Leak')).toBe('fix-memory-leak');
    });

    it('should remove special characters', () => {
      expect(issueManager.sanitizeTitle('Fix: Bug #123 (urgent!)')).toBe('fix-bug-123-urgent');
    });

    it('should remove leading/trailing hyphens', () => {
      expect(issueManager.sanitizeTitle('---test---')).toBe('test');
    });

    it('should truncate to 50 characters', () => {
      const longTitle = 'a'.repeat(100);
      const result = issueManager.sanitizeTitle(longTitle);
      expect(result).toHaveLength(50);
    });
  });

  describe('generateIssueMarkdown', () => {
    it('should generate markdown with all fields', () => {
      const issue: ReviewIssue = {
        id: 'test-1',
        description: 'Test issue description',
        file: 'src/test.ts',
        line: 42,
        location: 'line 42',
        severity: 'high',
        type: 'bug',
        reasoning: 'This is the reasoning',
        context: 'const x = 1;',
        suggestion: 'Fix it like this',
        knowledge_source: 'Best practices',
        confidence: 8,
      };

      const result = issueManager.generateIssueMarkdown(issue, 5);

      expect(result).toContain('# ISSUE-005');
      expect(result).toContain('**Status:** OPEN');
      expect(result).toContain('**Severity:** HIGH');
      expect(result).toContain('**Category:** bug');
      expect(result).toContain('**File:** `src/test.ts`');
      expect(result).toContain('**Line:** 42');
      expect(result).toContain('## Description');
      expect(result).toContain('Test issue description');
      expect(result).toContain('## Reasoning');
      expect(result).toContain('This is the reasoning');
      expect(result).toContain('## Context');
      expect(result).toContain('```typescript\nconst x = 1;\n```');
      expect(result).toContain('## Suggested Fix');
      expect(result).toContain('Fix it like this');
      expect(result).toContain('## Knowledge Source');
      expect(result).toContain('Best practices');
      expect(result).toContain('## Confidence');
      expect(result).toContain('8/10');
    });

    it('should handle missing optional fields', () => {
      const issue: ReviewIssue = {
        id: 'test-2',
        type: 'bug',
        severity: 'medium',
        description: 'Minimal issue',
        file: 'src/minimal.ts',
        location: 'line 10',
        reasoning: 'Minimal reasoning',
        suggestion: 'Minimal suggestion',
        context: 'minimal context',
        confidence: 5,
      };

      const result = issueManager.generateIssueMarkdown(issue, 1);

      expect(result).toContain('# ISSUE-001');
      expect(result).toContain('**Severity:** MEDIUM');
      expect(result).toContain('**Category:** bug');
      expect(result).toContain('**Line:** line 10');
      expect(result).toContain('## Reasoning');
      expect(result).toContain('## Context');
      expect(result).toContain('## Suggested Fix');
      expect(result).not.toContain('## Knowledge Source');
    });

    it('should use location when line is not provided', () => {
      const issue: ReviewIssue = {
        id: 'test-3',
        type: 'performance',
        severity: 'low',
        description: 'Test',
        file: 'src/test.ts',
        location: 'lines 10-20',
        reasoning: 'test reasoning',
        suggestion: 'test suggestion',
        context: 'test context',
        confidence: 7,
      };

      const result = issueManager.generateIssueMarkdown(issue, 1);

      expect(result).toContain('**Line:** lines 10-20');
    });

    it('should handle confidence value of 0', () => {
      const issue: ReviewIssue = {
        id: 'test-4',
        type: 'security',
        severity: 'critical',
        description: 'Test',
        file: 'src/test.ts',
        location: 'line 1',
        reasoning: 'test reasoning',
        suggestion: 'test suggestion',
        context: 'test context',
        confidence: 0,
      };

      const result = issueManager.generateIssueMarkdown(issue, 1);

      expect(result).toContain('## Confidence');
      expect(result).toContain('0/10');
    });
  });

  describe('writeIssue', () => {
    it('should write issue to file', async () => {
      mockWriteFile.mockResolvedValue(undefined);

      const issue: ReviewIssue = {
        id: 'test-1',
        type: 'bug',
        severity: 'high',
        description: 'Test issue',
        file: 'src/test.ts',
        location: 'line 1',
        reasoning: 'Test reasoning',
        suggestion: 'Test suggestion',
        context: 'test context',
        confidence: 8,
      };

      const result = await issueManager.writeIssue(issue, 3);

      expect(mockJoin).toHaveBeenCalledWith(issuesDir, 'ISSUE-003-test-issue.md');
      expect(mockWriteFile).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('# ISSUE-003'), 'utf-8');
      expect(result).toBe('/test/issues/ISSUE-003-test-issue.md');
    });
  });

  describe('writeAllIssues', () => {
    it('should write all issues and return ID map', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockExistsSync.mockReturnValue(false);

      const issues: ReviewIssue[] = [
        {
          id: 'issue-1',
          type: 'bug',
          severity: 'high',
          description: 'First issue',
          file: 'src/test1.ts',
          location: 'line 1',
          reasoning: 'test reasoning 1',
          suggestion: 'test suggestion 1',
          context: 'test context 1',
          confidence: 8,
        },
        {
          id: 'issue-2',
          type: 'security',
          severity: 'critical',
          description: 'Second issue',
          file: 'src/test2.ts',
          location: 'line 2',
          reasoning: 'test reasoning 2',
          suggestion: 'test suggestion 2',
          context: 'test context 2',
          confidence: 9,
        },
        {
          id: 'issue-3',
          type: 'performance',
          severity: 'medium',
          description: 'Third issue',
          file: 'src/test3.ts',
          location: 'line 3',
          reasoning: 'test reasoning 3',
          suggestion: 'test suggestion 3',
          context: 'test context 3',
          confidence: 7,
        },
      ];

      const result = await issueManager.writeAllIssues(issues);

      expect(mockMkdir).toHaveBeenCalledWith(issuesDir, { recursive: true });
      expect(mockWriteFile).toHaveBeenCalledTimes(3);
      expect(result.size).toBe(3);
      expect(result.get(issues[0])).toBe(1);
      expect(result.get(issues[1])).toBe(2);
      expect(result.get(issues[2])).toBe(3);
    });

    it('should continue from existing issue ID', async () => {
      mockMkdir.mockResolvedValue(undefined);
      mockWriteFile.mockResolvedValue(undefined);
      mockExistsSync.mockReturnValue(true);
      mockReaddirSync.mockReturnValue(['ISSUE-001-old.md', 'ISSUE-002-old.md'] as any);

      const issues: ReviewIssue[] = [
        {
          id: 'issue-new',
          type: 'maintainability',
          severity: 'low',
          description: 'New issue',
          file: 'src/test.ts',
          location: 'line 1',
          reasoning: 'test reasoning',
          suggestion: 'test suggestion',
          context: 'test context',
          confidence: 6,
        },
      ];

      const result = await issueManager.writeAllIssues(issues);

      expect(result.get(issues[0])).toBe(3); // Continues from ID 3
    });

    it('should handle empty issues array', async () => {
      mockMkdir.mockResolvedValue(undefined);

      const result = await issueManager.writeAllIssues([]);

      expect(mockMkdir).toHaveBeenCalled();
      expect(mockWriteFile).not.toHaveBeenCalled();
      expect(result.size).toBe(0);
    });
  });
});
