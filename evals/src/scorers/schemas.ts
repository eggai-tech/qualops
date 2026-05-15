'use strict';

import { z } from 'zod';

export const CrbGoldenCommentSchema = z.object({
  goldenIndex: z.number().int().nonnegative(),
  description: z.string(),
  type: z.string().nullable(),
  severity: z.string().nullable(),
  matched: z.boolean(),
  confidence: z.number().min(0).max(1),
  matchedCandidate: z.string().nullable(),
});

export type CrbGoldenCommentDetails = z.infer<typeof CrbGoldenCommentSchema>;

export function parseCrbGoldenCommentDetails(data: unknown): CrbGoldenCommentDetails {
  return CrbGoldenCommentSchema.parse(data);
}

export const RecallReportSummarySchema = z.object({
  alwaysDetected: z.number().int().nonnegative(),
  neverDetected: z.number().int().nonnegative(),
  flaky: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
});

export type RecallReportSummary = z.infer<typeof RecallReportSummarySchema>;

export const RecallReportEntrySchema = z.object({
  key: z.string(),
  caseId: z.string(),
  goldenIndex: z.number().int().nonnegative(),
  description: z.string(),
  type: z.string().nullable(),
  severity: z.string().nullable(),
  matchRate: z.number().nullable(),
  matchCount: z.number().int().nonnegative(),
  totalRuns: z.number().int().nonnegative(),
  stubRuns: z.number().int().nonnegative(),
});

export type RecallReportEntry = z.infer<typeof RecallReportEntrySchema>;

export const RecallReportSchema = z.object({
  summary: RecallReportSummarySchema,
  runsWithDetails: z.number().int().nonnegative(),
  runsWithoutDetails: z.number().int().nonnegative(),
  goldens: z.array(RecallReportEntrySchema),
});

export type RecallReport = z.infer<typeof RecallReportSchema>;

export function parseRecallReport(data: unknown): RecallReport {
  return RecallReportSchema.parse(data);
}
