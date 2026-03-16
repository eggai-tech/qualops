import type { ReviewIssue } from '../../../shared/types';
import type { AgenticConfig, AgenticSubagentType, FileInfo } from '../../../shared/types/config';

export interface AgenticReviewContext {
  files: FileInfo[];
  gitRefs?: { base: string; head: string };
  config: AgenticConfig;
  jobName: string;
}

export interface SubagentResult {
  subagentType: AgenticSubagentType;
  issues: ReviewIssue[];
  metadata: {
    filesAnalyzed: string[];
    duration: number;
    tokensUsed: number;
  };
}
