/** Generic, domain-agnostic value shapes shared across the pipeline. */

export type FilePath = string;
export type SessionId = string;

export type FileContent = {
  path: FilePath;
  content: string;
  encoding?: string;
  size?: number;
};

export type CodeLocation = {
  file: FilePath;
  line: number;
  column?: number;
  endLine?: number;
  endColumn?: number;
};

export type CodeSnippet = CodeLocation & {
  code: string;
  language?: string;
};

export type Metrics = {
  duration: number;
  filesAnalyzed: number;
  issuesFound: number;
  fixesApplied: number;
  tokensUsed?: number;
  cacheHits?: number;
  cacheMisses?: number;
};
