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

export interface DependencyTrace {
  filePath: string;
  imports: string[];
  importedBy: string[];
  exports: string[];
}

export interface BreakingChangeResult {
  file: string;
  changeType: 'api-signature' | 'interface-change' | 'export-removal' | 'behavior-change';
  description: string;
  affectedFiles: string[];
  severity: 'critical' | 'high' | 'medium';
}

export interface ExportComparison {
  added: string[];
  removed: string[];
  modified: string[];
}

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}
