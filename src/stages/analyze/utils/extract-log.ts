import { readFile } from 'node:fs/promises';

import { getCurrentSessionPaths } from '../../../shared/runtime/session-context.ts';
import { writeMetadataFile } from '../../../shared/utils/file-utils.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { calculateFileHash } from './hash-calculator.ts';

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
  [key: string]: unknown;
}

export { calculateFileHash } from './hash-calculator.ts';

export async function loadExtractLog(): Promise<ExtractLog> {
  try {
    const logPath = getCurrentSessionPaths().extractLog();
    const content = await readFile(logPath, 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      timestamp: new Date().toISOString(),
      files: {},
    };
  }
}

export async function saveExtractLog(log: ExtractLog): Promise<void> {
  await writeMetadataFile(getCurrentSessionPaths().extractLog(), log);
}

export async function shouldProcessFile(filePath: string, extractLog: Readonly<ExtractLog>): Promise<boolean> {
  const logEntry = extractLog.files[filePath];

  if (!logEntry || !logEntry.processed) {
    return true;
  }

  try {
    const currentHash = await calculateFileHash(filePath);
    return currentHash !== logEntry.hash;
  } catch {
    return true;
  }
}

const updateQueue = new Map<string, Promise<void>>();
export async function updateExtractLog(filePath: string, hash: string, size: number): Promise<void> {
  const logPath = getCurrentSessionPaths().extractLog();
  const previous = updateQueue.get(logPath) || Promise.resolve();
  const update = previous
    .then(async () => {
      const log = await loadExtractLog();
      log.files[filePath] = { hash, size, lastModified: new Date().toISOString(), processed: true };
      await saveExtractLog(log);
    })
    .finally(() => {
      if (updateQueue.get(logPath) === update) {
        updateQueue.delete(logPath);
      }
    });
  updateQueue.set(logPath, update);
  await update;
}

export async function getFilesToProcess(allFiles: string[], extractLog: Readonly<ExtractLog>): Promise<string[]> {
  const shouldProcessPromises = allFiles.map(async (file) => {
    const shouldProcess = await shouldProcessFile(file, extractLog);
    return { file, shouldProcess };
  });

  const results = await Promise.all(shouldProcessPromises);
  return results.filter((result) => result.shouldProcess).map((result) => result.file);
}

export async function updateFileInExtractLog(filePath: string, extractLog: ExtractLog): Promise<void> {
  try {
    const currentHash = await calculateFileHash(filePath);
    const { stat } = await import('node:fs/promises');
    const stats = await stat(filePath);

    extractLog.files[filePath] = {
      hash: currentHash,
      size: stats.size,
      lastModified: stats.mtime.toISOString(),
      processed: true,
    };
  } catch (error) {
    logger.warn(`Failed to update extract log for ${filePath}:`, error);
  }
}
