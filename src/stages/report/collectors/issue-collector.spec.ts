import type { ReviewIssue, ReviewMetadata } from '../../../shared/types/index.ts';
import { collectIssues, collectReviewIssues } from './issue-collector.ts';

describe('issue-collector', () => {
  describe('collectIssues', () => {
    it('should aggregate issues from review stage', () => {
      const mockReviewIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          line: 1,
          type: 'bug',
          severity: 'critical',
          description: 'Critical bug',
          location: 'line 1',
          reasoning: 'Bad code',
          suggestion: 'Fix it',
          context: 'context',
          confidence: 9,
        },
        {
          id: '2',
          file: 'test.ts',
          line: 2,
          type: 'security',
          severity: 'high',
          description: 'Security issue',
          location: 'line 2',
          reasoning: 'Vulnerable',
          suggestion: 'Secure it',
          context: 'context',
          confidence: 8,
        },
      ];

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 5,
        issues: mockReviewIssues,
        summary: {
          totalIssues: 5,
          critical: 1,
          high: 2,
          medium: 1,
          low: 1,
          byType: {
            bug: 2,
            security: 1,
            performance: 1,
            maintainability: 1,
          },
        },
      };

      const result = collectIssues(mockReview);

      expect(result.total).toBe(5);
      expect(result.byType).toEqual({
        bug: 2,
        security: 1,
        performance: 1,
        maintainability: 1,
      });
      expect(result.bySeverity).toEqual({
        critical: 1,
        high: 2,
        medium: 1,
        low: 1,
      });
      expect(result.topPriorityIssues).toHaveLength(2);
      expect(result.topPriorityIssues[0].severity).toBe('critical');
      expect(result.topPriorityIssues[1].severity).toBe('high');
    });

    it('should handle null review metadata', () => {
      const result = collectIssues(null);

      expect(result.total).toBe(0);
      expect(result.byType).toEqual({
        bug: 0,
        security: 0,
        performance: 0,
        maintainability: 0,
      });
      expect(result.bySeverity).toEqual({
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
      expect(result.topPriorityIssues).toHaveLength(0);
    });

    it('should limit top priority issues to 5', () => {
      const mockIssues: ReviewIssue[] = Array.from({ length: 10 }, (_, i) => ({
        id: `${i}`,
        file: 'test.ts',
        line: i,
        type: 'bug' as const,
        severity: i < 5 ? ('critical' as const) : ('high' as const),
        description: `Issue ${i}`,
        location: `line ${i}`,
        reasoning: 'reasoning',
        suggestion: 'suggestion',
        context: 'context',
        confidence: 9,
      }));

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: mockIssues,
        summary: {
          totalIssues: 10,
          critical: 5,
          high: 5,
          medium: 0,
          low: 0,
          byType: {
            bug: 10,
            security: 0,
            performance: 0,
            maintainability: 0,
          },
        },
      };

      const result = collectIssues(mockReview);

      expect(result.topPriorityIssues).toHaveLength(5);
      expect(
        result.topPriorityIssues.every((issue) => issue.severity === 'critical' || issue.severity === 'high'),
      ).toBe(true);
    });

    it('should filter out medium and low severity from top priority', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          line: 1,
          type: 'bug',
          severity: 'medium',
          description: 'Medium issue',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 7,
        },
        {
          id: '2',
          file: 'test.ts',
          line: 2,
          type: 'bug',
          severity: 'low',
          description: 'Low issue',
          location: 'line 2',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 5,
        },
      ];

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 1,
        issues: mockIssues,
        summary: {
          totalIssues: 2,
          critical: 0,
          high: 0,
          medium: 1,
          low: 1,
          byType: {
            bug: 2,
            security: 0,
            performance: 0,
            maintainability: 0,
          },
        },
      };

      const result = collectIssues(mockReview);

      expect(result.topPriorityIssues).toHaveLength(0);
    });
  });

  describe('collectReviewIssues', () => {
    it('should collect review issues statistics', () => {
      const mockIssues: ReviewIssue[] = [
        {
          id: '1',
          file: 'test.ts',
          line: 1,
          type: 'bug',
          severity: 'critical',
          description: 'Critical bug',
          location: 'line 1',
          reasoning: 'reasoning',
          suggestion: 'suggestion',
          context: 'context',
          confidence: 9,
        },
      ];

      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 5,
        issues: mockIssues,
        summary: {
          totalIssues: 5,
          critical: 1,
          high: 2,
          medium: 1,
          low: 1,
          byType: {
            bug: 2,
            security: 1,
            performance: 1,
            maintainability: 1,
          },
        },
        tokenUsage: {
          input: 1000,
          output: 500,
          total: 1500,
        },
      };

      const result = collectReviewIssues(mockReview);

      expect(result).toEqual({
        filesReviewed: 5,
        totalIssues: 5,
        breakdown: {
          critical: 1,
          high: 2,
          medium: 1,
          low: 1,
        },
        byType: {
          bug: 2,
          security: 1,
          performance: 1,
          maintainability: 1,
        },
        issues: mockIssues,
        tokenUsage: {
          input: 1000,
          output: 500,
          total: 1500,
        },
      });
    });

    it('should return null when review metadata is null', () => {
      const result = collectReviewIssues(null);

      expect(result).toBeNull();
    });

    it('should handle review metadata without tokenUsage', () => {
      const mockReview: ReviewMetadata = {
        timestamp: '2025-01-01T00:00:00Z',
        filesReviewed: 5,
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

      const result = collectReviewIssues(mockReview);

      expect(result).toEqual({
        filesReviewed: 5,
        totalIssues: 0,
        breakdown: {
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
        byType: {
          bug: 0,
          security: 0,
          performance: 0,
          maintainability: 0,
        },
        issues: [],
        tokenUsage: undefined,
      });
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

      const result = collectReviewIssues(mockReview);

      expect(result?.issues).toEqual([]);
      expect(result?.totalIssues).toBe(0);
    });
  });
});
