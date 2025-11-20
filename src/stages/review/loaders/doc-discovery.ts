import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { logger } from '../../../shared/utils/logger';

const DOCS_BASE_PATH = join(process.cwd(), '.qualops/docs');

export class DocDiscovery {
  static async discover(docRef: string): Promise<string[]> {
    logger.debug(`[DocDiscovery] Looking for docs: ${docRef}`);

    const splits = await this.findSplits(docRef);

    if (splits.length > 0) {
      logger.info(`[DocDiscovery] Found ${splits.length} splits for "${docRef}"`);
      return splits;
    }

    const singleFile = join(DOCS_BASE_PATH, `${docRef}.md`);

    try {
      await stat(singleFile);
      logger.info(`[DocDiscovery] Found single doc for "${docRef}"`);
      return [singleFile];
    } catch {
      throw new Error(`Documentation not found: ${docRef} (checked ${DOCS_BASE_PATH})`);
    }
  }

  private static async findSplits(docRef: string): Promise<string[]> {
    const splitPattern = new RegExp(`^${this.escapeRegex(docRef)}-(\\d+)\\.md$`);

    let files: string[];
    try {
      files = await readdir(DOCS_BASE_PATH);
    } catch {
      logger.warn(`[DocDiscovery] Cannot read docs directory: ${DOCS_BASE_PATH}`);
      return [];
    }

    const matchedFiles = files
      .filter((file) => splitPattern.test(file))
      .map((file) => {
        const match = file.match(splitPattern);
        const index = match ? parseInt(match[1], 10) : 0;
        return { file, index };
      })
      .sort((a, b) => a.index - b.index)
      .map((item) => join(DOCS_BASE_PATH, item.file));

    return matchedFiles;
  }

  private static escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}
