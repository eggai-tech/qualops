/** AI provider, model, and per-stage/overall configuration shapes. */

import type { z } from 'zod';

import type { aiProvider, modelConfigSchema } from '@/config/config-schema';

import type { ReviewConfig } from './config';

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
