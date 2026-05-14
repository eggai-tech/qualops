import { validateAndProcessStages } from './argument-validator';
import { parseFilePatterns } from './file-parser';
import { parseStageOptions, type QualOpsOptions } from './option-parser';
import { buildSessionPath } from '../../config/buildSessionPath';
import { ConfigService } from '../../config/config';
import { setCurrentSession } from '../../shared/runtime/session-context';
import { logger } from '../../shared/utils/logger';
import { getDefaultReportRoot } from '../../shared/utils/report-root';

export interface MergedConfig {
  stages: string[];
  sessionName: string;
  sessionPath: ReturnType<typeof buildSessionPath>;
  metadata: {
    sessionName: string;
    files: string[];
    base: string;
    timestamp: string;
  };
}

export async function mergeConfiguration(options: QualOpsOptions): Promise<MergedConfig> {
  // Parse and validate stage options
  const { stages: rawStages, sessionName } = parseStageOptions(options);
  let stages = validateAndProcessStages(rawStages);

  // Drop 'fix' from the default run when no fixStage AI config is present.
  // Users can still opt in explicitly with --stages fix or --stages all.
  if (!options.stages && stages.includes('fix')) {
    const fixConfigured = !!ConfigService.getInstance().get('ai')?.fixStage;
    if (!fixConfigured) {
      logger.info(
        'Skipping fix stage: no fixStage AI config. Use --stages fix to run it explicitly.',
      );
      stages = stages.filter((s) => s !== 'fix');
    }
  }

  const reportRoot = options.reportRoot || getDefaultReportRoot();

  // Set up session context
  setCurrentSession(sessionName, reportRoot);
  const sessionPath = buildSessionPath(sessionName, reportRoot);

  // Parse file patterns if provided
  const files = options.files ? await parseFilePatterns(options.files) : [];

  // Build metadata for this session
  const metadata = {
    sessionName,
    files,
    base: options.base,
    timestamp: new Date().toISOString(),
  };

  return {
    stages,
    sessionName,
    sessionPath,
    metadata,
  };
}
