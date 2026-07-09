/** Report-stage display constants. */

/**
 * Confidence-score (1–10 scale) cutoffs for the report's High/Medium/Low
 * confidence badges. Display-only bucketing — not a gating threshold.
 */
export const CONFIDENCE_DISPLAY_THRESHOLDS = {
  HIGH: 8,
  MEDIUM: 6,
} as const;
