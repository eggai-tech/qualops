import { minimatch } from 'minimatch';

import type { FileInfo, ReviewPass } from '../../../shared/types/config.ts';
import { logger } from '../../../shared/utils/logger.ts';

export class FilterMatcher {
  static shouldReview(file: FileInfo, pass: ReviewPass): boolean {
    const filters = pass.filters;

    if (!filters) {
      return true;
    }

    if (filters.filePatterns && filters.filePatterns.length > 0) {
      const matchesPattern = filters.filePatterns.some((pattern) => minimatch(file.path, pattern));

      if (!matchesPattern) {
        logger.debug(`[FilterMatcher] File ${file.path} doesn't match filePatterns for pass "${pass.name}"`);
        return false;
      }
    }

    if (filters.excludePatterns && filters.excludePatterns.length > 0) {
      const matchesExclude = filters.excludePatterns.some((pattern) => minimatch(file.path, pattern));

      if (matchesExclude) {
        logger.debug(`[FilterMatcher] File ${file.path} excluded by excludePatterns for pass "${pass.name}"`);
        return false;
      }
    }

    if (filters.detectionTriggers && filters.detectionTriggers.length > 0) {
      const matchesTrigger = filters.detectionTriggers.some((pattern) => {
        try {
          const regex = new RegExp(pattern);
          return regex.test(file.content);
        } catch {
          logger.warn(`[FilterMatcher] Invalid regex pattern: ${pattern}`);
          return false;
        }
      });

      if (!matchesTrigger) {
        logger.debug(`[FilterMatcher] File ${file.path} doesn't match detectionTriggers for pass "${pass.name}"`);
        return false;
      }
    }

    return true;
  }
}
