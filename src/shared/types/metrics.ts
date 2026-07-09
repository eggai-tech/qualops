/** Aggregate metrics for a single pipeline run. */
export type Metrics = {
  duration: number;
  filesAnalyzed: number;
  issuesFound: number;
  fixesApplied: number;
  tokensUsed?: number;
  cacheHits?: number;
  cacheMisses?: number;
};
