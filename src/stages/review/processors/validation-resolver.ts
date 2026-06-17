import { z } from 'zod';

import type { AIProvider } from '../../../ai/providers/provider';
import {
  ValidationResultsSchema,
  type ValidationResultItem,
} from '../../../ai/shared/schemas/validation-result';

const ValidationOutputSchema = z.object({ validations: ValidationResultsSchema });
import { StructuredOutputError } from '../../../ai/shared/structured';
import type { ReviewIssue } from '../../../shared/types';
import type {
  PipelineJob,
  PromptConfig,
  ReviewConfig,
  ValidationConfig,
} from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { PromptLoader } from '../loaders/prompt-loader';
import { TemplateEngine } from '../loaders/template-engine';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';

const ISSUES_SECTION = `

## Issues to Validate

Below are the issues found during code review. Validate each one.

{{ISSUES_LIST}}
`;

export class ValidationResolver {
  private globalConfig: ReviewConfig;
  private aiProvider: AIProvider;

  constructor(globalConfig: ReviewConfig, aiProvider: AIProvider) {
    this.globalConfig = globalConfig;
    this.aiProvider = aiProvider;
  }

  async validate(issues: ReviewIssue[], job: PipelineJob): Promise<ReviewIssue[]> {
    const config = this.resolveConfig(job);

    if (!config.enabled) {
      logger.debug('[Validation] Disabled, skipping');
      return issues;
    }

    logger.info(
      `[Validation] Validating ${issues.length} issues (minConfidence: ${config.minConfidence})`,
    );

    let validated = issues.filter((issue) => {
      const passes = issue.confidence >= (config.minConfidence || 7);
      if (!passes) {
        logger.debug(
          `[Validation] Filtered by confidence: ${issue.file}:${issue.location} (confidence: ${issue.confidence})`,
        );
      }
      return passes;
    });

    logger.info(
      `[Validation] After confidence filter: ${validated.length}/${issues.length} issues`,
    );

    if (config.prompt && validated.length > 0) {
      validated = await this.validateWithAI(validated, config.prompt);
      logger.info(`[Validation] After AI validation: ${validated.length} issues`);
    }

    return validated;
  }

  private resolveConfig(job: PipelineJob): Required<ValidationConfig> {
    return {
      enabled: job.validation?.enabled ?? this.globalConfig.validation?.enabled ?? true,
      minConfidence:
        job.validation?.minConfidence ?? this.globalConfig.validation?.minConfidence ?? 7,
      prompt: job.validation?.prompt ?? this.globalConfig.validation?.prompt ?? '',
    };
  }

  private async validateWithAI(
    issues: ReviewIssue[],
    promptRef: string | PromptConfig,
  ): Promise<ReviewIssue[]> {
    logger.info(`[Validation] Running AI validation on ${issues.length} issues`);

    const { content } = await PromptLoader.load(promptRef);

    const issuesJson = JSON.stringify(
      issues.map((issue, idx) => ({
        index: idx,
        type: issue.type,
        severity: issue.severity,
        confidence: issue.confidence,
        file: issue.file,
        location: issue.location,
        description: issue.description,
        reasoning: issue.reasoning,
        context: issue.context,
      })),
      null,
      2,
    );

    const fullPrompt = content + ISSUES_SECTION;
    const prompt = TemplateEngine.render(fullPrompt, {
      ISSUES_LIST: issuesJson,
      MIN_CONFIDENCE: this.globalConfig.validation?.minConfidence ?? 7,
      REVIEW_MIN_CONFIDENCE: this.globalConfig.minConfidence ?? 4,
    });

    await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

    let validations: ValidationResultItem[];
    try {
      const response = await this.aiProvider.complete({
        messages: [{ role: 'user', content: prompt }],
        schema: ValidationOutputSchema,
        maxTokens: 8000,
        temperature: 0,
      });
      validations = response.content.validations;
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        logger.warn(`[Validation] Structured output failed: ${error.message}`);
        logger.warn(`[Validation] Raw preview: ${error.raw.slice(0, 300)}...`);
        return [];
      }
      throw error;
    }

    const validatedIssues: ReviewIssue[] = [];

    for (const validation of validations) {
      if (validation.index < 0 || validation.index >= issues.length) {
        logger.warn(`[Validation] Invalid index ${validation.index}, skipping`);
        continue;
      }

      if (validation.is_false_positive) {
        logger.debug(
          `[Validation] Marked as false positive: ${issues[validation.index].file}:${issues[validation.index].location}`,
        );
        continue;
      }

      const issue = { ...issues[validation.index] };
      issue.confidence = validation.confidence;
      issue.severity = validation.severity;
      issue.validation_reasoning = validation.reasoning;
      validatedIssues.push(issue);
    }

    logger.info(
      `[Validation] Kept ${validatedIssues.length}/${issues.length} issues after AI validation`,
    );

    return validatedIssues;
  }
}
