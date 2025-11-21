import { writeMetadataFile } from './file-utils';
import { logger } from './logger';
import { CRITICAL_STAGES } from '../../config/config';
import { getCurrentSessionPaths } from '../runtime/session-context';

interface ErrorData {
  stage: string;
  operation: string;
  error: string;
  stack?: string;
  timestamp: string;
  duration: number;
}

export async function withErrorHandling<T>(
  stage: string,
  operation: string,
  fn: () => Promise<T>,
): Promise<{ success: boolean; result?: T }> {
  const startTime = Date.now();

  try {
    logger.info(`${stage}: Starting ${operation}`);
    const result = await fn();
    logger.info(`${stage}: Completed in ${Date.now() - startTime}ms`);
    return { success: true, result };
  } catch (error) {
    const errorData: ErrorData = {
      stage,
      operation,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      timestamp: new Date().toISOString(),
      duration: Date.now() - startTime,
    };

    logger.error(`${stage}: Failed - ${errorData.error}`);

    try {
      await writeMetadataFile(getCurrentSessionPaths().errorLog(stage), errorData);
    } catch {
      // Continue without metadata
    }

    if (CRITICAL_STAGES.includes(stage as (typeof CRITICAL_STAGES)[number])) {
      throw new Error(`Critical stage failed: ${stage}`);
    }

    return { success: false };
  }
}
