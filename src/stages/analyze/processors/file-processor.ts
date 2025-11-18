import { stat } from 'node:fs/promises';

import { logger } from '../../../shared/utils/logger.ts';
import { calculateFileHash, type ExtractLog } from '../utils/extract-log.ts';

export async function processFile(file: string, extractLog: ExtractLog): Promise<boolean> {
  try {
    const stats = await stat(file);
    const hash = await calculateFileHash(file);

    extractLog.files[file] = {
      hash,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      processed: false,
    };

    return true;
  } catch (error) {
    logger.warn(`Failed to process file ${file}:`, error.message);
    return false;
  }
}

export async function prepareFilesForProcessing(
  files: string[],
  extractLog: ExtractLog,
): Promise<{ validFiles: string[]; skippedCount: number }> {
  const validFiles: string[] = [];
  let skippedCount = 0;

  for (const file of files) {
    const success = await processFile(file, extractLog);
    if (success) {
      validFiles.push(file);
    } else {
      skippedCount++;
    }
  }

  return { validFiles, skippedCount };
}
