import { shouldProcessFile } from '../../../shared/utils/filters.ts';
import { logger } from '../../../shared/utils/logger.ts';
import type { ExtractLog } from '../utils/extract-log.ts';
import { prepareFilesForProcessing } from './file-processor.ts';

export async function processBatchForAnalysis(
  files: string[],
  extractLog: ExtractLog,
  mode: 'files' | 'projects' | 'git',
): Promise<{ validFiles: string[]; skippedCount: number }> {
  let filteredFiles: string[];

  switch (mode) {
    case 'files':
      filteredFiles = files.filter((file) => file.endsWith('.ts') && shouldProcessFile(file));
      logger.info(`Analyzing ${filteredFiles.length} TypeScript files`);
      break;

    case 'projects':
      filteredFiles = files;
      logger.info(`Found ${filteredFiles.length} TypeScript files in specified projects`);
      break;

    case 'git':
      filteredFiles = files;
      logger.git(`Found ${filteredFiles.length} changed TypeScript files`);
      break;

    default:
      throw new Error(`Unknown analysis mode: ${mode}`);
  }

  if (filteredFiles.length === 0) {
    return { validFiles: [], skippedCount: 0 };
  }

  return await prepareFilesForProcessing(filteredFiles, extractLog);
}
