/** Persisted metadata written by the fix stage. */

import type { FixSuggestion } from './finding';

export interface FixMetadata {
  timestamp: string;
  issuesProcessed: number;
  suggestions: FixSuggestion[];
  summary: {
    totalSuggestions: number;
    highConfidence: number;
    mediumConfidence: number;
    lowConfidence: number;
    breaking: number;
    applied: number;
  };
}
