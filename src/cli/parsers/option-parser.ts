export interface QualOpsOptions {
  config?: string;
  base: string;
  head?: string;
  stages?: string;
  files?: string;
  name?: string;
  reportRoot?: string;
  fixApply?: boolean;
  includeMedium?: boolean;
  skipCache?: boolean;
}

export interface ParsedStageOptions {
  stages: string[];
  sessionName: string;
}

export const STAGES = ['analyze', 'review', 'fix', 'report', 'judge'] as const;
export type Stage = (typeof STAGES)[number];

/**
 * Parses stage options from CLI input
 * Supports: comma-separated list, 'all', or single stage
 * Default: all stages
 */
export function parseStageOptions(options: QualOpsOptions): ParsedStageOptions {
  let stages: string[];

  if (options.stages) {
    const stagesInput = options.stages.trim();
    if (stagesInput === 'all') {
      stages = [...STAGES];
    } else {
      stages = stagesInput
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    }
  } else {
    stages = [...STAGES];
  }

  const sessionName = options.name || new Date().toISOString().slice(0, 19).replace(/[:-]/g, '').replace('T', '-');

  return {
    stages,
    sessionName,
  };
}

/**
 * Validates that all provided stages are valid
 */
export function validateStages(stages: string[]): Stage[] {
  const invalidStages = stages.filter((s) => !STAGES.includes(s as Stage));

  if (invalidStages.length > 0) {
    throw new Error(`Invalid stages: ${invalidStages.join(', ')}. Valid stages are: ${STAGES.join(', ')}`);
  }

  return stages as Stage[];
}
