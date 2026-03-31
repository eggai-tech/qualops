'use strict';

const { z } = require('zod');

const CrbGoldenCommentSchema = z.object({
  goldenIndex:      z.number().int().nonnegative(),
  description:      z.string(),
  type:             z.string().nullable(),
  severity:         z.string().nullable(),
  matched:          z.boolean(),
  confidence:       z.number().min(0).max(1),
  matchedCandidate: z.string().nullable(),
});

const RecallReportSummarySchema = z.object({
  alwaysDetected: z.number().int().nonnegative(),
  neverDetected:  z.number().int().nonnegative(),
  flaky:          z.number().int().nonnegative(),
  total:          z.number().int().nonnegative(),
});

const RecallReportEntrySchema = z.object({
  key:          z.string(),
  caseId:       z.string(),
  goldenIndex:  z.number().int().nonnegative(),
  description:  z.string(),
  type:         z.string().nullable(),
  severity:     z.string().nullable(),
  matchRate:    z.number().nullable(),
  matchCount:   z.number().int().nonnegative(),
  totalRuns:    z.number().int().nonnegative(),
  stubRuns:     z.number().int().nonnegative(),
});

const RecallReportSchema = z.object({
  summary:            RecallReportSummarySchema,
  runsWithDetails:    z.number().int().nonnegative(),
  runsWithoutDetails: z.number().int().nonnegative(),
  goldens:            z.array(RecallReportEntrySchema),
});

function parseCrbGoldenCommentDetails(data) {
  return CrbGoldenCommentSchema.parse(data);
}

function parseRecallReport(data) {
  return RecallReportSchema.parse(data);
}

module.exports = {
  CrbGoldenCommentSchema,
  RecallReportSummarySchema,
  RecallReportEntrySchema,
  RecallReportSchema,
  parseCrbGoldenCommentDetails,
  parseRecallReport,
};
