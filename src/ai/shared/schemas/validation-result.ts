import { z } from 'zod';

export const ValidationResultItemSchema = z
  .object({
    index: z
      .number()
      .int()
      .nonnegative()
      .describe('Zero-based index of the issue in the input list this validation refers to'),
    is_false_positive: z
      .boolean()
      .describe(
        'true if the issue should be discarded as a false positive; false if it is a valid finding',
      ),
    confidence: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Revised confidence from 1 (speculative) to 10 (certain) after re-examination'),
    severity: z
      .enum(['critical', 'high', 'medium', 'low'])
      .describe('Revised severity after re-examination'),
    reasoning: z
      .string()
      .describe(
        'Why the confidence/severity changed, or — if is_false_positive — why the original finding is invalid',
      ),
  })
  .describe('Validation verdict for one input issue');

export const ValidationResultsSchema = z
  .array(ValidationResultItemSchema)
  .describe(
    'One validation entry per input issue, in the same order. Every input issue MUST appear exactly once.',
  );

export type ValidationResultItem = z.infer<typeof ValidationResultItemSchema>;
