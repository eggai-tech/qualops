import { logger } from '../../shared/utils/logger.ts';

export function handleError(error: unknown, context?: string): never {
  const contextMsg = context ? `${context}: ` : '';

  if (error instanceof Error) {
    logger.error(`${contextMsg}${error.message}`);
    if (error.stack) {
      logger.error('Stack trace:', error.stack);
    }
  } else {
    logger.error(`${contextMsg}Unknown error:`, error);
  }

  process.exit(1);
}

export function handleStageError(stage: string, error: unknown): never {
  logger.error(`${stage} failed:`, error instanceof Error ? error.message : error);
  if (error instanceof Error && error.stack) {
    logger.error('Stack trace:', error.stack);
  }
  process.exit(1);
}

export function withErrorHandling<T extends unknown[], R>(
  fn: (...args: T) => Promise<R>,
  context?: string,
): (...args: T) => Promise<R> {
  return async (...args: T): Promise<R> => {
    try {
      return await fn(...args);
    } catch (error) {
      handleError(error, context);
    }
  };
}
