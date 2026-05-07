import { z } from 'zod';

export const DedupIndicesSchema = z
  .array(z.number().int().nonnegative())
  .describe(
    'Zero-based indices of issues to KEEP (i.e. non-duplicates). ' +
      'Examples: [0, 2, 4] keeps issues at those positions; [0, 1, 2, 3, 4, 5] keeps everything; [0] collapses all duplicates to the first.',
  );
