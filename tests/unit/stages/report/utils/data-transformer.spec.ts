import type { ReviewIssue, ReviewMetadata } from '@/shared/types/index.ts';
import {
  aggregateIssues,
  buildFileTree,
  calculateIssueCounts,
  generateSafeId,
  groupIssuesByFile,
  sortDirectoriesByIssues,
} from '@/stages/report/utils/data-transformer.ts';

describe('data-transformer', () => {
  describe('aggregateIssues', () => {
    it('should aggregate issues by severity', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Critical bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'test.ts',
          type: 'bug',
          severity: 'high',
          description: 'High bug',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
        {
          id: '3',
          file: 'test.ts',
          type: 'bug',
          severity: 'medium',
          description: 'Medium bug',
          location: 'line 3',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 7,
        },
      ];

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: mockIssues,
        summary: {
          totalIssues: 3,
          critical: 1,
          high: 1,
          medium: 1,
          low: 0,
          byType: {
            bug: 3,
            security: 0,
            performance: 0,
            maintainability: 0,
          },
        },
      };

      const result = aggregateIssues(mockReview);

      expect(result.bySeverity.critical).toHaveLength(1);
      expect(result.bySeverity.high).toHaveLength(1);
      expect(result.bySeverity.medium).toHaveLength(1);
      expect(result.bySeverity.low).toHaveLength(0);
    });

    it('should aggregate issues by type', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'test.ts',
          type: 'security',
          severity: 'high',
          description: 'Security',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
        {
          id: '3',
          file: 'test.ts',
          type: 'performance',
          severity: 'medium',
          description: 'Performance',
          location: 'line 3',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 7,
        },
        {
          id: '4',
          file: 'test.ts',
          type: 'maintainability',
          severity: 'low',
          description: 'Maintainability',
          location: 'line 4',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 6,
        },
      ];

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: mockIssues,
        summary: {
          totalIssues: 4,
          critical: 1,
          high: 1,
          medium: 1,
          low: 1,
          byType: {
            bug: 1,
            security: 1,
            performance: 1,
            maintainability: 1,
          },
        },
      };

      const result = aggregateIssues(mockReview);

      expect(result.byType.bug).toHaveLength(1);
      expect(result.byType.security).toHaveLength(1);
      expect(result.byType.performance).toHaveLength(1);
      expect(result.byType.maintainability).toHaveLength(1);
    });

    it('should handle empty issues array', () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 0,
        issues: [],
        summary: {
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          byType: {
            bug: 0,
            security: 0,
            performance: 0,
            maintainability: 0,
          },
        },
      };

      const result = aggregateIssues(mockReview);

      expect(result.bySeverity.critical).toHaveLength(0);
      expect(result.byType.bug).toHaveLength(0);
    });
  });

  describe('buildFileTree', () => {
    it('should build file tree from issues', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'src/app/test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'src/app/another.ts',
          type: 'bug',
          severity: 'high',
          description: 'Bug',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
      ];

      const result = buildFileTree(mockIssues);

      expect(result.has('src/app')).toBe(true);
      expect(result.get('src/app')?.files).toContain('src/app/test.ts');
      expect(result.get('src/app')?.files).toContain('src/app/another.ts');
      expect(result.get('src/app')?.issues).toHaveLength(2);
    });

    it('should handle issues without file property', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: '',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
      ];

      const result = buildFileTree(mockIssues);

      expect(result.has('root')).toBe(true);
    });

    it('should handle root level files', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
      ];

      const result = buildFileTree(mockIssues);

      expect(result.has('root')).toBe(true);
      expect(result.get('root')?.files).toContain('test.ts');
    });

    it('should group issues by directory', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'src/app/test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'src/lib/another.ts',
          type: 'bug',
          severity: 'high',
          description: 'Bug',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
      ];

      const result = buildFileTree(mockIssues);

      expect(result.size).toBe(2);
      expect(result.has('src/app')).toBe(true);
      expect(result.has('src/lib')).toBe(true);
    });

    it('should handle duplicate files in same directory', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'src/app/test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug 1',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'src/app/test.ts',
          type: 'bug',
          severity: 'high',
          description: 'Bug 2',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
      ];

      const result = buildFileTree(mockIssues);

      expect(result.get('src/app')?.files).toHaveLength(1);
      expect(result.get('src/app')?.issues).toHaveLength(2);
    });
  });

  describe('sortDirectoriesByIssues', () => {
    it('should sort directories by critical issues first', () => {
      const fileTree = new Map<string, { files: string[]; issues: ReviewIssue[] }>();

      fileTree.set('dir1', {
        files: ['file1.ts'],
        issues: [
          {
            id: '1',
            file: 'file1.ts',
            type: 'bug',
            severity: 'medium',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 7,
          },
        ],
      });

      fileTree.set('dir2', {
        files: ['file2.ts'],
        issues: [
          {
            id: '2',
            file: 'file2.ts',
            type: 'bug',
            severity: 'critical',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 9,
          },
        ],
      });

      const result = sortDirectoriesByIssues(fileTree);

      expect(result[0][0]).toBe('dir2');
      expect(result[1][0]).toBe('dir1');
    });

    it('should sort by high issues when critical is equal', () => {
      const fileTree = new Map<string, { files: string[]; issues: ReviewIssue[] }>();

      fileTree.set('dir1', {
        files: ['file1.ts'],
        issues: [
          {
            id: '1',
            file: 'file1.ts',
            type: 'bug',
            severity: 'high',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 8,
          },
          {
            id: '2',
            file: 'file1.ts',
            type: 'bug',
            severity: 'high',
            description: 'Bug',
            location: 'line 2',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 8,
          },
        ],
      });

      fileTree.set('dir2', {
        files: ['file2.ts'],
        issues: [
          {
            id: '3',
            file: 'file2.ts',
            type: 'bug',
            severity: 'high',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 8,
          },
        ],
      });

      const result = sortDirectoriesByIssues(fileTree);

      expect(result[0][0]).toBe('dir1');
      expect(result[1][0]).toBe('dir2');
    });

    it('should sort by total issues when severity is equal', () => {
      const fileTree = new Map<string, { files: string[]; issues: ReviewIssue[] }>();

      fileTree.set('dir1', {
        files: ['file1.ts'],
        issues: [
          {
            id: '1',
            file: 'file1.ts',
            type: 'bug',
            severity: 'medium',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 7,
          },
          {
            id: '2',
            file: 'file1.ts',
            type: 'bug',
            severity: 'medium',
            description: 'Bug',
            location: 'line 2',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 7,
          },
        ],
      });

      fileTree.set('dir2', {
        files: ['file2.ts'],
        issues: [
          {
            id: '3',
            file: 'file2.ts',
            type: 'bug',
            severity: 'medium',
            description: 'Bug',
            location: 'line 1',
            reasoning: 'reasoning',
            suggestion: 'suggestion',
            context: 'context',
            confidence: 7,
          },
        ],
      });

      const result = sortDirectoriesByIssues(fileTree);

      expect(result[0][0]).toBe('dir1');
      expect(result[1][0]).toBe('dir2');
    });
  });

  describe('groupIssuesByFile', () => {
    it('should group issues by file path', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Bug 1',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'test.ts',
          type: 'bug',
          severity: 'high',
          description: 'Bug 2',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
        {
          id: '3',
          file: 'another.ts',
          type: 'bug',
          severity: 'medium',
          description: 'Bug 3',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 7,
        },
      ];

      const result = groupIssuesByFile(mockIssues);

      expect(result.size).toBe(2);
      expect(result.get('test.ts')).toHaveLength(2);
      expect(result.get('another.ts')).toHaveLength(1);
    });

    it('should handle issues without file property', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: '',
          type: 'bug',
          severity: 'critical',
          description: 'Bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
      ];

      const result = groupIssuesByFile(mockIssues);

      expect(result.has('unknown')).toBe(true);
    });

    it('should handle empty issues array', () => {
      const result = groupIssuesByFile([]);

      expect(result.size).toBe(0);
    });
  });

  describe('calculateIssueCounts', () => {
    it('should calculate issue counts by severity', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Critical',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'test.ts',
          type: 'bug',
          severity: 'critical',
          description: 'Critical',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
        {
          id: '3',
          file: 'test.ts',
          type: 'bug',
          severity: 'high',
          description: 'High',
          location: 'line 3',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 8,
        },
        {
          id: '4',
          file: 'test.ts',
          type: 'bug',
          severity: 'medium',
          description: 'Medium',
          location: 'line 4',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 7,
        },
        {
          id: '5',
          file: 'test.ts',
          type: 'bug',
          severity: 'low',
          description: 'Low',
          location: 'line 5',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 6,
        },
      ];

      const result = calculateIssueCounts(mockIssues);

      expect(result).toEqual({
        critical: 2,
        high: 1,
        medium: 1,
        low: 1,
      });
    });

    it('should handle empty issues array', () => {
      const result = calculateIssueCounts([]);

      expect(result).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
    });
  });

  describe('generateSafeId', () => {
    it('should replace non-alphanumeric characters with dashes', () => {
      const result = generateSafeId('test@issue#1');

      expect(result).toMatch(/^test-issue-1-\d+$/);
    });

    it('should append unique counter', () => {
      const id1 = generateSafeId('test');
      const id2 = generateSafeId('test');

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^test-\d+$/);
      expect(id2).toMatch(/^test-\d+$/);
    });

    it('should handle empty string', () => {
      const result = generateSafeId('');

      expect(result).toMatch(/^-\d+$/);
    });

    it('should handle special characters', () => {
      const result = generateSafeId('test!@#$%^&*()');

      expect(result).toMatch(/^test-+\d+$/);
    });

    it('should preserve alphanumeric characters', () => {
      const result = generateSafeId('testIssue123');

      expect(result).toMatch(/^testIssue123-\d+$/);
    });

    it('should create unique IDs in sequence', () => {
      const ids = [generateSafeId('id'), generateSafeId('id'), generateSafeId('id')];

      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });
  });
});
