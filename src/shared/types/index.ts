import type { z } from 'zod';

import type { aiProvider, modelConfigSchema } from '@/config/config-schema';

import type { ReviewConfig } from './config';

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

export type AIProviderName = z.infer<typeof aiProvider>;

export type ModelConfig = z.infer<typeof modelConfigSchema>;

export type AIStageConfig = {
  provider?: AIProviderName; // deprecated fallback; prefer model: { provider, name }
  model: ModelConfig;
  inputPerMillion: number;
  outputPerMillion: number;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  [key: string]: unknown;
};

export type ResolvedStageConfig = {
  provider: AIProviderName;
  model: string;
  inputPerMillion: number;
  outputPerMillion: number;
  temperature?: number;
  maxTokens?: number;
  baseUrl?: string;
  [key: string]: unknown;
};

export type Config = {
  ai?: {
    reviewStage?: AIStageConfig;
    fixStage?: AIStageConfig;
    judgeStage?: AIStageConfig;
  };
  review?: ReviewConfig;
  fix?: {
    maxConcurrentFixes: number;
  };
  report?: {
    generateIssueMarkdown?: boolean;
    enableRootCauseExtraction?: boolean;
  };
  maxFilesPerBatch?: number;
  maxConcurrency?: number;
  cacheEnabled?: boolean;
  cacheTTL?: number;
  skipPatterns?: string[];
  includePatterns?: string[];
  outputFormat?: 'json' | 'html' | 'markdown';
  outputPath?: string;
  verbose?: boolean;
  debug?: boolean;
  maxFileSizeKB?: number;
  maxTokensPerFile?: number;
  maxReactSteps?: number;
  throttling?: {
    apiCallsPerMinute: number;
  };
};

// Framework context for AI analysis
export interface FrameworkContext {
  framework: 'angular' | 'react' | 'nodejs' | 'typescript';
  version?: string;
  dependencies: string[];
  fileType?: 'service' | 'component' | 'guard' | 'pipe' | 'directive';
}

// Types used by AI review system
export interface ReviewIssue {
  id: string;
  file: string;
  line?: number;
  type: 'bug' | 'security' | 'performance' | 'maintainability';
  severity: 'critical' | 'high' | 'medium' | 'low';
  category?: string;
  description: string;
  location: string;
  reasoning: string;
  suggestion: string;
  context: string;
  confidence: number;
  tags?: string[];
  priority?: number;
  estimatedEffort?: 'low' | 'medium' | 'high';
  knowledge_source?: string;
  impact?: string;
  cwe?: string;
  threat_model?: string;
  validation_reasoning?: string;
}

export interface FixSuggestion {
  issueId: string;
  file: string;
  line: number;
  originalCode: string;
  suggestedCode: string;
  explanation: string;
  confidence: 'high' | 'medium' | 'low';
  breaking: boolean;
  applied: boolean;
}

export type Stage = 'analyze' | 'review' | 'fix' | 'judge' | 'report';

export type StageResult = {
  stage: Stage;
  status: 'success' | 'failure' | 'skipped';
  duration: number;
  data?: unknown;
  error?: Error;
};

// Analysis stage types
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

// Extract log types
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
}

// Review stage types
export interface ReviewMetadata {
  timestamp: string;
  filesReviewed: number;
  projectsReviewed?: number;
  passed?: number;
  failed?: number;
  issues: ReviewIssue[];
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    byType: {
      bug: number;
      security: number;
      performance: number;
      maintainability: number;
    };
  };
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };
}

// Root Cause Extract stage types
export interface RootCauseTaxonomy {
  key: string;
  label: string;
  description: string;
  patterns: string[];
}

export interface RootCauseClassification {
  issueId: string;
  rootCause: string;
  confidence: number;
}

export interface RootCauseMetadata {
  timestamp: string;
  totalIssues: number;
  classifications: Record<string, RootCauseClassification>;
  taxonomy: RootCauseTaxonomy[];
  distribution?: Record<string, number>;
}

// Filter stage types
export interface FilterMetadata {
  timestamp: string;
  originalIssues: number;
  filteredIssues: number;
  keptIssues: ReviewIssue[];
  excludedIssues: Array<{
    issue: ReviewIssue;
    reason: string;
  }>;
  filterStats: {
    byConfidence: Record<number, number>;
    byExclusionType: Record<string, number>;
    falsePositiveRate: number;
  };
}

// Fix stage types
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

// Report stage types
export interface ReportSection {
  title: string;
  content: string;
}

export interface ReportMetadata {
  timestamp: string;
  summary: {
    filesAnalyzed: number;
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    fixSuggestions: number;
    qualityStatus: 'FAILED' | 'WARNING' | 'PASSED';
  };
  sections: ReportSection[];
  executionTime: number;
  stageResults: {
    analyze: boolean;
    review: boolean;
    filter?: boolean;
    fix: boolean;
  };
  markdownReport?: string;
  htmlReport?: string;
}

// Quality thresholds for judge stage
export interface QualityThresholds {
  minQualityScore?: number;
  maxCriticalIssues: number;
  maxHighIssues: number;
  maxMediumIssues?: number;
  maxLowIssues?: number;
  requireAllStages?: boolean;
  failOnMedium?: boolean;
  failOnLow?: boolean;
}

// Judge stage types
export interface JudgeMetadata {
  timestamp: string;
  passed: boolean;
  qualityScore?: number;
  qualityStatus: 'PASSED' | 'FAILED';
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  thresholds: QualityThresholds;
  reasons: string[];
  warnings?: string[];
  details?: string;
  detailedReport?: string;
  executionTime?: number;
}
