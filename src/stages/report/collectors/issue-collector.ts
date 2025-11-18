import type { ReviewIssue, ReviewMetadata } from '../../../shared/types/index.ts';

export interface AggregatedIssues {
  total: number;
  byType: {
    bug: number;
    security: number;
    performance: number;
    maintainability: number;
  };
  bySeverity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  topPriorityIssues: ReviewIssue[];
}

export function collectIssues(review: ReviewMetadata | null): AggregatedIssues {
  const reviewIssues = review?.issues || [];

  const topPriorityIssues = reviewIssues
    .filter((issue) => issue.severity === 'critical' || issue.severity === 'high')
    .slice(0, 5);

  return {
    total: review?.summary.totalIssues || 0,
    byType: {
      bug: review?.summary.byType.bug || 0,
      security: review?.summary.byType.security || 0,
      performance: review?.summary.byType.performance || 0,
      maintainability: review?.summary.byType.maintainability || 0,
    },
    bySeverity: {
      critical: review?.summary.critical || 0,
      high: review?.summary.high || 0,
      medium: review?.summary.medium || 0,
      low: review?.summary.low || 0,
    },
    topPriorityIssues,
  };
}

export function collectReviewIssues(review: ReviewMetadata | null) {
  if (!review) {
    return null;
  }

  return {
    filesReviewed: review.filesReviewed,
    totalIssues: review.summary.totalIssues,
    breakdown: {
      critical: review.summary.critical,
      high: review.summary.high,
      medium: review.summary.medium,
      low: review.summary.low,
    },
    byType: review.summary.byType,
    issues: review.issues,
    tokenUsage: review.tokenUsage,
  };
}
