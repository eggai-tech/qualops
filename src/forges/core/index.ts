/**
 * Shared forge-integration contracts and constants.
 *
 * Home for logic common to the GitHub and GitLab integrations, previously
 * duplicated byte-for-byte in each. Behaviour is unchanged — these are the
 * exact shapes/values both integrations already used.
 */

/** Hidden marker embedded in QualOps-authored PR/MR comments for re-identification. */
export const QUALOPS_COMMENT_MARKER = '<!-- qualops-analysis-comment -->';

/** The pipeline result payload both forge integrations read from disk. */
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

/**
 * The loosely-typed issue shape the forge integrations parse from review
 * output (all-string, read from unvalidated JSON). Intentionally distinct from
 * the canonical `ReviewIssue` in `shared/types` — it is a forge-boundary DTO,
 * not the pipeline's finding type.
 */
export interface ForgeReviewIssue {
  file: string;
  location: string;
  severity: string;
  description: string;
  type: string;
}
