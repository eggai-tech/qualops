export const QUALOPS_COMMENT_MARKER = '<!-- qualops-analysis-comment -->';

export interface QualOpsResult {
  summary: {
    totalIssues: number;
    criticalSeverity: number;
    highSeverity: number;
    mediumSeverity: number;
    lowSeverity: number;
    filesAnalyzed: number;
  };
  reportPath: string;
  issues: Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
    category: string;
  }>;
}

export interface IntegrationReviewIssue {
  file: string;
  location: string;
  severity: string;
  description: string;
  type: string;
}
