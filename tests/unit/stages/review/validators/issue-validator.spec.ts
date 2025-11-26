import type { ReviewIssue } from '@/shared/types';
import { logger } from '@/shared/utils/logger';
import { IssueValidator } from '@/stages/review/validators/issue-validator';

jest.mock('@/shared/utils/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

describe('IssueValidator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  const createValidIssue = (overrides: Partial<ReviewIssue> = {}): ReviewIssue => ({
    id: 'issue-1',
    file: '/test/file.ts',
    type: 'bug',
    severity: 'medium',
    description: 'Test description',
    location: 'line 10',
    reasoning: 'Test reasoning',
    suggestion: 'Test suggestion',
    context: 'Test context',
    confidence: 75,
    ...overrides,
  });

  describe('validateIssue', () => {
    it('should validate complete issue', () => {
      const issue = createValidIssue();

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(true);
    });

    it('should reject issue missing id', () => {
      const issue = createValidIssue();
      delete (issue as any).id;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith('[VALIDATION] Issue missing required field: id');
    });

    it('should reject issue missing file', () => {
      const issue = createValidIssue();
      delete (issue as any).file;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith('[VALIDATION] Issue missing required field: file');
    });

    it('should reject issue missing type', () => {
      const issue = createValidIssue();
      delete (issue as any).type;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith('[VALIDATION] Issue missing required field: type');
    });

    it('should reject issue missing severity', () => {
      const issue = createValidIssue();
      delete (issue as any).severity;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: severity',
      );
    });

    it('should reject issue missing description', () => {
      const issue = createValidIssue();
      delete (issue as any).description;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: description',
      );
    });

    it('should reject issue missing location', () => {
      const issue = createValidIssue();
      delete (issue as any).location;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: location',
      );
    });

    it('should reject issue missing suggestion', () => {
      const issue = createValidIssue();
      delete (issue as any).suggestion;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: suggestion',
      );
    });

    it('should reject issue missing confidence', () => {
      const issue = createValidIssue();
      delete (issue as any).confidence;

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: confidence',
      );
    });

    it('should reject issue with confidence below 1', () => {
      const issue = createValidIssue({ confidence: 0 });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
    });

    it('should reject issue with confidence above 100', () => {
      const issue = createValidIssue({ confidence: 101 });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith('[VALIDATION] Invalid confidence value: 101');
    });

    it('should reject issue with non-numeric confidence', () => {
      const issue = createValidIssue({ confidence: 'high' as any });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
    });

    it('should accept issue with confidence at boundary values', () => {
      const issue1 = createValidIssue({ confidence: 1 });
      const issue100 = createValidIssue({ confidence: 100 });

      expect(IssueValidator.validateIssue(issue1)).toBe(true);
      expect(IssueValidator.validateIssue(issue100)).toBe(true);
    });

    it('should accept issue with optional fields', () => {
      const issue = createValidIssue({
        tags: ['test'],
        priority: 75,
        estimatedEffort: 'medium',
        knowledge_source: 'test source',
      });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(true);
    });

    it('should reject issue with empty string fields', () => {
      const issue = createValidIssue({ description: '' });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
    });

    it('should reject issue with null location', () => {
      const issue = createValidIssue({ location: null as any });

      const result = IssueValidator.validateIssue(issue);

      expect(result).toBe(false);
      expect(logger.debug).toHaveBeenCalledWith(
        '[VALIDATION] Issue missing required field: location',
      );
    });
  });

  describe('enrichIssue', () => {
    it('should add priority to issue', () => {
      const issue = createValidIssue();

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.priority).toBeDefined();
      expect(typeof enriched.priority).toBe('number');
    });

    it('should add estimated effort to issue', () => {
      const issue = createValidIssue();

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.estimatedEffort).toBeDefined();
      expect(['low', 'medium', 'high']).toContain(enriched.estimatedEffort);
    });

    it('should add tags to issue', () => {
      const issue = createValidIssue();

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toBeDefined();
      expect(Array.isArray(enriched.tags)).toBe(true);
    });

    it('should not mutate original issue', () => {
      const issue = createValidIssue();
      const originalPriority = issue.priority;

      IssueValidator.enrichIssue(issue);

      expect(issue.priority).toBe(originalPriority);
    });

    it('should calculate higher priority for critical severity', () => {
      const mediumIssue = createValidIssue({ severity: 'medium' });
      const criticalIssue = createValidIssue({ severity: 'critical' });

      const enrichedMedium = IssueValidator.enrichIssue(mediumIssue);
      const enrichedCritical = IssueValidator.enrichIssue(criticalIssue);

      expect(enrichedCritical.priority!).toBeGreaterThan(enrichedMedium.priority!);
    });

    it('should calculate higher priority for security type', () => {
      const bugIssue = createValidIssue({ type: 'bug', severity: 'high' });
      const securityIssue = createValidIssue({ type: 'security', severity: 'high' });

      const enrichedBug = IssueValidator.enrichIssue(bugIssue);
      const enrichedSecurity = IssueValidator.enrichIssue(securityIssue);

      expect(enrichedSecurity.priority!).toBeGreaterThan(enrichedBug.priority!);
    });

    it('should set high effort for critical issues', () => {
      const issue = createValidIssue({ severity: 'critical' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.estimatedEffort).toBe('high');
    });

    it('should set high effort for security issues', () => {
      const issue = createValidIssue({ type: 'security', severity: 'low' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.estimatedEffort).toBe('high');
    });

    it('should set medium effort for high severity bugs', () => {
      const issue = createValidIssue({ type: 'bug', severity: 'high' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.estimatedEffort).toBe('medium');
    });

    it('should set low effort for low severity issues', () => {
      const issue = createValidIssue({ type: 'maintainability', severity: 'low' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.estimatedEffort).toBe('low');
    });

    it('should generate severity and type tags', () => {
      const issue = createValidIssue({ type: 'bug', severity: 'high' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('severity:high');
      expect(enriched.tags).toContain('type:bug');
    });

    it('should generate file extension tag', () => {
      const issue = createValidIssue({ file: '/test/file.ts' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('ext:ts');
    });

    it('should generate Angular component tag', () => {
      const issue = createValidIssue({
        file: '/test/app.component.ts',
        context: '@Component({ selector: "app-root" })',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('angular:component');
    });

    it('should generate Angular service tag', () => {
      const issue = createValidIssue({
        file: '/test/data.service.ts',
        context: '@Injectable({ providedIn: "root" })',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('angular:service');
    });

    it('should generate RxJS tag', () => {
      const issue = createValidIssue({
        context: 'Observable.pipe(map(x => x + 1))',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('rxjs');
    });

    it('should generate async tag', () => {
      const issue = createValidIssue({
        description: 'Async operation issue',
        context: 'await fetchData()',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('async');
    });

    it('should generate testing tag', () => {
      const issue = createValidIssue({
        file: '/test/file.spec.ts',
        description: 'Test coverage issue',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('testing');
    });

    it('should generate performance tag', () => {
      const issue = createValidIssue({
        type: 'performance',
        description: 'Performance bottleneck detected',
      });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toContain('performance');
    });

    it('should clamp confidence to valid range', () => {
      const issue = createValidIssue({ confidence: 150 });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.confidence).toBe(100);
    });

    it('should handle issue without file extension', () => {
      const issue = createValidIssue({ file: '/test/Makefile' });

      const enriched = IssueValidator.enrichIssue(issue);

      expect(enriched.tags).toBeDefined();
    });
  });

  describe('validateAndEnrichIssues', () => {
    it('should validate and enrich all valid issues', () => {
      const issues = [createValidIssue({ id: 'issue-1' }), createValidIssue({ id: 'issue-2' })];

      const result = IssueValidator.validateAndEnrichIssues(issues);

      expect(result).toHaveLength(2);
      expect(result[0].priority).toBeDefined();
      expect(result[1].priority).toBeDefined();
    });

    it('should filter out invalid issues', () => {
      const validIssue = createValidIssue();
      const invalidIssue = { id: 'invalid', description: 'Missing fields' };

      const result = IssueValidator.validateAndEnrichIssues([validIssue, invalidIssue]);

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('issue-1');
    });

    it('should log warning for invalid issues', () => {
      const invalidIssue = { id: 'invalid' };

      IssueValidator.validateAndEnrichIssues([invalidIssue]);

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[VALIDATION] Skipping invalid issue'),
      );
    });

    it('should report count of filtered issues', () => {
      const validIssue = createValidIssue();
      const invalidIssues = [{ id: 'invalid1' }, { id: 'invalid2' }];

      IssueValidator.validateAndEnrichIssues([validIssue, ...invalidIssues]);

      expect(logger.warn).toHaveBeenCalledWith('[VALIDATION] Filtered out 2 invalid issues');
    });

    it('should handle empty array', () => {
      const result = IssueValidator.validateAndEnrichIssues([]);

      expect(result).toHaveLength(0);
    });

    it('should handle all invalid issues', () => {
      const invalidIssues = [{ id: 'invalid1' }, { id: 'invalid2' }];

      const result = IssueValidator.validateAndEnrichIssues(invalidIssues);

      expect(result).toHaveLength(0);
    });
  });

  describe('sortIssuesByPriority', () => {
    it('should sort by priority when available', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', priority: 50 }),
        createValidIssue({ id: 'issue-2', priority: 90 }),
        createValidIssue({ id: 'issue-3', priority: 70 }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result[0].priority).toBe(90);
      expect(result[1].priority).toBe(70);
      expect(result[2].priority).toBe(50);
    });

    it('should sort by severity when priority not available', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', severity: 'low' }),
        createValidIssue({ id: 'issue-2', severity: 'critical' }),
        createValidIssue({ id: 'issue-3', severity: 'high' }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('high');
      expect(result[2].severity).toBe('low');
    });

    it('should sort by confidence when severity is equal', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', severity: 'high', confidence: 70 }),
        createValidIssue({ id: 'issue-2', severity: 'high', confidence: 90 }),
        createValidIssue({ id: 'issue-3', severity: 'high', confidence: 80 }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result[0].confidence).toBe(90);
      expect(result[1].confidence).toBe(80);
      expect(result[2].confidence).toBe(70);
    });

    it('should sort array in place and return same reference', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', severity: 'low' }),
        createValidIssue({ id: 'issue-2', severity: 'high' }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result).toBe(issues);
      expect(result[0].severity).toBe('high');
      expect(result[1].severity).toBe('low');
    });

    it('should handle empty array', () => {
      const result = IssueValidator.sortIssuesByPriority([]);

      expect(result).toHaveLength(0);
    });

    it('should handle single issue', () => {
      const issues = [createValidIssue()];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result).toHaveLength(1);
    });

    it('should handle mixed priority and no-priority issues', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', severity: 'low' }),
        createValidIssue({ id: 'issue-2', priority: 90, severity: 'medium' }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result[0].priority).toBe(90);
    });

    it('should handle all severity levels correctly', () => {
      const issues = [
        createValidIssue({ id: 'issue-1', severity: 'medium' }),
        createValidIssue({ id: 'issue-2', severity: 'critical' }),
        createValidIssue({ id: 'issue-3', severity: 'low' }),
        createValidIssue({ id: 'issue-4', severity: 'high' }),
      ];

      const result = IssueValidator.sortIssuesByPriority(issues);

      expect(result[0].severity).toBe('critical');
      expect(result[1].severity).toBe('high');
      expect(result[2].severity).toBe('medium');
      expect(result[3].severity).toBe('low');
    });
  });
});
