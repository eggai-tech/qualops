export interface ExpectedIssue {
  line: number;
  lineEnd?: number;
  type: 'security' | 'performance' | 'bug' | 'maintainability';
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  description: string;
}

export interface EvalCase {
  id: string;
  language: string;
  filePath: string;
  diff: string;
  fullContent: string;
  expected: ExpectedIssue[];
}

export interface DetectedIssue {
  file: string;
  line: number;
  lineEnd?: number;
  type: string;
  severity: string;
  description: string;
  confidence: number;
}

export interface ReviewResult {
  issues: DetectedIssue[];
  durationMs: number;
  tokenUsage?: { input: number; output: number };
}

export interface EvalConfig {
  name: string;
  model: string;
  mode: 'file-by-file' | 'agentic' | 'pipeline';
  provider?: 'anthropic' | 'openai' | 'bedrock';
}

export interface JudgeResult {
  avg: number;
  mode: 'dual' | 'single';
  judges: string[];
  disagreements: number;
}

export interface Scores {
  coverage: number;
  precision: number;
  lineIoU: number;
  severityAccuracy: number;
  judgeAvg: number;
  judgeMode: 'dual' | 'single';
}

export interface ConfigResult {
  scores: Scores;
  perCase: Record<string, Scores>;
  lastRunAt: string;
  datasetVersion: string;
  casesRun: number;
  judgeInfo: {
    mode: 'dual' | 'single';
    judges: string[];
    totalDisagreements: number;
    fallbackReason?: string;
  };
}

export interface Leaderboard {
  [configName: string]: ConfigResult;
}
