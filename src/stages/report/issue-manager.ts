import { existsSync, readdirSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { ReviewIssue } from '../../shared/types';
import { logger } from '../../shared/utils/logger';

export class IssueManager {
  private issuesDir: string;

  constructor(issuesDir: string) {
    this.issuesDir = issuesDir;
  }

  async initialize(): Promise<void> {
    await mkdir(this.issuesDir, { recursive: true });
  }

  getNextIssueId(): number {
    if (!existsSync(this.issuesDir)) {
      return 1;
    }

    const files = readdirSync(this.issuesDir).filter(
      (f) => f.startsWith('ISSUE-') && f.endsWith('.md'),
    );
    return files.length + 1;
  }

  sanitizeTitle(title: string): string {
    if (!title) {
      return 'untitled-issue';
    }
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }

  generateIssueMarkdown(issue: ReviewIssue, issueId: number): string {
    const severity = issue.severity?.toUpperCase() || 'UNKNOWN';
    const category = issue.type || 'unknown';

    let markdown = `# ISSUE-${issueId.toString().padStart(3, '0')}\n\n`;
    markdown += `**Status:** OPEN\n`;
    markdown += `**Severity:** ${severity}\n`;
    markdown += `**Category:** ${category}\n`;
    markdown += `**File:** \`${issue.file}\`\n`;
    markdown += `**Line:** ${issue.line || issue.location}\n\n`;

    markdown += `## Description\n\n`;
    markdown += `${issue.description}\n\n`;

    if (issue.reasoning) {
      markdown += `## Reasoning\n\n`;
      markdown += `${issue.reasoning}\n\n`;
    }

    if (issue.context) {
      markdown += `## Context\n\n`;
      markdown += `\`\`\`\n${issue.context}\n\`\`\`\n\n`;
    }

    if (issue.suggestion) {
      markdown += `## Suggested Fix\n\n`;
      markdown += `${issue.suggestion}\n\n`;
    }

    if (issue.knowledge_source) {
      markdown += `## Knowledge Source\n\n`;
      markdown += `${issue.knowledge_source}\n\n`;
    }

    if (issue.confidence !== undefined) {
      markdown += `## Confidence\n\n`;
      markdown += `${issue.confidence}/10\n\n`;
    }

    return markdown;
  }

  async writeIssue(issue: ReviewIssue, issueId: number): Promise<string> {
    const filename = `ISSUE-${issueId.toString().padStart(3, '0')}-${this.sanitizeTitle(issue.description)}.md`;
    const filepath = join(this.issuesDir, filename);
    const content = this.generateIssueMarkdown(issue, issueId);

    await writeFile(filepath, content, 'utf-8');
    logger.info(`[ISSUE] Generated ${filename}`);

    return filepath;
  }

  async writeAllIssues(issues: ReviewIssue[]): Promise<Map<ReviewIssue, number>> {
    await this.initialize();

    let currentId = this.getNextIssueId();
    const issueIdMap = new Map<ReviewIssue, number>();

    for (const issue of issues) {
      await this.writeIssue(issue, currentId);
      issueIdMap.set(issue, currentId);
      currentId++;
    }

    logger.info(`[ISSUE] Generated ${issues.length} issue markdown files`);
    return issueIdMap;
  }
}
