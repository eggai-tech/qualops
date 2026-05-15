import { z } from 'zod';

export const SearchReplaceFixSchema = z
  .object({
    search: z
      .string()
      .min(1)
      .describe(
        'Exact code block to find in the file (5-10 lines). MUST appear EXACTLY ONCE. ' +
          'Include 2-3 lines of context before/after the problem so the match is unique. ' +
          'Preserve original indentation and whitespace. ' +
          'Only include code that needs changing — keep the block as small as possible while still being unique.',
      ),
    replace: z
      .string()
      .describe(
        'Fixed version of the same code block. Same indentation as the original. ' +
          'Change only what the issue requires — do not refactor unrelated lines.',
      ),
    explanation: z.string().describe('What changed and why'),
    confidence: z
      .enum(['high', 'medium', 'low'])
      .describe('Confidence that the fix is correct and will not break callers'),
    breaking: z
      .boolean()
      .describe('true if the change might break callers (signature change, behavior change)'),
  })
  .describe('A single search/replace operation that resolves one code-review finding');

export type SearchReplaceFix = z.infer<typeof SearchReplaceFixSchema>;
