import { buildSessionPath } from '../../config/config.ts';
import { setCurrentSession } from '../../shared/runtime/session-context.ts';
import { getDefaultReportRoot } from '../../shared/utils/report-root.ts';
import { validateAndProcessStages } from './argument-validator.ts';
import { parseFilePatterns } from './file-parser.ts';
import { parseStageOptions, type QualOpsOptions } from './option-parser.ts';

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
  const stages = validateAndProcessStages(rawStages);

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
