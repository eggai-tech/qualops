import { prepareFilesForProcessing } from './file-processor';
import { ConfigService } from '../../../config/config';
import { shouldProcessFile } from '../../../shared/utils/filters';
import { logger } from '../../../shared/utils/logger';
import type { ExtractLog } from '../utils/extract-log';

export async function processBatchForAnalysis(
  files: string[],
  extractLog: ExtractLog,
  mode: 'files' | 'projects' | 'git',
): Promise<{ validFiles: string[]; skippedCount: number }> {
  let filteredFiles: string[];

  switch (mode) {
    case 'files': {
      const skipPatterns = ConfigService.getInstance().get('skipPatterns') ?? [];
      filteredFiles = files.filter((f) => shouldProcessFile(f, skipPatterns));
      logger.info(`Analyzing ${filteredFiles.length} files`);
      break;
    }

    case 'projects':
      filteredFiles = files;
      logger.info(`Found ${filteredFiles.length} files in specified projects`);
      break;

    case 'git':
      filteredFiles = files;
      logger.git(`Found ${filteredFiles.length} changed files`);
      break;

    default:
      throw new Error(`Unknown analysis mode: ${mode}`);
  }

  if (filteredFiles.length === 0) {
    return { validFiles: [], skippedCount: 0 };
  }

  return await prepareFilesForProcessing(filteredFiles, extractLog);
}
