import type { AIProvider } from '../../../ai/providers/provider';
import type { ProseReview } from '../../../shared/types/prose-review';
import { logger } from '../../../shared/utils/logger';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';

export class ProseValidationResolver {
  private aiProvider: AIProvider;

  constructor(aiProvider: AIProvider) {
    this.aiProvider = aiProvider;
  }

  async validate(reviews: ProseReview[]): Promise<ProseReview[]> {
    if (reviews.length === 0) return [];

    logger.info(`[ProseValidation] Validating ${reviews.length} prose reviews`);

    const results = await Promise.all(reviews.map((review) => this.validateOne(review)));

    logger.info(`[ProseValidation] Validation complete`);
    return results;
  }

  private async validateOne(review: ProseReview): Promise<ProseReview> {
    const fileLabel = review.file ?? '(whole PR)';
    const prompt = `Here is a code review response for ${fileLabel}. Remove any false positives.
Rewrite only the valid issues, keeping your prose style.
If no issues remain, reply: No issues found.

${review.content}`;

    await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

    const response = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.aiProvider.getMaxTokens(),
      temperature: this.aiProvider.getTemperature(),
    });

    return {
      file: review.file,
      passName: review.passName,
      content: response.content,
    };
  }
}
