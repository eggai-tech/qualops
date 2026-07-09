/** Persisted metadata written by the analyze stage. */

export interface AnalysisMetadata {
  timestamp: string;
  filePaths: string[];
  dependencies?: Record<string, string[]>;
  executionTime?: number;
  gitRefs?: {
    base: string;
    head: string;
  };
}

/** File-hash log tracking which files have been processed. */
export interface ExtractLog {
  timestamp: string;
  files: Record<
    string,
    {
      hash: string;
      size: number;
      lastModified: string;
      processed: boolean;
    }
  >;
  [key: string]: unknown;
}
