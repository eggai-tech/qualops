import type { ReviewIssue, ReviewMetadata } from '../../../shared/types';

export interface FixSuggestion {
  issueId: string;
  file: string;
  line: number;
  originalCode: string;
  suggestedCode: string;
  explanation: string;
  confidence: string;
  breaking: boolean;
  applied: boolean;
}

export function aggregateIssues(review: ReviewMetadata) {
  return {
    bySeverity: {
      critical: review.issues.filter((i) => i.severity === 'critical'),
      high: review.issues.filter((i) => i.severity === 'high'),
      medium: review.issues.filter((i) => i.severity === 'medium'),
      low: review.issues.filter((i) => i.severity === 'low'),
    },
    byType: {
      bug: review.issues.filter((i) => i.type === 'bug'),
      security: review.issues.filter((i) => i.type === 'security'),
      performance: review.issues.filter((i) => i.type === 'performance'),
      maintainability: review.issues.filter((i) => i.type === 'maintainability'),
    },
  };
}

export function buildFileTree(issues: ReviewIssue[]): Map<string, { files: string[]; issues: ReviewIssue[] }> {
  const fileTree = new Map<string, { files: string[]; issues: ReviewIssue[] }>();

  for (const issue of issues) {
    const file = issue.file || 'unknown';
    const pathParts = file.split('/');
    const directory = pathParts.slice(0, -1).join('/') || 'root';

    if (!fileTree.has(directory)) {
      fileTree.set(directory, { files: [], issues: [] });
    }

    const dirData = fileTree.get(directory);
    if (dirData) {
      if (!dirData.files.includes(file)) {
        dirData.files.push(file);
      }
      dirData.issues.push(issue);
    }
  }

  return fileTree;
}

export function sortDirectoriesByIssues(
  fileTree: Map<string, { files: string[]; issues: ReviewIssue[] }>,
): Array<[string, { files: string[]; issues: ReviewIssue[] }]> {
  return Array.from(fileTree.entries()).sort((a, b) => {
    const aCritical = a[1].issues.filter((i) => i.severity === 'critical').length;
    const bCritical = b[1].issues.filter((i) => i.severity === 'critical').length;
    const aHigh = a[1].issues.filter((i) => i.severity === 'high').length;
    const bHigh = b[1].issues.filter((i) => i.severity === 'high').length;

    if (aCritical !== bCritical) return bCritical - aCritical;
    if (aHigh !== bHigh) return bHigh - aHigh;
    return b[1].issues.length - a[1].issues.length;
  });
}

export function groupIssuesByFile(issues: ReviewIssue[]): Map<string, ReviewIssue[]> {
  const fileIssues = new Map<string, ReviewIssue[]>();

  for (const issue of issues) {
    const file = issue.file || 'unknown';
    if (!fileIssues.has(file)) {
      fileIssues.set(file, []);
    }
    const issueList = fileIssues.get(file);
    if (issueList) {
      issueList.push(issue);
    }
  }

  return fileIssues;
}

export function calculateIssueCounts(issues: ReviewIssue[]) {
  return {
    critical: issues.filter((i) => i.severity === 'critical').length,
    high: issues.filter((i) => i.severity === 'high').length,
    medium: issues.filter((i) => i.severity === 'medium').length,
    low: issues.filter((i) => i.severity === 'low').length,
  };
}

let idCounter = 0;

export function generateSafeId(id: string): string {
  // Always create a unique ID by appending an incrementing counter
  // This ensures each issue gets a unique ID even if they have the same base ID
  const safeId = `${id.replace(/[^a-zA-Z0-9]/g, '-')}-${idCounter++}`;
  return safeId;
}
