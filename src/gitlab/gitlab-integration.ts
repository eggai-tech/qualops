#!/usr/bin/env node --experimental-strip-types

import { existsSync, readdirSync, readFileSync } from 'fs';
import { join } from 'path';

import { hasValidUrlScheme, isValidGitSha } from '../shared/utils/security';

const SEVERITY_EMOJI = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
} as const;

const QUALOPS_COMMENT_MARKER = '<!-- qualops-analysis-comment -->';

interface GitLabConfig {
  enabled?: boolean;
  postComments?: boolean;
  skipOnDraft?: boolean;
  blockPipeline?: boolean;
}

interface ReportConfig {
  includedSeverities?: string[];
}

interface QualOpsConfig {
  gitlab?: GitLabConfig;
  report?: ReportConfig;
}

interface GitLabEnv {
  CI_PROJECT_ID?: string;
  CI_MERGE_REQUEST_IID?: string;
  CI_JOB_TOKEN?: string;
  CI_API_V4_URL?: string;
  CI_MERGE_REQUEST_DIFF_BASE_SHA?: string;
  CI_MERGE_REQUEST_SOURCE_BRANCH_SHA?: string;
  CI_COMMIT_SHA?: string;
  CI_PIPELINE_ID?: string;
  CI_PROJECT_URL?: string;
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

interface GitLabJob {
  id: number;
  name: string;
}

interface GitLabNote {
  id: number;
  body: string;
  author: {
    username: string;
  };
}

interface ReviewIssue {
  file: string;
  location: string;
  severity: string;
  description: string;
  type: string;
}

class GitLabIntegration {
  private env: GitLabEnv;
  private apiUrl: string;
  private headers: Record<string, string>;
  private config: GitLabConfig;
  private inlineCommentSeverities: string[];
  private token: string;

  constructor() {
    this.env = process.env as GitLabEnv;

    const apiBaseUrl = this.env.CI_API_V4_URL || '';
    if (!hasValidUrlScheme(apiBaseUrl)) {
      throw new Error('Invalid or missing CI_API_V4_URL - must be https:// or http://localhost');
    }

    const projectId = encodeURIComponent(this.env.CI_PROJECT_ID || '');
    this.apiUrl = `${apiBaseUrl}/projects/${projectId}`;

    this.token = process.env.GITLAB_ACCESS_TOKEN || this.env.CI_JOB_TOKEN || '';
    const tokenHeader = process.env.GITLAB_ACCESS_TOKEN ? 'PRIVATE-TOKEN' : 'JOB-TOKEN';

    this.headers = {
      [tokenHeader]: this.token,
      'Content-Type': 'application/json',
    };
    const { gitlab, includedSeverities } = this.loadConfig();
    this.config = gitlab;
    this.inlineCommentSeverities = includedSeverities;
  }

  private redactSensitiveData(text: string): string {
    if (!text) return text;

    let redacted = text;

    if (this.token && this.token.length > 0) {
      redacted = redacted.replace(new RegExp(this.token, 'g'), '[REDACTED_TOKEN]');
      if (this.token.length > 16) {
        redacted = redacted.replace(new RegExp(this.token.substring(0, 8), 'g'), '[REDACTED');
        redacted = redacted.replace(new RegExp(this.token.substring(this.token.length - 8), 'g'), 'REDACTED]');
      }
    }

    if (process.env.GITLAB_ACCESS_TOKEN) {
      redacted = redacted.replace(new RegExp(process.env.GITLAB_ACCESS_TOKEN, 'g'), '[REDACTED_ACCESS_TOKEN]');
    }
    if (this.env.CI_JOB_TOKEN) {
      redacted = redacted.replace(new RegExp(this.env.CI_JOB_TOKEN, 'g'), '[REDACTED_JOB_TOKEN]');
    }

    redacted = redacted.replace(/glpat-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_GITLAB_TOKEN]');
    redacted = redacted.replace(/glcbt-[a-zA-Z0-9_-]{20,}/g, '[REDACTED_CLUSTER_TOKEN]');

    return redacted;
  }

  private sanitizeMarkdown(text: string): string {
    if (!text) return text;

    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/\[/g, '&#91;')
      .replace(/\]/g, '&#93;')
      .replace(/\(/g, '&#40;')
      .replace(/\)/g, '&#41;')
      .replace(/`/g, '&#96;') // Backticks for code blocks
      .replace(/\*/g, '&#42;') // Asterisks for emphasis
      .replace(/_/g, '&#95;') // Underscores for emphasis
      .replace(/~/g, '&#126;') // Tildes for strikethrough
      .replace(/\|/g, '&#124;'); // Pipes for tables
  }

  private loadConfig(): { gitlab: GitLabConfig; includedSeverities: string[] } {
    const defaults = { gitlab: {}, includedSeverities: ['critical', 'high', 'medium'] };

    try {
      const configPath = join(process.cwd(), '.qualopsrc.json');
      if (!existsSync(configPath)) return defaults;

      const config: QualOpsConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      return {
        gitlab: config.gitlab || {},
        includedSeverities: config.report?.includedSeverities || defaults.includedSeverities,
      };
    } catch (error) {
      console.warn('Failed to load .qualopsrc.json, using defaults:', error instanceof Error ? error.message : error);
      return defaults;
    }
  }

  private async fetchAllPages<T>(url: string): Promise<T[]> {
    const allItems: T[] = [];
    let currentPage = 1;
    const perPage = 100;
    let hasMore = true;

    while (hasMore) {
      const separator = url.includes('?') ? '&' : '?';
      const paginatedUrl = `${url}${separator}per_page=${perPage}&page=${currentPage}`;

      try {
        const response = await fetch(paginatedUrl, {
          method: 'GET',
          headers: this.headers,
        });

        if (!response.ok) {
          console.warn(`Failed to fetch page ${currentPage}: ${response.status} ${response.statusText}`);
          break;
        }

        const items = (await response.json()) as T[];
        allItems.push(...items);

        const totalPages = response.headers.get('x-total-pages');
        const linkHeader = response.headers.get('link');

        if (totalPages) {
          hasMore = currentPage < parseInt(totalPages, 10);
        } else if (linkHeader) {
          hasMore = linkHeader.includes('rel="next"');
        } else {
          hasMore = items.length === perPage;
        }

        currentPage++;
      } catch (error) {
        console.warn(`Error fetching page ${currentPage}:`, error instanceof Error ? error.message : error);
        break;
      }
    }

    return allItems;
  }

  async getExistingQualOpsComment(): Promise<number | null> {
    if (!this.env.CI_MERGE_REQUEST_IID) {
      return null;
    }

    const url = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}/notes`;

    try {
      const notes = await this.fetchAllPages<GitLabNote>(url);
      const qualopsNote = notes.find((note) => note.body.includes(QUALOPS_COMMENT_MARKER));

      return qualopsNote?.id || null;
    } catch (error) {
      console.warn('Failed to fetch existing comments:', error);
      return null;
    }
  }

  async postMergeRequestComment(comment: string): Promise<void> {
    if (!this.env.CI_MERGE_REQUEST_IID) {
      console.log('No merge request IID found, skipping comment posting');
      return;
    }

    const commentWithMarker = `${QUALOPS_COMMENT_MARKER}\n${comment}`;
    const maxRetries = 3;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const existingCommentId = await this.getExistingQualOpsComment();

        if (existingCommentId) {
          const updateUrl = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}/notes/${existingCommentId}`;
          console.log(`Updating existing comment at: ${updateUrl} (attempt ${attempt}/${maxRetries})`);
          const response = await fetch(updateUrl, {
            method: 'PUT',
            headers: this.headers,
            body: JSON.stringify({ body: commentWithMarker }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            if (response.status === 404) {
              console.warn('Comment was deleted, retrying with create...');
              continue;
            }
            console.error(`Failed to update comment (${response.status} ${response.statusText})`);
            console.error(`Response: ${this.redactSensitiveData(errorText.substring(0, 500))}`);
            throw new Error(`Failed to update comment: ${response.statusText}`);
          }

          console.log('Updated existing QualOps comment on merge request');
          return;
        } else {
          const createUrl = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}/notes`;
          console.log(`Creating new comment at: ${createUrl} (attempt ${attempt}/${maxRetries})`);
          const response = await fetch(createUrl, {
            method: 'POST',
            headers: this.headers,
            body: JSON.stringify({ body: commentWithMarker }),
          });

          if (!response.ok) {
            const errorText = await response.text();
            console.error(`Failed to post comment (${response.status} ${response.statusText})`);
            console.error(`Response: ${this.redactSensitiveData(errorText.substring(0, 500))}`);
            throw new Error(`Failed to post comment: ${response.statusText}`);
          }

          console.log('Posted QualOps summary to merge request');
          return;
        }
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        console.warn(`Attempt ${attempt}/${maxRetries} failed:`, lastError.message);

        if (attempt < maxRetries) {
          const waitMs = Math.pow(2, attempt - 1) * 1000;
          console.log(`Waiting ${waitMs}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, waitMs));
        }
      }
    }

    console.error('Failed to post/update comment on merge request after all retries:', lastError);
  }

  async postInlineComment(
    issue: QualOpsResult['issues'][0],
    baseSha: string,
    headSha: string,
    debug = false,
  ): Promise<boolean> {
    if (!this.env.CI_MERGE_REQUEST_IID) {
      return false;
    }

    const url = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}/discussions`;
    const emoji = SEVERITY_EMOJI[issue.severity as keyof typeof SEVERITY_EMOJI] || '⚪';
    const sanitizedCategory = this.sanitizeMarkdown(issue.category);
    const sanitizedMessage = this.sanitizeMarkdown(issue.message);
    const body = `${emoji} **${issue.severity.toUpperCase()}**: ${sanitizedCategory}\n\n${sanitizedMessage}`;

    const position = {
      position_type: 'text',
      base_sha: baseSha,
      start_sha: baseSha,
      head_sha: headSha,
      old_path: issue.file,
      new_path: issue.file,
      new_line: issue.line,
    };

    if (debug) {
      console.log(`  Attempting inline comment: ${issue.file}:${issue.line} (${issue.severity})`);
      console.log(`    Position: base=${baseSha.substring(0, 8)} head=${headSha.substring(0, 8)} line=${issue.line}`);
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ body, position }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.warn(`✗ Failed to post inline comment for ${issue.file}:${issue.line}`);
        console.warn(`  Severity: ${issue.severity}`);
        console.warn(`  Status: ${response.status} ${response.statusText}`);
        console.warn(`  Position: base=${baseSha.substring(0, 8)} head=${headSha.substring(0, 8)} line=${issue.line}`);
        console.warn(`  Response: ${this.redactSensitiveData(errorText.substring(0, 300))}`);
        return false;
      }

      if (debug) {
        console.log(`  ✓ Posted successfully`);
      }
      return true;
    } catch (error) {
      console.warn(
        `✗ Failed to post inline comment for ${issue.file}:${issue.line} -`,
        error instanceof Error ? error.message : 'Unknown error',
      );
      return false;
    }
  }

  async getArtifactDownloadUrl(): Promise<string | null> {
    try {
      const jobsUrl = `${this.apiUrl}/pipelines/${this.env.CI_PIPELINE_ID}/jobs`;
      const response = await fetch(jobsUrl, {
        method: 'GET',
        headers: this.headers,
      });

      if (!response.ok) return null;

      const jobs = (await response.json()) as GitLabJob[];
      const qualopsJob = jobs.find((job) => job.name === 'qualops');

      if (qualopsJob?.id) {
        return `${this.env.CI_PROJECT_URL}/-/jobs/${qualopsJob.id}/artifacts/download`;
      }

      return null;
    } catch (error) {
      console.warn('Failed to get artifact download URL:', error);
      return null;
    }
  }

  private getStatusText(summary: QualOpsResult['summary']): string {
    const hasCritical = summary.criticalSeverity > 0;
    const hasHigh = summary.highSeverity > 0;
    return hasCritical || hasHigh ? 'FAILED' : summary.totalIssues > 0 ? 'WARNINGS' : 'PASSED';
  }

  private formatIssuesByType(issues: QualOpsResult['issues'], severity: string, emoji: string, limit: number): string {
    const filtered = issues.filter((i) => i.severity === severity).slice(0, limit);
    if (filtered.length === 0) return '';

    const severityTitle = severity.charAt(0).toUpperCase() + severity.slice(1);
    let section = `### ${emoji} ${severityTitle} Issues\n`;
    filtered.forEach((issue) => {
      const sanitizedFile = this.sanitizeMarkdown(issue.file);
      const sanitizedCategory = this.sanitizeMarkdown(issue.category);
      const sanitizedMessage = this.sanitizeMarkdown(issue.message);
      section += `- **${sanitizedFile}:${issue.line}** - ${sanitizedCategory}: ${sanitizedMessage}\n`;
    });
    return section + `\n`;
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

      if (summary.criticalSeverity > 0 || summary.highSeverity > 0) {
        const criticalCount = summary.criticalSeverity + summary.highSeverity;
        comment += `### Action Required\n`;
        comment += `There are **${criticalCount}** critical/high severity issues that require immediate attention.\n\n`;
      }
    }

    comment += `### Download Full Report\n`;
    if (artifactUrl) {
      // Validate URL scheme before using
      if (!hasValidUrlScheme(artifactUrl)) {
        console.warn('Invalid artifact URL scheme, skipping download link');
      } else {
        const sanitizedUrl = this.sanitizeMarkdown(artifactUrl);
        comment += `[**Download complete analysis report**](${sanitizedUrl})\n\n`;
        comment += `The artifact includes:\n`;
        comment += `- Detailed HTML reports with all findings\n`;
        comment += `- Session-based analysis results (JSON)\n`;
        comment += `- Framework-specific documentation used\n`;
      }
    }

    if (!artifactUrl || !hasValidUrlScheme(artifactUrl)) {
      comment += `Download the complete report from the pipeline job artifacts.\n`;
    }

    comment += `\n---\n`;
    comment += `*Powered by QualOps - AI-driven code quality analysis*`;

    return comment;
  }

  private findSessionsDir(reportsDir: string): string | null {
    let sessionsDir = join(reportsDir, 'sessions');
    if (existsSync(sessionsDir)) return sessionsDir;

    try {
      const entries = readdirSync(reportsDir, { withFileTypes: true });
      const latestReport = entries
        .filter((e) => e.isDirectory() && /^qualops-report-\d{8}$/.test(e.name))
        .map((e) => e.name)
        .sort()
        .reverse()[0];

      if (latestReport) {
        sessionsDir = join(reportsDir, latestReport, 'sessions');
        if (existsSync(sessionsDir)) {
          console.log(`Using report directory: ${latestReport}`);
          return sessionsDir;
        }
      }
    } catch (error) {
      console.error('Failed to scan reports directory:', error instanceof Error ? error.message : 'Unknown error');
    }

    return null;
  }

  parseQualOpsResults(reportsDir: string): QualOpsResult | null {
    const sessionsDir = this.findSessionsDir(reportsDir);
    if (!sessionsDir) {
      console.log('No sessions directory found');
      return null;
    }

    let sessionFolders: string[];
    try {
      sessionFolders = readdirSync(sessionsDir, { withFileTypes: true })
        .filter((dirent) => dirent.isDirectory())
        .map((dirent) => dirent.name);
    } catch (error) {
      console.error('Failed to read sessions directory:', error instanceof Error ? error.message : 'Unknown error');
      return null;
    }

    if (sessionFolders.length === 0) {
      console.log('No session folders found');
      return null;
    }

    const allIssues: QualOpsResult['issues'] = [];
    const filesAnalyzedSet = new Set<string>();
    let totalIssues = 0;
    let criticalSeverity = 0;
    let highSeverity = 0;
    let mediumSeverity = 0;
    let lowSeverity = 0;

    for (const sessionFolder of sessionFolders) {
      // Read overall report for summary statistics
      const overallReportPath = join(sessionsDir, sessionFolder, 'overall-report.json');
      const reviewSummaryPath = join(sessionsDir, sessionFolder, 'review-summary.json');
      const analysisPath = join(sessionsDir, sessionFolder, 'analysis.json');

      if (!existsSync(overallReportPath)) {
        console.warn(`No overall-report.json found in session folder: ${sessionFolder}`);
        continue;
      }

      try {
        // Read overall report for summary stats
        const overallContent = readFileSync(overallReportPath, 'utf8');
        const overallReport = JSON.parse(overallContent);

        totalIssues += overallReport.summary?.totalIssues || 0;
        criticalSeverity += overallReport.summary?.critical || 0;
        highSeverity += overallReport.summary?.high || 0;
        mediumSeverity += overallReport.summary?.medium || 0;
        lowSeverity += overallReport.summary?.low || 0;

        // Read analysis.json for file paths
        if (existsSync(analysisPath)) {
          const analysisContent = readFileSync(analysisPath, 'utf8');
          const analysisReport = JSON.parse(analysisContent);
          if (analysisReport.filePaths && Array.isArray(analysisReport.filePaths)) {
            analysisReport.filePaths.forEach((file: string) => filesAnalyzedSet.add(file));
          }
        }

        // Read review summary for detailed issues
        if (existsSync(reviewSummaryPath)) {
          const reviewContent = readFileSync(reviewSummaryPath, 'utf8');
          const reviewReport = JSON.parse(reviewContent);

          if (reviewReport.issues && Array.isArray(reviewReport.issues)) {
            // Transform issues to match expected format
            const transformedIssues = reviewReport.issues.map((issue: ReviewIssue) => {
              // Parse location field - handle both "42" and "line:42" formats
              const locationStr = issue.location.replace(/^line:?/i, '').trim();
              const lineNumber = parseInt(locationStr, 10) || 0;

              return {
                file: issue.file,
                line: lineNumber,
                severity: issue.severity,
                message: issue.description,
                category: issue.type,
              };
            });
            allIssues.push(...transformedIssues);
          }
        }
      } catch (error) {
        console.warn(
          `Failed to parse session ${sessionFolder}:`,
          error instanceof Error ? error.message : 'Unknown error',
        );
        continue;
      }
    }

    const result: QualOpsResult = {
      summary: {
        totalIssues,
        criticalSeverity,
        highSeverity,
        mediumSeverity,
        lowSeverity,
        filesAnalyzed: filesAnalyzedSet.size,
      },
      reportPath: sessionsDir,
      issues: allIssues,
    };

    console.log(`Parsed ${sessionFolders.length} session(s) with ${totalIssues} total issues`);
    return result;
  }

  parseJudgeDecision(reportsDir: string): { passed: boolean; reasons: string[] } | null {
    const sessionsDir = this.findSessionsDir(reportsDir);
    if (!sessionsDir) return null;

    try {
      const sessions = readdirSync(sessionsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name);

      for (const session of sessions) {
        const judgePath = join(sessionsDir, session, 'judge-decision.json');
        if (existsSync(judgePath)) {
          const data = JSON.parse(readFileSync(judgePath, 'utf8'));
          // Validate that the judge decision has a valid 'passed' boolean field
          if (typeof data.passed === 'boolean') {
            return { passed: data.passed, reasons: data.reasons || [] };
          }
        }
      }
    } catch (error) {
      console.warn('Failed to parse judge decision:', error instanceof Error ? error.message : 'Unknown error');
    }

    return null;
  }

  async testMergeRequestAccess(): Promise<boolean> {
    if (!this.env.CI_MERGE_REQUEST_IID) {
      return false;
    }

    const url = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}`;
    console.log(`Testing MR access at: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.headers,
      });

      console.log(`  MR access test: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`  Cannot access MR: ${this.redactSensitiveData(errorText.substring(0, 200))}`);
        return false;
      }

      const mr = await response.json();
      console.log(`  ✓ Successfully accessed MR #${mr.iid}: "${mr.title}"`);
      return true;
    } catch (error) {
      console.error('  Failed to test MR access:', error);
      return false;
    }
  }

  private async getExistingInlineComments(): Promise<Set<string>> {
    if (!this.env.CI_MERGE_REQUEST_IID) {
      return new Set();
    }

    const existingComments = new Set<string>();

    try {
      const url = `${this.apiUrl}/merge_requests/${this.env.CI_MERGE_REQUEST_IID}/discussions`;
      const discussions = await this.fetchAllPages<{
        individual_note: boolean;
        notes: Array<{
          type: string | null;
          resolved: boolean;
          position?: {
            new_path?: string;
            old_path?: string;
            new_line?: number;
            old_line?: number;
          };
        }>;
      }>(url);

      // Find all unresolved inline comments
      for (const discussion of discussions) {
        if (discussion.individual_note) continue;

        for (const note of discussion.notes) {
          if (note.type === 'DiffNote' && !note.resolved && note.position) {
            const file = note.position.new_path || note.position.old_path;
            const line = note.position.new_line || note.position.old_line;
            if (file && line) {
              existingComments.add(`${file}:${line}`);
            }
          }
        }
      }

      console.log(`  Found ${existingComments.size} existing unresolved inline comments`);
      return existingComments;
    } catch (error) {
      console.warn('Failed to fetch existing inline comments:', error instanceof Error ? error.message : error);
      return existingComments;
    }
  }

  private async getChangedLines(baseSha: string, headSha: string): Promise<Map<string, Set<number>>> {
    const { execSync } = await import('child_process');
    const changedLines = new Map<string, Set<number>>();

    // Validate SHAs to prevent command injection
    if (!isValidGitSha(baseSha) || !isValidGitSha(headSha)) {
      console.warn('Invalid SHA format detected, skipping git diff');
      return new Map();
    }

    try {
      const diffOutput = execSync(`git diff ${baseSha}..${headSha} --unified=0`, {
        encoding: 'utf-8',
        maxBuffer: 10 * 1024 * 1024,
      });

      let currentFile = '';
      const lines = diffOutput.split('\n');

      for (const line of lines) {
        if (line.startsWith('+++')) {
          currentFile = line.substring(6);
          if (!changedLines.has(currentFile)) {
            changedLines.set(currentFile, new Set());
          }
        } else if (line.startsWith('@@')) {
          const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
          if (match && currentFile) {
            const startLine = parseInt(match[1], 10);
            const lineCount = match[2] ? parseInt(match[2], 10) : 1;

            const fileLines = changedLines.get(currentFile);
            if (fileLines) {
              for (let i = 0; i < lineCount; i++) {
                fileLines.add(startLine + i);
              }
            }
          }
        }
      }

      return changedLines;
    } catch (error) {
      console.warn('Failed to get changed lines from git diff:', error instanceof Error ? error.message : error);
      return new Map();
    }
  }

  async run(): Promise<void> {
    console.log('Running GitLab integration for QualOps...');

    if (!this.env.CI_PROJECT_ID || !this.env.CI_JOB_TOKEN) {
      console.log('Not running in GitLab CI environment, skipping integration');
      return;
    }

    console.log(`Environment info:`);
    console.log(`  CI_PROJECT_ID: ${this.env.CI_PROJECT_ID}`);
    console.log(`  CI_MERGE_REQUEST_IID: ${this.env.CI_MERGE_REQUEST_IID}`);
    console.log(`  CI_API_V4_URL: ${this.env.CI_API_V4_URL}`);
    console.log(`  API URL: ${this.apiUrl}`);
    console.log(`  Has GITLAB_ACCESS_TOKEN: ${!!process.env.GITLAB_ACCESS_TOKEN}`);

    if (!process.env.GITLAB_ACCESS_TOKEN) {
      console.warn('⚠ GITLAB_ACCESS_TOKEN not set - comments will fail to post.');
      console.warn('  To enable MR comments, add a project access token as GITLAB_ACCESS_TOKEN CI/CD variable.');
      console.warn('  QualOps will still generate reports in job artifacts.');
    }

    // Test if we can access the merge request
    const canAccessMR = await this.testMergeRequestAccess();
    if (!canAccessMR) {
      console.error('⚠ Cannot access merge request - skipping comment posting');
      console.error('  This may be due to insufficient token permissions');
      console.error('  The token needs at least "api" scope with Guest role or higher');
    }

    const results = this.parseQualOpsResults('reports');
    if (!results) {
      console.log('No QualOps results found, skipping comment posting');
      return;
    }

    const baseSha = this.env.CI_MERGE_REQUEST_DIFF_BASE_SHA || '';
    const headSha = this.env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || this.env.CI_COMMIT_SHA || '';

    console.log(`Using base SHA: ${baseSha.substring(0, 8)} and head SHA: ${headSha.substring(0, 8)}`);

    if (baseSha && headSha && results.issues.length > 0) {
      console.log('Posting inline comments on diff...');

      const existingComments = await this.getExistingInlineComments();
      const changedLines = await this.getChangedLines(baseSha, headSha);
      console.log(`  Found ${changedLines.size} files with changes`);

      const inlineIssues = results.issues.filter((issue) => this.inlineCommentSeverities.includes(issue.severity));

      const commentableIssues = inlineIssues.filter((issue) => {
        const key = `${issue.file}:${issue.line}`;
        if (existingComments.has(key)) return false;

        const fileChangedLines = changedLines.get(issue.file);
        if (!fileChangedLines || !fileChangedLines.has(issue.line)) return false;

        return true;
      });

      console.log(`  Posting ${commentableIssues.length} inline comments...`);

      let successCount = 0;
      for (const issue of commentableIssues) {
        const success = await this.postInlineComment(issue, baseSha, headSha, false);
        if (success) successCount++;
      }

      console.log(`  Posted ${successCount}/${commentableIssues.length} inline comments`);
    }

    const artifactUrl = await this.getArtifactDownloadUrl();

    const comment = this.generateCommentFromResults(results, artifactUrl);
    await this.postMergeRequestComment(comment);

    console.log(`\nQualOps Analysis Complete:`);
    console.log(`   Issues found: ${results.summary.totalIssues}`);
    console.log(`   Critical: ${results.summary.criticalSeverity}`);
    console.log(`   High: ${results.summary.highSeverity}`);
    console.log(`   Medium: ${results.summary.mediumSeverity}`);
    console.log(`   Low: ${results.summary.lowSeverity}`);
    console.log(`   Files analyzed: ${results.summary.filesAnalyzed}`);

    const judgeDecision = this.parseJudgeDecision('reports');
    const hasCriticalOrHigh = results.summary.criticalSeverity > 0 || results.summary.highSeverity > 0;
    const judgeFailure = judgeDecision && !judgeDecision.passed;

    if (this.config.blockPipeline && (hasCriticalOrHigh || judgeFailure)) {
      const reasons = [];
      if (hasCriticalOrHigh) {
        reasons.push(
          `Found ${results.summary.criticalSeverity} critical and ${results.summary.highSeverity} high severity issues`,
        );
      }
      if (judgeFailure) {
        reasons.push(`Quality gate failed: ${judgeDecision.reasons.join('; ')}`);
      }
      console.error(`\n❌ Pipeline blocked: ${reasons.join('. ')}`);
      process.exit(1);
    }
  }
}

export { GitLabIntegration };
