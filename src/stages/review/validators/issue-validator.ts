import type { ReviewIssue } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

export class IssueValidator {
  static validateIssue(issue: unknown): issue is ReviewIssue {
    if (!issue || typeof issue !== 'object') {
      return false;
    }

    const required = ['id', 'file', 'type', 'severity', 'description', 'location', 'suggestion', 'confidence'];
    for (const field of required) {
      if (!(field in issue) || !(issue as Record<string, unknown>)[field]) {
        logger.debug(`[VALIDATION] Issue missing required field: ${field}`);
        return false;
      }
    }

    const issueObj = issue as Record<string, unknown>;
    if (typeof issueObj.confidence !== 'number' || issueObj.confidence < 1 || issueObj.confidence > 100) {
      logger.debug(`[VALIDATION] Invalid confidence value: ${issueObj.confidence}`);
      return false;
    }

    if (!issueObj.location) {
      logger.debug(`[VALIDATION] Missing location field`);
      return false;
    }

    return true;
  }

  static enrichIssue(issue: ReviewIssue): ReviewIssue {
    const enriched = { ...issue };

    enriched.priority = this.calculatePriority(issue.severity, issue.type);
    enriched.estimatedEffort = this.estimateEffort(issue.type, issue.severity);
    enriched.tags = this.generateTags(issue);
    enriched.confidence = Math.max(1, Math.min(100, enriched.confidence));

    return enriched;
  }

  private static calculatePriority(severity: string, type: string): number {
    const severityScores = {
      critical: 100,
      high: 75,
      medium: 50,
      low: 25,
    };

    const typeMultipliers = {
      security: 1.2,
      bug: 1.1,
      performance: 1.0,
      maintainability: 0.9,
    };

    const baseScore = severityScores[severity.toLowerCase() as keyof typeof severityScores] || 50;
    const multiplier = typeMultipliers[type.toLowerCase() as keyof typeof typeMultipliers] || 1.0;

    return Math.round(baseScore * multiplier);
  }

  private static estimateEffort(type: string, severity: string): 'low' | 'medium' | 'high' {
    const normalizedSeverity = severity.toLowerCase();
    const normalizedType = type.toLowerCase();

    if (normalizedSeverity === 'critical' || normalizedType === 'security') {
      return 'high';
    }

    if (normalizedSeverity === 'high' || normalizedType === 'bug') {
      return 'medium';
    }

    return 'low';
  }

  private static generateTags(issue: ReviewIssue): string[] {
    const tags: string[] = [];

    tags.push(`severity:${issue.severity}`);

    tags.push(`type:${issue.type}`);

    const extension = issue.file.split('.').pop();
    if (extension) {
      tags.push(`ext:${extension}`);
    }

    if (issue.file.includes('.component.') || issue.context.includes('@Component')) {
      tags.push('angular:component');
    }

    if (issue.file.includes('.service.') || issue.context.includes('@Injectable')) {
      tags.push('angular:service');
    }

    if (issue.context.includes('Observable') || issue.context.includes('pipe')) {
      tags.push('rxjs');
    }

    if (issue.description.toLowerCase().includes('async') || issue.context.includes('await')) {
      tags.push('async');
    }

    if (issue.description.toLowerCase().includes('test') || issue.file.includes('.spec.')) {
      tags.push('testing');
    }

    if (issue.description.toLowerCase().includes('performance') || issue.type === 'performance') {
      tags.push('performance');
    }

    return tags;
  }

  static validateAndEnrichIssues(issues: unknown[]): ReviewIssue[] {
    const validIssues: ReviewIssue[] = [];
    let invalidCount = 0;

    for (const issue of issues) {
      if (this.validateIssue(issue)) {
        const enrichedIssue = this.enrichIssue(issue);
        validIssues.push(enrichedIssue);
      } else {
        invalidCount++;
        logger.warn(`[VALIDATION] Skipping invalid issue: ${JSON.stringify(issue, null, 2)}`);
      }
    }

    if (invalidCount > 0) {
      logger.warn(`[VALIDATION] Filtered out ${invalidCount} invalid issues`);
    }

    return validIssues;
  }

  static sortIssuesByPriority(issues: ReviewIssue[]): ReviewIssue[] {
    return issues.sort((a, b) => {
      // First sort by priority if available
      if (a.priority && b.priority) {
        return b.priority - a.priority;
      }

      // Then by severity
      const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
      const severityDiff =
        (severityOrder[b.severity as keyof typeof severityOrder] || 0) -
        (severityOrder[a.severity as keyof typeof severityOrder] || 0);

      if (severityDiff !== 0) {
        return severityDiff;
      }

      // Finally by confidence
      return (b.confidence || 0) - (a.confidence || 0);
    });
  }
}
