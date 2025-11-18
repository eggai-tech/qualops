import { generateDashboardHTML } from './index-dashboard-template.ts';

describe('generateDashboardHTML', () => {
  it('should generate HTML dashboard', () => {
    const summary = {
      metadata: {
        generatedAt: '2025-10-22T10:00:00Z',
        version: '1.0.0',
        description: 'Test dashboard',
        filter: null,
      },
      overall: {
        totalSessions: 5,
        completedSessions: 4,
        completionRate: 0.8,
        issues: {
          total: 10,
          bySeverity: { critical: 2, high: 3, medium: 3, low: 2 },
          byType: { bug: 4, security: 3, performance: 2, maintainability: 1 },
          byEffort: { low: 3, medium: 5, high: 2 },
          byKnowledgeSource: { docs: 5, patterns: 3, bestPractices: 2 },
        },
        generatedAt: '2025-10-22T10:00:00Z',
      },
      batches: {},
      allSessions: [],
    };

    const result = generateDashboardHTML(summary);

    expect(result).toContain('<!DOCTYPE html>');
    expect(result).toContain('QualOps Reports Dashboard');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(1000);
  });

  it('should include all required HTML sections', () => {
    const summary = {
      metadata: {
        generatedAt: '2025-10-22T10:00:00Z',
        version: '1.0.0',
        description: 'Test',
        filter: 'test-filter',
      },
      overall: {
        totalSessions: 1,
        completedSessions: 1,
        completionRate: 1,
        issues: {
          total: 0,
          bySeverity: {},
          byType: {},
          byEffort: {},
          byKnowledgeSource: {},
        },
        generatedAt: '2025-10-22T10:00:00Z',
      },
      batches: {},
      allSessions: [],
    };

    const result = generateDashboardHTML(summary);

    expect(result).toContain('<html');
    expect(result).toContain('<head>');
    expect(result).toContain('<body>');
    expect(result).toContain('<script>');
    expect(result).toContain('</html>');
  });

  it('should embed summary data in JavaScript', () => {
    const summary = {
      metadata: {
        generatedAt: '2025-10-22T10:00:00Z',
        version: '1.0.0',
        description: 'Test',
        filter: null,
      },
      overall: {
        totalSessions: 3,
        completedSessions: 2,
        completionRate: 0.67,
        issues: {
          total: 5,
          bySeverity: { high: 3, medium: 2 },
          byType: { bug: 3, security: 2 },
          byEffort: { medium: 5 },
          byKnowledgeSource: { docs: 5 },
        },
        generatedAt: '2025-10-22T10:00:00Z',
      },
      batches: { batch1: { count: 1 } },
      allSessions: [{ name: 'session1' }],
    };

    const result = generateDashboardHTML(summary);

    expect(result).toContain('const allData =');
    expect(result).toContain('<script>');
    expect(result).toContain('</script>');
  });
});
