import { z } from 'zod';

export const RootCauseClassificationItemSchema = z
  .object({
    issueId: z.string().describe('The exact ID of the issue being classified (e.g. "ISSUE-001")'),
    rootCause: z
      .string()
      .describe(
        'Key of the matching root-cause category from the taxonomy (e.g. "memory_leaks_cleanup"). ' +
          'Use the most specific category that fits. If multiple apply, choose the primary one. ' +
          'Use "other" only if no category fits.',
      ),
    confidence: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Confidence in the classification, 1 (speculative) to 10 (very confident)'),
  })
  .describe('Root-cause classification for one issue');

export const RootCauseClassificationsSchema = z
  .array(RootCauseClassificationItemSchema)
  .describe(
    'One classification per input issue, in the same order. Every input issue MUST appear.',
  );

export type RootCauseClassificationItem = z.infer<typeof RootCauseClassificationItemSchema>;
