import type { GitHubAPIClient } from './github-api-client';

interface CheckAnnotation {
  path: string;
  start_line: number;
  end_line: number;
  annotation_level: 'notice' | 'warning' | 'failure';
  message: string;
  title?: string;
}

interface QualOpsIssue {
  file: string;
  line: number;
  severity: string;
  message: string;
  category: string;
}

interface QualOpsSummary {
  totalIssues: number;
  criticalSeverity: number;
  highSeverity: number;
  mediumSeverity: number;
  lowSeverity: number;
  filesAnalyzed: number;
}

export class GitHubChecksService {
  private api: GitHubAPIClient;

  constructor(api: GitHubAPIClient) {
    this.api = api;
  }

  async createCheckRun(
    headSha: string,
    summary: QualOpsSummary,
    issues: QualOpsIssue[],
    maxAnnotations = 50
  ): Promise<void> {
    const conclusion = this.determineConclusion(summary);
    const status = 'completed';

    const annotations = this.convertIssuesToAnnotations(issues, maxAnnotations);
    const summaryText = this.generateCheckSummary(summary, issues.length, annotations.length);

    try {
      await this.api.createCheck({
        name: 'QualOps Code Quality',
        head_sha: headSha,
        status,
        conclusion,
        output: {
          title: this.generateCheckTitle(summary),
          summary: summaryText,
          annotations,
        },
      });

      console.log(`Created GitHub check run with ${annotations.length} annotations`);
    } catch (error) {
      console.error('Failed to create GitHub check run:', error);
      throw error;
    }
  }

  private determineConclusion(
    summary: QualOpsSummary
  ): 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' {
    if (summary.criticalSeverity > 0) {
      return 'failure';
    }
    if (summary.highSeverity > 0) {
      return 'failure';
    }
    if (summary.mediumSeverity > 0) {
      return 'neutral';
    }
    return 'success';
  }

  private generateCheckTitle(summary: QualOpsSummary): string {
    if (summary.totalIssues === 0) {
      return '✅ No issues found';
    }

    const parts: string[] = [];
    if (summary.criticalSeverity > 0) {
      parts.push(`${summary.criticalSeverity} critical`);
    }
    if (summary.highSeverity > 0) {
      parts.push(`${summary.highSeverity} high`);
    }
    if (summary.mediumSeverity > 0) {
      parts.push(`${summary.mediumSeverity} medium`);
    }
    if (summary.lowSeverity > 0) {
      parts.push(`${summary.lowSeverity} low`);
    }

    return `Found ${parts.join(', ')} severity issues`;
  }

  private generateCheckSummary(
    summary: QualOpsSummary,
    totalIssuesCount: number,
    annotationsCount: number
  ): string {
    let text = `## QualOps Code Quality Analysis\n\n`;
    text += `**Files Analyzed:** ${summary.filesAnalyzed}\n`;
    text += `**Total Issues:** ${summary.totalIssues}\n\n`;

    text += `### Issues by Severity\n`;
    text += `- 🔴 **Critical:** ${summary.criticalSeverity}\n`;
    text += `- 🟠 **High:** ${summary.highSeverity}\n`;
    text += `- 🟡 **Medium:** ${summary.mediumSeverity}\n`;
    text += `- 🟢 **Low:** ${summary.lowSeverity}\n\n`;

    if (annotationsCount < totalIssuesCount) {
      text += `**Note:** Showing ${annotationsCount} of ${totalIssuesCount} issues (GitHub API limit: 50 annotations per check)\n\n`;
    }

    if (summary.criticalSeverity > 0 || summary.highSeverity > 0) {
      text += `### ⚠️ Action Required\n`;
      text += `Critical or high severity issues were found. Please review and address them.\n\n`;
    }

    text += `---\n`;
    text += `*Powered by [QualOps](https://github.com/eggai-tech/qualops)*`;

    return text;
  }

  private convertIssuesToAnnotations(issues: QualOpsIssue[], maxAnnotations: number): CheckAnnotation[] {
    const annotations: CheckAnnotation[] = [];

    const prioritizedIssues = this.prioritizeIssues(issues);

    for (const issue of prioritizedIssues.slice(0, maxAnnotations)) {
      const level = this.severityToAnnotationLevel(issue.severity);
      const line = issue.line || 1;

      annotations.push({
        path: issue.file,
        start_line: line,
        end_line: line,
        annotation_level: level,
        title: `${issue.severity.toUpperCase()}: ${issue.category}`,
        message: issue.message,
      });
    }

    return annotations;
  }

  private prioritizeIssues(issues: QualOpsIssue[]): QualOpsIssue[] {
    const severityOrder: Record<string, number> = {
      critical: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    return [...issues].sort((a, b) => {
      const aPriority = severityOrder[a.severity] || 99;
      const bPriority = severityOrder[b.severity] || 99;
      return aPriority - bPriority;
    });
  }

  private severityToAnnotationLevel(severity: string): 'notice' | 'warning' | 'failure' {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'failure';
      case 'high':
        return 'failure';
      case 'medium':
        return 'warning';
      case 'low':
        return 'notice';
      default:
        return 'warning';
    }
  }
}
