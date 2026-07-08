import type { AIMessage, AIProvider } from '../../../ai/providers/provider';
import {
  getTracer,
  recordSpanError,
  setModelAttribute,
  setObservationIO,
  setTokenUsage,
} from '../../../observability';
import type { FileInfo } from '../../../shared/types/config';
import type { ProseReview } from '../../../shared/types/prose-review';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';
import { addLineNumbers, buildDiffContext } from '../utils/line-numbered-content';

const PROSE_FORMAT_INSTRUCTION = `
---
Describe your findings in plain prose. For each issue you find, explain:
- What the problem is and where it occurs (file and approximate line)
- Why it is a problem
- How to fix it

If you find no issues, say so clearly.`;

export class ProseFileReviewer {
  private aiProvider: AIProvider;
  private systemPrompt: string;
  private passName: string;

  constructor(aiProvider: AIProvider, systemPrompt: string, passName: string) {
    this.aiProvider = aiProvider;
    this.systemPrompt = systemPrompt + PROSE_FORMAT_INSTRUCTION;
    this.passName = passName;
  }

  async reviewFile(file: FileInfo): Promise<ProseReview> {
    const userMessage = this.buildUserMessage(file);
    const messages: AIMessage[] = [
      { role: 'system', content: this.systemPrompt, cacheControl: { ttl: '5m' } },
      { role: 'user', content: userMessage },
    ];

    const tracer = getTracer();

    return tracer.startActiveSpan(`prose-file-review/${file.path}`, async (span) => {
      try {
        setModelAttribute(span, this.aiProvider.getModelName());
        setObservationIO(span, { input: messages });

        await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

        const response = await this.aiProvider.complete({
          messages,
          maxTokens: this.aiProvider.getMaxTokens(),
          temperature: this.aiProvider.getTemperature(),
        });

        const review: ProseReview = {
          file: file.path,
          passName: this.passName,
          content: response.content,
        };

        setTokenUsage(span, {
          model: this.aiProvider.getModelName(),
          inputTokens: response.usage?.promptTokens,
          outputTokens: response.usage?.completionTokens,
        });
        setObservationIO(span, { output: review });

        return review;
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
\`\`\``;
  }
}
