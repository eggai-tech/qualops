import type { AIProvider } from '../../../ai/providers/provider';
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
import { globalRateLimiter } from '../utils/global-rate-limiter';

const ISSUES_SECTION = `

## Issues to Validate

Below are the issues found during code review. Validate each one and return a JSON array with your validation results.

{{ISSUES_LIST}}
`;

const VALIDATION_RESPONSE_SPEC = `

<response_format>
Return a JSON array with validation for each issue index.

For each issue, provide:
- index: the issue index (0-based)
- is_false_positive: true if this is a false positive, false if valid
- confidence: revised confidence score (1-10)
- severity: revised severity ("critical"|"high"|"medium"|"low")
- reasoning: explanation of why confidence/severity were adjusted or why it's a false positive

Example:
[
  {
    "index": 0,
    "is_false_positive": false,
    "confidence": 8,
    "severity": "high",
    "reasoning": "Confirmed as valid issue. Severity remains high due to security impact."
  },
  {
    "index": 1,
    "is_false_positive": true,
    "confidence": 3,
    "severity": "low",
    "reasoning": "This is a false positive because the code pattern is correct for this framework version."
  }
]

You must return validation for ALL issues in the same order they were provided.
</response_format>
`;

interface ValidationResult {
  index: number;
  is_false_positive: boolean;
  confidence: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  reasoning: string;
}

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

    const fullPrompt = content + ISSUES_SECTION + VALIDATION_RESPONSE_SPEC;
    const prompt = TemplateEngine.render(fullPrompt, {
      ISSUES_LIST: issuesJson,
      MIN_CONFIDENCE: this.globalConfig.validation?.minConfidence ?? 7,
      REVIEW_MIN_CONFIDENCE: this.globalConfig.minConfidence ?? 4,
    });

    await globalRateLimiter.throttleApiCall(this.aiProvider.name);

    const response = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 8000,
      temperature: 0,
    });

    const validations = this.parseValidations(response.content);

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

  private parseValidations(content: string): ValidationResult[] {
    if (!content || content.trim() === '') {
      logger.warn('[Validation] Empty response from AI');
      return [];
    }

    // Try code block first, then raw array
    const codeBlockMatch = content.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
    const arrayMatch = content.match(/\[[\s\S]*\]/);
    const jsonString = codeBlockMatch?.[1] || arrayMatch?.[0];

    if (!jsonString) {
      logger.warn('[Validation] No JSON array found in AI response');
      logger.warn(`[Validation] Response preview: ${content.slice(0, 300)}...`);
      return [];
    }

    try {
      const fixedJson = this.fixMalformedJson(jsonString);
      const parsed = JSON.parse(fixedJson);
      if (!Array.isArray(parsed)) {
        logger.warn('[Validation] Response is not an array');
        logger.warn(`[Validation] Parsed value: ${JSON.stringify(parsed).slice(0, 200)}`);
        return [];
      }

      return parsed.filter(
        (v: any) =>
          typeof v.index === 'number' &&
          typeof v.is_false_positive === 'boolean' &&
          typeof v.confidence === 'number' &&
          typeof v.severity === 'string' &&
          typeof v.reasoning === 'string',
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown parse error';
      logger.warn(`[Validation] JSON parse error: ${errorMsg}`);
      logger.warn(`[Validation] JSON preview: ${jsonString.slice(0, 300)}...`);
      return [];
    }
  }

  private fixMalformedJson(json: string): string {
    let inString = false;
    let escaped = false;
    let result = '';

    for (let i = 0; i < json.length; i++) {
      const char = json[i];

      if (escaped) {
        result += char;
        escaped = false;
        continue;
      }

      if (char === '\\') {
        escaped = true;
        result += char;
        continue;
      }

      if (char === '"') {
        inString = !inString;
        result += char;
        continue;
      }

      if (inString && char === '\n') {
        result += '\\n';
        continue;
      }

      if (inString && char === '\r') {
        continue;
      }

      if (inString && char === '\t') {
        result += '\\t';
        continue;
      }

      result += char;
    }

    return result;
  }
}
