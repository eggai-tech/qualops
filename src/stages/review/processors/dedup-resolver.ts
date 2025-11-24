import type { AIProvider } from '../../../ai/providers/provider';
import type { ReviewIssue } from '../../../shared/types';
import type { DeduplicationConfig, PipelineJob, PromptConfig, ReviewConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { PromptLoader } from '../loaders/prompt-loader';
import { TemplateEngine } from '../loaders/template-engine';
import { globalRateLimiter } from '../utils/global-rate-limiter';

const DEDUP_RESPONSE_SPEC = `

<response_format>
Return a JSON array containing the indices of issues to KEEP (non-duplicates).

Examples:
- Issues at indices 0, 2, 4 should be kept: [0, 2, 4]
- All issues are unique: [0, 1, 2, 3, 4, 5]
- All are duplicates of first one: [0]
</response_format>
`;

export class DeduplicationResolver {
  private globalConfig: ReviewConfig;
  private aiProvider: AIProvider;

  constructor(globalConfig: ReviewConfig, aiProvider: AIProvider) {
    this.globalConfig = globalConfig;
    this.aiProvider = aiProvider;
  }

  async deduplicate(issues: ReviewIssue[], job: PipelineJob): Promise<ReviewIssue[]> {
    if (issues.length <= 1) {
      return issues;
    }

    const config = this.resolveConfig(job);

    if (!config.enabled || !config.prompt) {
      return issues;
    }

    logger.info(`[Dedup] Processing ${issues.length} issues from all passes`);

    const issuesByFile = this.groupByFile(issues);
    const deduped: ReviewIssue[] = [];

    for (const [file, fileIssues] of Object.entries(issuesByFile)) {
      if (fileIssues.length <= 1) {
        deduped.push(...fileIssues);
      } else {
        logger.debug(`[Dedup] ${file}: ${fileIssues.length} issues to deduplicate`);
        const dedupedFile = await this.deduplicateFile(fileIssues, config.prompt);
        logger.debug(`[Dedup] ${file}: kept ${dedupedFile.length}/${fileIssues.length} issues`);
        deduped.push(...dedupedFile);
      }
    }

    logger.info(`[Dedup] Kept ${deduped.length}/${issues.length} issues`);

    return deduped;
  }

  private groupByFile(issues: ReviewIssue[]): Record<string, ReviewIssue[]> {
    const grouped: Record<string, ReviewIssue[]> = {};
    for (const issue of issues) {
      grouped[issue.file] = grouped[issue.file] || [];
      grouped[issue.file].push(issue);
    }
    return grouped;
  }

  private resolveConfig(job: PipelineJob): Required<DeduplicationConfig> {
    return {
      enabled: job.deduplication?.enabled ?? this.globalConfig.deduplication?.enabled ?? true,
      prompt: job.deduplication?.prompt ?? this.globalConfig.deduplication?.prompt ?? '',
    };
  }

  private async deduplicateFile(issues: ReviewIssue[], promptRef: string | PromptConfig): Promise<ReviewIssue[]> {
    const { content } = await PromptLoader.load(promptRef);

    const issuesJson = JSON.stringify(
      issues.map((issue, idx) => ({
        index: idx,
        type: issue.type,
        severity: issue.severity,
        file: issue.file,
        location: issue.location,
        description: issue.description,
        confidence: issue.confidence,
      })),
      null,
      2,
    );

    const prompt = TemplateEngine.render(content + DEDUP_RESPONSE_SPEC, {
      ISSUES_LIST: issuesJson,
      MIN_CONFIDENCE: this.globalConfig.validation?.minConfidence ?? 7,
      REVIEW_MIN_CONFIDENCE: this.globalConfig.minConfidence ?? 4,
    });

    await globalRateLimiter.throttleApiCall(this.aiProvider.name);

    const response = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 4000,
      temperature: 0,
    });

    const indices = this.parseIndices(response.content);
    return issues.filter((_, idx) => indices.includes(idx));
  }

  private parseIndices(content: string): number[] {
    const match = content.match(/\[[\s\S]*?\]/);
    if (!match) return [];

    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed.filter((idx: any) => typeof idx === 'number') : [];
  }
}
