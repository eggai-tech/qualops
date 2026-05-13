import type { z } from 'zod';

import type {
  agenticConfigSchema,
  agenticSubagentTypeSchema,
  bashConfigSchema,
  customAgentDefinitionSchema,
  deduplicationConfigSchema,
  pipelineJobSchema,
  promptConfigSchema,
  reviewConfigSchema,
  reviewPassSchema,
  validationConfigSchema,
} from '../../config/config-schema';

// --- Config types derived from Zod schemas ---

export type ReviewMode = 'file-by-file' | 'agentic';
export type AgenticSubagentType = z.infer<typeof agenticSubagentTypeSchema>;

export type CustomAgentDefinition = z.infer<typeof customAgentDefinitionSchema>;
export type AgenticConfig = z.infer<typeof agenticConfigSchema>;
export type BashConfig = z.infer<typeof bashConfigSchema>;
export type ReviewConfig = z.infer<typeof reviewConfigSchema>;
export type PipelineJob = z.infer<typeof pipelineJobSchema>;
export type ReviewPass = z.infer<typeof reviewPassSchema>;
export type PromptConfig = z.infer<typeof promptConfigSchema>;
export type ValidationConfig = z.infer<typeof validationConfigSchema>;
export type DeduplicationConfig = z.infer<typeof deduplicationConfigSchema>;

// --- Domain types (kept as hand-written interfaces) ---

export interface FileInfo {
  path: string;
  content: string;
  framework?: string;
  diff?: {
    additions: Set<number>;
    deletions: Set<number>;
    modifications: Set<number>;
  };
  rawDiff?: string;
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
