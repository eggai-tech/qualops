import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { GitHubAPIClient } from './github-api-client';
import { GitHubChecksService } from './github-checks';

const QUALOPS_COMMENT_MARKER = '<!-- qualops-analysis-comment -->';

interface GitHubConfig {
  enabled?: boolean;
  postComments?: boolean;
  skipOnDraft?: boolean;
  blockPipeline?: boolean;
  maxInlineComments?: number;
}

interface QualOpsConfig {
  github?: GitHubConfig;
}

interface GitHubEnv {
  GITHUB_TOKEN?: string;
  GITHUB_REPOSITORY?: string;
  GITHUB_EVENT_PATH?: string;
  GITHUB_EVENT_NAME?: string;
  GITHUB_SHA?: string;
  GITHUB_HEAD_REF?: string;
  GITHUB_BASE_REF?: string;
  GITHUB_RUN_ID?: string;
  GITHUB_SERVER_URL?: string;
}

interface QualOpsResult {
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

interface ReviewIssue {
  file: string;
  location: string;
  severity: string;
  description: string;
  type: string;
}

interface PullRequestEvent {
  pull_request: {
    number: number;
    draft: boolean;
    head: {
      sha: string;
    };
  };
}

export class GitHubIntegration {
  private env: GitHubEnv;
  private api: GitHubAPIClient;
  private checksService: GitHubChecksService;
  private config: GitHubConfig;

  constructor() {
    this.env = process.env as GitHubEnv;
    this.api = new GitHubAPIClient();
    this.checksService = new GitHubChecksService(this.api);
    this.config = this.loadConfig();
  }

  private loadConfig(): GitHubConfig {
    try {
      const configPath = join(process.cwd(), '.qualopsrc.json');
      if (!existsSync(configPath)) return {};

      const config: QualOpsConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      return config.github || {};
    } catch {
      return {};
    }
  }

  private getPullRequestNumber(): number | null {
    const event = this.loadEvent();
    return event?.pull_request?.number || null;
  }

  private getPullRequestHeadSha(): string | null {
    const event = this.loadEvent();
    return event?.pull_request?.head?.sha || null;
  }

  private loadEvent(): PullRequestEvent | null {
    try {
      const eventPath = this.env.GITHUB_EVENT_PATH;
      if (!eventPath || !existsSync(eventPath)) {
        return null;
      }
      return JSON.parse(readFileSync(eventPath, 'utf8'));
    } catch (error) {
      console.warn('Failed to parse GitHub event:', error);
      return null;
    }
  }

  async getExistingQualOpsComment(prNumber: number): Promise<number | null> {
    try {
      const comments = await this.api.listComments(prNumber);
      const qualopsComment = comments.find((comment) => comment.body?.includes(QUALOPS_COMMENT_MARKER));

      return qualopsComment?.id || null;
    } catch (error) {
      console.warn('Failed to fetch existing comments:', error);
      return null;
    }
  }

  async postPullRequestComment(prNumber: number, comment: string): Promise<void> {
    const existingCommentId = await this.getExistingQualOpsComment(prNumber);
    const body = `${QUALOPS_COMMENT_MARKER}\n${comment}`;

    if (existingCommentId) {
      await this.api.updateComment(existingCommentId, body);
    } else {
      await this.api.createComment(prNumber, body);
    }
  }

  generateCommentFromResults(results: QualOpsResult, artifactUrl: string | null): string {
    const { summary, issues } = results;
    const statusText = this.getStatusText(summary);

    let comment = `## QualOps Code Quality Analysis\n\n`;
    comment += `**Status: ${statusText}**\n\n`;

    comment += `### Summary\n`;
    comment += `- **Total Issues:** ${summary.totalIssues}\n`;
    comment += `- **Critical:** ${summary.criticalSeverity} 🔴\n`;
    comment += `- **High:** ${summary.highSeverity} 🟠\n`;
    comment += `- **Medium:** ${summary.mediumSeverity} 🟡\n`;
    comment += `- **Low:** ${summary.lowSeverity} 🟢\n`;
    comment += `- **Files Analyzed:** ${summary.filesAnalyzed}\n\n`;

    if (summary.totalIssues === 0) {
      comment += `No issues found in the analyzed code.\n\n`;
    } else {
      comment += this.formatIssuesByType(issues, 'critical', '🔴', 10);
      comment += this.formatIssuesByType(issues, 'high', '🟠', 5);
      comment += this.formatIssuesByType(issues, 'medium', '🟡', 3);
    }

    if (artifactUrl) {
      comment += `\n### 📊 Full Report\n`;
      comment += `[View detailed report](${artifactUrl})\n\n`;
    }

    comment += `\n---\n`;
    comment += `*Powered by [QualOps](https://github.com/eggai-tech/qualops)*\n`;

    return comment;
  }

  private getStatusText(summary: QualOpsResult['summary']): string {
    if (summary.criticalSeverity > 0 || summary.highSeverity > 0) {
      return '⚠️ **FAILED** - Critical or high severity issues found';
    } else if (summary.mediumSeverity > 0) {
      return '⚠️ **WARNINGS** - Medium severity issues found';
    } else if (summary.lowSeverity > 0) {
      return '✅ **PASSED** - Only low severity issues found';
    }
    return '✅ **PASSED** - No issues found';
  }

  private formatIssuesByType(issues: QualOpsResult['issues'], severity: string, emoji: string, maxItems: number): string {
    const filtered = issues.filter((issue) => issue.severity === severity);
    if (filtered.length === 0) return '';

    let section = `\n### ${emoji} ${severity.charAt(0).toUpperCase() + severity.slice(1)} Issues (${filtered.length})\n\n`;

    const displayed = filtered.slice(0, maxItems);
    for (const issue of displayed) {
      section += `- **${issue.file}:${issue.line}** - ${issue.category}\n`;
      section += `  ${issue.message}\n\n`;
    }

    if (filtered.length > maxItems) {
      section += `_...and ${filtered.length - maxItems} more ${severity} issues_\n`;
    }

    return section;
  }

  private parseReports(): QualOpsResult {
    const reportsDir = join(process.cwd(), 'reports', 'sessions');

    if (!existsSync(reportsDir)) {
      console.warn('Reports directory not found');
      return this.getEmptyResult();
    }

    const sessionDirs = readdirSync(reportsDir).filter((name) => {
      const fullPath = join(reportsDir, name);
      return existsSync(fullPath) && readdirSync(fullPath).length > 0;
    });

    if (sessionDirs.length === 0) {
      console.warn('No session directories found');
      return this.getEmptyResult();
    }

    const latestSession = sessionDirs[sessionDirs.length - 1];
    const sessionPath = join(reportsDir, latestSession);
    const reviewSummaryPath = join(sessionPath, 'review-summary.json');

    if (!existsSync(reviewSummaryPath)) {
      console.warn('review-summary.json not found');
      return this.getEmptyResult();
    }

    try {
      const reviewSummary = JSON.parse(readFileSync(reviewSummaryPath, 'utf8'));
      const summary = reviewSummary.summary || {};
      const issues: ReviewIssue[] = reviewSummary.issues || [];

      return {
        summary: {
          totalIssues: summary.totalIssues || 0,
          criticalSeverity: summary.critical || 0,
          highSeverity: summary.high || 0,
          mediumSeverity: summary.medium || 0,
          lowSeverity: summary.low || 0,
          filesAnalyzed: reviewSummary.filesReviewed || 0,
        },
        reportPath: sessionPath,
        issues: issues.map((issue) => ({
          file: issue.file,
          line: parseInt(issue.location) || 1,
          severity: issue.severity,
          message: issue.description,
          category: issue.type,
        })),
      };
    } catch (error) {
      console.error('Failed to parse reports:', error);
      return this.getEmptyResult();
    }
  }

  private getEmptyResult(): QualOpsResult {
    return {
      summary: {
        totalIssues: 0,
        criticalSeverity: 0,
        highSeverity: 0,
        mediumSeverity: 0,
        lowSeverity: 0,
        filesAnalyzed: 0,
      },
      reportPath: '',
      issues: [],
    };
  }

  private getArtifactUrl(): string | null {
    const runId = this.env.GITHUB_RUN_ID;
    const serverUrl = this.env.GITHUB_SERVER_URL || 'https://github.com';
    const repository = this.env.GITHUB_REPOSITORY;

    if (runId && repository) {
      return `${serverUrl}/${repository}/actions/runs/${runId}`;
    }

    return null;
  }

  async run(): Promise<void> {
    if (this.env.GITHUB_EVENT_NAME !== 'pull_request') {
      return;
    }

    const prNumber = this.getPullRequestNumber();
    if (!prNumber) {
      return;
    }

    if (this.config.skipOnDraft) {
      const pr = await this.api.getPullRequest(prNumber);
      if (pr.draft) {
        console.log('Skipping draft PR');
        return;
      }
    }

    const results = this.parseReports();

    if (this.config.postComments !== false) {
      const artifactUrl = this.getArtifactUrl();
      const comment = this.generateCommentFromResults(results, artifactUrl);
      await this.postPullRequestComment(prNumber, comment);
    }

    const headSha = this.getPullRequestHeadSha() || this.env.GITHUB_SHA;
    if (headSha) {
      const maxAnnotations = this.config.maxInlineComments || 50;
      await this.checksService.createCheckRun(headSha, results.summary, results.issues, maxAnnotations);
    }

    if (this.config.blockPipeline) {
      const { criticalSeverity, highSeverity } = results.summary;
      if (criticalSeverity > 0 || highSeverity > 0) {
        process.exit(1);
      }
    }

    console.log('GitHub integration completed successfully');
  }
}
