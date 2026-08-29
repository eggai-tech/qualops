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
