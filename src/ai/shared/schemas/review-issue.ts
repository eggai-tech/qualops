import { z } from 'zod';

export const ReviewIssueItemSchema = z
  .object({
    type: z
      .enum(['security', 'performance', 'bug', 'maintainability'])
      .describe('Category of the issue'),
    severity: z
      .enum(['critical', 'high', 'medium', 'low'])
      .describe(
        'Impact severity. critical=exploitable/data-loss; high=functional bug; medium=quality; low=style',
      ),
    description: z.string().min(1).describe('One-sentence summary of the problem'),
    location: z
      .string()
      .describe(
        'Source position in the form "line:N" (preferred) or "path/to/file:N". A bare "N" is also accepted.',
      ),
    reasoning: z
      .string()
      .default('')
      .describe('Why this specific code is problematic — explain the failure mode'),
    context: z
      .string()
      .default('')
      .describe(
        'Short code snippet illustrating the issue. Use \\n for newlines inside the JSON string.',
      ),
    suggestion: z.string().default('').describe('Concrete fix the author should apply'),
    confidence: z
      .number()
      .int()
      .min(1)
      .max(10)
      .describe('Self-rated confidence from 1 (speculative) to 10 (certain)'),
    impact: z.string().optional().describe('Impact if exploited (security issues only)'),
    cwe: z.string().optional().describe('CWE identifier (e.g. "CWE-79") if applicable'),
    threat_model: z
      .string()
      .optional()
      .describe('Attacker access required to exploit (security issues only)'),
    effort: z.enum(['low', 'medium', 'high']).optional().describe('Estimated effort to fix'),
  })
  .describe('A single code-review finding');

export const ReviewIssuesSchema = z
  .array(ReviewIssueItemSchema)
  .describe('All review findings for the file. Return an empty array if no issues are found.');

export type ReviewIssueItem = z.infer<typeof ReviewIssueItemSchema>;
