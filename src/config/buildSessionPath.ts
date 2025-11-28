import { join, resolve } from 'node:path';

import { FILE_NAMES } from './config';
import { sanitizeFilename } from '../shared/utils/security';

export function buildSessionPath(sessionName: string, reportRoot: string) {
  // Sanitize sessionName to prevent path traversal
  const sanitizedSession = sanitizeFilename(sessionName);

  // Validate reportRoot stays within expected directory
  const resolvedRoot = resolve(reportRoot);
  const expectedBase = resolve('.qualops/reports');
  if (!resolvedRoot.startsWith(expectedBase)) {
    throw new Error(`Invalid report root path: ${reportRoot}`);
  }

  const rootDir = reportRoot;
  const sessionBase = join(rootDir, 'sessions', sanitizedSession);
  const issuesBase = join(rootDir, 'issues');

  return {
    base: () => sessionBase,
    reportRoot: () => rootDir,
    issuesDir: () => issuesBase,
    issues: () => issuesBase,
    analysis: () => join(sessionBase, FILE_NAMES.ANALYSIS),
    reviewSummary: () => join(sessionBase, FILE_NAMES.REVIEW_SUMMARY),
    rootCauseMetadata: () => join(sessionBase, 'root-cause-metadata.json'),
    fixSummary: () => join(sessionBase, FILE_NAMES.FIX_SUMMARY),
    overallReport: () => join(sessionBase, FILE_NAMES.OVERALL_REPORT),
    judgeDecision: () => join(sessionBase, 'judge-decision.json'),
    cache: () => join(sessionBase, 'qualops-cache.json'),
    extractLog: () => join(sessionBase, 'extract-log.json'),
    diffReport: () => join(sessionBase, 'diff-report.html'),
    tokenStats: () => join(sessionBase, 'token-stats.json'),
    metadata: () => join(sessionBase, 'metadata.json'),
    sessionReport: () => join(sessionBase, 'report.html'),
    mainReport: () => join(rootDir, 'index.html'),
    errorLog: (stage: string) => join(sessionBase, `error-${stage}.json`),
    timingStats: () => join(sessionBase, 'timing-stats.json'),
  };
}
