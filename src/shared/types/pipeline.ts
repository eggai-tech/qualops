/** Pipeline stage identity and per-stage execution result. */

export type Stage = 'analyze' | 'review' | 'fix' | 'judge' | 'report';

export type StageResult = {
  stage: Stage;
  status: 'success' | 'failure' | 'skipped';
  duration: number;
  data?: unknown;
  error?: Error;
};
