import type { AIMessage, AIProvider } from '../../../ai/providers/provider';
import { ReviewIssuesSchema, type ReviewIssueItem } from '../../../ai/shared/schemas/review-issue';
import { StructuredOutputError } from '../../../ai/shared/structured';
import {
  getTracer,
  recordSpanError,
  setModelAttribute,
  setObservationIO,
  setTokenUsage,
} from '../../../observability';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';
import { addLineNumbers, buildDiffContext } from '../utils/line-numbered-content';

export class FileReviewer {
  private aiProvider: AIProvider;
  private systemPrompt: string;
  private passName: string;

  constructor(aiProvider: AIProvider, systemPrompt: string, passName: string) {
    this.aiProvider = aiProvider;
    this.systemPrompt = systemPrompt;
    this.passName = passName;
  }

  async reviewFile(file: FileInfo): Promise<ReviewIssue[]> {
    const userMessage = this.buildUserMessage(file);
    const messages: AIMessage[] = [
      { role: 'system', content: this.systemPrompt, cacheControl: { ttl: '5m' } },
      { role: 'user', content: userMessage },
    ];

    const tracer = getTracer();

    return tracer.startActiveSpan(`file-review/${file.path}`, async (span) => {
      try {
        setModelAttribute(span, this.aiProvider.getModelName());
        setObservationIO(span, { input: messages });

        await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

        try {
          const response = await this.aiProvider.complete({
            messages,
            schema: ReviewIssuesSchema,
            maxTokens: this.aiProvider.getMaxTokens(),
            temperature: this.aiProvider.getTemperature(),
          });

          const parsedIssues = response.content.map((item) => this.toReviewIssue(item, file.path));

          setTokenUsage(span, {
            model: this.aiProvider.getModelName(),
            inputTokens: response.usage?.promptTokens,
            outputTokens: response.usage?.completionTokens,
          });
          setObservationIO(span, { output: parsedIssues });

          return parsedIssues;
        } catch (error) {
          if (error instanceof StructuredOutputError) {
            logger.warn(
              `[FileReviewer] Structured output failed for ${file.path}: ${error.message}`,
            );
            logger.warn(`[FileReviewer] Raw preview: ${error.raw.slice(0, 300)}...`);
            return [];
          }
          throw error;
        }
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private buildUserMessage(file: FileInfo): string {
    const diffContext = buildDiffContext(file);

    return `Please review the following file:

File: ${file.path}
${diffContext}

\`\`\`
${addLineNumbers(file.content)}
\`\`\`

If no issues are found, respond with an empty array: []`;
  }

  private toReviewIssue(item: ReviewIssueItem, filePath: string): ReviewIssue {
    const location = this.normalizeLocation(item.location);
    return {
      id: this.generateIssueId(filePath, item.description, location),
      file: filePath,
      type: item.type,
      severity: item.severity,
      description: item.description,
      location,
      reasoning: item.reasoning,
      suggestion: item.suggestion,
      context: item.context,
      confidence: item.confidence,
      knowledge_source: this.passName,
      priority: this.calculatePriority(item.severity),
      estimatedEffort: item.effort ?? 'medium',
      tags: this.generateTags(item.type, item.severity, filePath),
      ...(item.impact ? { impact: item.impact } : {}),
      ...(item.cwe ? { cwe: item.cwe } : {}),
      ...(item.threat_model ? { threat_model: item.threat_model } : {}),
    };
  }

  private normalizeLocation(location: string): string {
    const numbers = location.match(/\d+/g);
    return numbers ? numbers[0] : '1';
  }

  private generateIssueId(filePath: string, description: string, location: string): string {
    const timestamp = Date.now();
    const hash = Math.abs(
      (filePath + description + location).split('').reduce((a, b) => {
        a = (a << 5) - a + b.charCodeAt(0);
        return a & a;
      }, 0),
    );
    return `${filePath}-L${location}-${timestamp}-${hash}`;
  }

  private calculatePriority(severity: ReviewIssueItem['severity']): number {
    const priorities = { critical: 1, high: 2, medium: 3, low: 4 };
    return priorities[severity];
  }

  private generateTags(
    type: ReviewIssueItem['type'],
    severity: ReviewIssueItem['severity'],
    filePath: string,
  ): string[] {
    const tags: string[] = [type, severity];
    const ext = filePath.split('.').pop();
    if (ext) tags.push(ext);
    return tags;
  }
}
