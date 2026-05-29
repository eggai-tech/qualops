import type { AIProvider } from '../../../ai/providers/provider';
import { PROSE_NO_ISSUES_SENTINEL, type ProseReview } from '../../../shared/types/prose-review';
import { logger } from '../../../shared/utils/logger';
import { getGlobalRateLimiter } from '../utils/global-rate-limiter';

export class ProseDeduplicationResolver {
  private aiProvider: AIProvider;

  constructor(aiProvider: AIProvider) {
    this.aiProvider = aiProvider;
  }

  async deduplicate(reviews: ProseReview[]): Promise<ProseReview[]> {
    const nonEmpty = reviews.filter(
      (r) =>
        r.content.trim() &&
        r.content.trim().toLowerCase() !== PROSE_NO_ISSUES_SENTINEL.toLowerCase(),
    );

    if (nonEmpty.length <= 1) return nonEmpty;

    logger.info(`[ProseDedup] Deduplicating ${nonEmpty.length} prose reviews`);

    const sections = nonEmpty
      .map((r) => `### ${r.file ?? '(whole PR)'}\n\n${r.content}`)
      .join('\n\n---\n\n');

    const prompt = `Below are code review responses for multiple files. Some issues may be mentioned
across multiple files. Consolidate any cross-file duplicates into one mention.
Return the full updated set of reviews, one section per file, using the same
"### <filename>" heading format.

${sections}`;

    await getGlobalRateLimiter().throttleApiCall(this.aiProvider.name);

    const response = await this.aiProvider.complete({
      messages: [{ role: 'user', content: prompt }],
      maxTokens: this.aiProvider.getMaxTokens(),
      temperature: this.aiProvider.getTemperature(),
    });

    // Parse the model's response back into ProseReview[] by splitting on "### " headings.
    // If the model returns a single consolidated document without headings, wrap it as one entry.
    const rawText = response.content.trim();
    const parsed = this.parseConsolidated(rawText, nonEmpty);

    logger.info(`[ProseDedup] Deduplication complete: ${parsed.length} entries`);
    return parsed;
  }

  private parseConsolidated(text: string, originals: ProseReview[]): ProseReview[] {
    // Try to split on "### <heading>" markers that the model should have produced
    const headingRegex = /^### (.+)$/m;
    if (!headingRegex.test(text)) {
      // No headings — model returned a single block; use the first original's pass/file metadata
      return [{ file: null, passName: originals[0]?.passName ?? 'review', content: text }];
    }

    const parts = text.split(/^### /m).filter((p) => p.trim());
    const results: ProseReview[] = [];

    for (const part of parts) {
      const newline = part.indexOf('\n');
      const heading = newline === -1 ? part.trim() : part.slice(0, newline).trim();
      const content = newline === -1 ? '' : part.slice(newline + 1).trim();

      // Match heading back to an original entry to preserve passName
      const original = originals.find((r) => (r.file ?? '(whole PR)') === heading);

      results.push({
        file: original?.file ?? (heading === '(whole PR)' ? null : heading),
        passName: original?.passName ?? originals[0]?.passName ?? 'review',
        content,
      });
    }

    return results.length > 0
      ? results
      : [{ file: null, passName: originals[0]?.passName ?? 'review', content: text }];
  }
}
