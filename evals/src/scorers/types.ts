'use strict';

export interface Issue {
  type?: string;
  severity?: string;
  description?: string;
  line?: number;
  lineEnd?: number;
  file?: string;
}

export interface Score {
  name: string;
  value: number | null;
  comment: string;
  metadata?: Record<string, unknown>;
}

export interface ScorerContext {
  referenceBugs?: Issue[];
  referenceExpected?: Issue[];
  source: string;
}

export type ScorerFn = (detected: Issue[], context: ScorerContext) => Promise<Score | null>;

export interface ScorerEntry {
  datasets: string[];
  fn: ScorerFn;
}
