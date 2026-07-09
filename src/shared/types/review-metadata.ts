import type { ReviewIssue } from './finding';

export interface ReviewMetadata {
  timestamp: string;
  filesReviewed: number;
  projectsReviewed?: number;
  passed?: number;
  failed?: number;
  issues: ReviewIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byType: {
      bug: number;
      security: number;
      performance: number;
      maintainability: number;
    };
  };
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

export interface FilterMetadata {
  timestamp: string;
  originalIssues: number;
  filteredIssues: number;
  keptIssues: ReviewIssue[];
  excludedIssues: Array<{
    issue: ReviewIssue;
    reason: string;
  }>;
  filterStats: {
    byConfidence: Record<number, number>;
    byExclusionType: Record<string, number>;
    falsePositiveRate: number;
  };
}
