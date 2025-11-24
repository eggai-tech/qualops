import { existsSync } from 'node:fs';

import globPkg from 'glob';

import { ConfigService } from '../../config/config';
import { logger } from '../../shared/utils/logger';

const { glob } = globPkg;

export async function parseFilePatterns(fileOption: string): Promise<string[]> {
  if (!fileOption || fileOption.trim() === '') {
    return [];
  }

  const patterns = fileOption
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const allFiles: string[] = [];

  const config = ConfigService.getInstance();
  const ignorePatterns = config.get('skipPatterns') || [];

  for (const pattern of patterns) {
    if (pattern.includes('*') || pattern.includes('{') || pattern.includes('?')) {
      try {
        const matches = await glob(pattern, {
          nodir: true,
          ignore: ignorePatterns,
        });

        if (matches.length === 0) {
          logger.warn(`No files found matching pattern: ${pattern}`);
        } else {
          logger.debug(`Found ${matches.length} files matching pattern: ${pattern}`);
          allFiles.push(...matches);
        }
      } catch (error) {
        logger.warn(`Invalid glob pattern '${pattern}': ${error.message}`);
      }
    } else {
      if (existsSync(pattern)) {
        allFiles.push(pattern);
      } else {
        logger.warn(`File does not exist: ${pattern}`);
      }
    }
  }

  return [...new Set(allFiles)];
}
