import type { ReviewIssue } from '@/shared/types';
import { escapeHtml, extractProblem, formatSource, getConfidenceBadge, getQualityStatus } from '@/stages/report/utils/formatters';

describe('formatters', () => {
  describe('getConfidenceBadge', () => {
    it('should return empty string for undefined confidence', () => {
      const result = getConfidenceBadge(undefined);

      expect(result).toBe('');
    });

    it('should return high confidence badge for confidence >= 8', () => {
      const result = getConfidenceBadge(8);

      expect(result).toContain('confidence-high');
      expect(result).toContain('8/10');
    });

    it('should return high confidence badge for confidence 10', () => {
      const result = getConfidenceBadge(10);

      expect(result).toContain('confidence-high');
      expect(result).toContain('10/10');
    });

    it('should return medium confidence badge for confidence 6-7', () => {
      const result = getConfidenceBadge(6);

      expect(result).toContain('confidence-medium');
      expect(result).toContain('6/10');
    });

    it('should return medium confidence badge for confidence 7', () => {
      const result = getConfidenceBadge(7);

      expect(result).toContain('confidence-medium');
      expect(result).toContain('7/10');
    });

    it('should return low confidence badge for confidence < 6', () => {
      const result = getConfidenceBadge(5);

      expect(result).toContain('confidence-low');
      expect(result).toContain('5/10');
    });

    it('should return low confidence badge for confidence 0', () => {
      const result = getConfidenceBadge(0);

      expect(result).toContain('confidence-low');
      expect(result).toContain('0/10');
    });

    it('should include confidence value in title attribute', () => {
      const result = getConfidenceBadge(8);

      expect(result).toContain('title="Confidence: 8/10"');
    });
  });

  describe('getQualityStatus', () => {
    it('should return FAILED for critical issues', () => {
      const summary = {
        critical: 1,
        high: 0,
        medium: 0,
        low: 0,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('FAILED');
      expect(result.color).toBe('#dc3545');
      expect(result.emoji).toBe('FAILED');
    });

    it('should return FAILED for high issues', () => {
      const summary = {
        critical: 0,
        high: 1,
        medium: 0,
        low: 0,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('FAILED');
      expect(result.color).toBe('#dc3545');
      expect(result.emoji).toBe('FAILED');
    });

    it('should return FAILED for both critical and high issues', () => {
      const summary = {
        critical: 2,
        high: 3,
        medium: 0,
        low: 0,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('FAILED');
    });

    it('should return WARNING for medium issues only', () => {
      const summary = {
        critical: 0,
        high: 0,
        medium: 1,
        low: 0,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('WARNING');
      expect(result.color).toBe('#ffc107');
      expect(result.emoji).toBe('WARNING');
    });

    it('should return WARNING for medium and low issues', () => {
      const summary = {
        critical: 0,
        high: 0,
        medium: 1,
        low: 2,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('WARNING');
    });

    it('should return PASSED for no issues', () => {
      const summary = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('PASSED');
      expect(result.color).toBe('#28a745');
      expect(result.emoji).toBe('PASSED');
    });

    it('should return PASSED for only low issues', () => {
      const summary = {
        critical: 0,
        high: 0,
        medium: 0,
        low: 5,
      };

      const result = getQualityStatus(summary);

      expect(result.status).toBe('PASSED');
    });
  });

  describe('extractProblem', () => {
    it('should extract problem from reasoning with "but"', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Description',
        location: 'line 1',
        reasoning: 'The code works but it has a memory leak.',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('The code works but it has a memory leak');
    });

    it('should extract problem from reasoning with "however"', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Description',
        location: 'line 1',
        reasoning: 'The implementation seems correct however it will fail under load.',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('The implementation seems correct however it will fail under load');
    });

    it('should extract problem from reasoning with "is not"', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Description',
        location: 'line 1',
        reasoning: 'The function is not properly handling null values.',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('The function is not properly handling null values');
    });

    it('should handle missing description', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Missing validation',
        location: 'line 1',
        reasoning: '',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('Required validation is not present');
    });

    it('should handle incorrect description', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Incorrect implementation',
        location: 'line 1',
        reasoning: '',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('The implementation is incorrect and may cause unexpected behavior');
    });

    it('should return first sentence of reasoning as fallback', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Description',
        location: 'line 1',
        reasoning: 'This is the problem. This is additional context.',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('This is the problem');
    });

    it('should return description when reasoning is empty', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Test description',
        location: 'line 1',
        reasoning: '',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('Test description');
    });

    it('should handle problem indicator pattern', () => {
      const issue: ReviewIssue = {
        id: '1',
        file: 'test.ts',
        type: 'bug',
        severity: 'critical',
        description: 'Description',
        location: 'line 1',
        reasoning: 'The problem is that the code leaks memory.',
        suggestion: 'Fix it',
        context: 'context',
        confidence: 9,
      };

      const result = extractProblem(issue);

      expect(result).toBe('The problem is that the code leaks memory');
    });
  });

  describe('formatSource', () => {
    it('should format angular source references', () => {
      const result = formatSource('angular/core/Component');

      expect(result).toContain('https://angular.dev/api/core');
      expect(result).toContain('Angular core - Component');
    });

    it('should format angular source without section', () => {
      const result = formatSource('angular/common');

      expect(result).toContain('https://angular.dev/api/common');
      expect(result).toContain('Angular common - Documentation');
    });

    it('should format guide references', () => {
      const result = formatSource('guide/components');

      expect(result).toContain('https://angular.dev/guide/components');
      expect(result).toContain('Guide: components');
    });

    it('should format markdown file references', () => {
      const result = formatSource('docs/coding-standards.md');

      expect(result).toBe('coding standards');
    });

    it('should replace dashes and underscores in markdown filenames', () => {
      const result = formatSource('docs/style_guide-best-practices.md');

      expect(result).toBe('style guide best practices');
    });

    it('should return source as-is for unknown formats', () => {
      const result = formatSource('unknown-source');

      expect(result).toBe('unknown-source');
    });

    it('should handle empty source', () => {
      const result = formatSource('');

      expect(result).toBe('');
    });

    it('should include target blank in links', () => {
      const result = formatSource('angular/core/Component');

      expect(result).toContain('target="_blank"');
    });

    it('should include accent color in links', () => {
      const result = formatSource('angular/core/Component');

      expect(result).toContain('color: var(--color-accent)');
    });
  });

  describe('escapeHtml', () => {
    it('should escape ampersand', () => {
      const result = escapeHtml('foo & bar');

      expect(result).toBe('foo &amp; bar');
    });

    it('should escape less than', () => {
      const result = escapeHtml('foo < bar');

      expect(result).toBe('foo &lt; bar');
    });

    it('should escape greater than', () => {
      const result = escapeHtml('foo > bar');

      expect(result).toBe('foo &gt; bar');
    });

    it('should escape double quotes', () => {
      const result = escapeHtml('foo "bar" baz');

      expect(result).toBe('foo &quot;bar&quot; baz');
    });

    it('should escape single quotes', () => {
      const result = escapeHtml("foo 'bar' baz");

      expect(result).toBe('foo &#39;bar&#39; baz');
    });

    it('should escape all special characters', () => {
      const result = escapeHtml(`<div class="test" id='foo'>A & B</div>`);

      expect(result).toBe('&lt;div class=&quot;test&quot; id=&#39;foo&#39;&gt;A &amp; B&lt;/div&gt;');
    });

    it('should handle empty string', () => {
      const result = escapeHtml('');

      expect(result).toBe('');
    });

    it('should handle string without special characters', () => {
      const result = escapeHtml('normal text');

      expect(result).toBe('normal text');
    });

    it('should escape multiple consecutive special characters', () => {
      const result = escapeHtml('<<>>&&""');

      expect(result).toBe('&lt;&lt;&gt;&gt;&amp;&amp;&quot;&quot;');
    });

    it('should preserve non-HTML characters', () => {
      const result = escapeHtml('hello@world.com');

      expect(result).toBe('hello@world.com');
    });
  });
});
