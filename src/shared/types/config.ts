export interface ReviewConfig {
  minConfidence?: number;
  sessionBased?: boolean;
  maxFilesBeforeReset?: number;
  maxContextTokens?: number;
  maxConcurrentFiles?: number;
  validation?: ValidationConfig;
  deduplication?: DeduplicationConfig;
  pipeline: PipelineJob[];
}

export interface PipelineJob {
  name: string;
  enabled: boolean;
  validation?: ValidationConfig;
  deduplication?: DeduplicationConfig;
  passes: ReviewPass[];
}

export interface ReviewPass {
  name: string;
  enabled: boolean;
  docs?: string;
  prompt: string | PromptConfig;
  filters?: {
    detectionTriggers?: string[];
    filePatterns?: string[];
    excludePatterns?: string[];
  };
}

export interface PromptConfig {
  file: string;
  meta?: Record<string, any>;
}

export interface ValidationConfig {
  enabled?: boolean;
  minConfidence?: number;
  prompt?: string | PromptConfig;
}

export interface DeduplicationConfig {
  enabled?: boolean;
  prompt?: string | PromptConfig;
}

export interface FileInfo {
  path: string;
  content: string;
  framework?: string;
  diff?: {
    additions: Set<number>;
    deletions: Set<number>;
    modifications: Set<number>;
  };
}

export interface ReviewTask {
  file: FileInfo;
  pass: ReviewPass;
  job: PipelineJob;
}

export interface ProcessingContext {
  globalConfig: ReviewConfig;
  jobConfig: PipelineJob;
  passConfig: ReviewPass;
}
