import { readFile } from 'node:fs/promises';

import { resolvePromptPath, ALL_PROMPT_SEARCH_PATHS } from './search-paths';
import type { PromptConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

interface LoadedPrompt {
  content: string;
  meta?: Record<string, any>;
}

export class PromptLoader {
  private static cache = new Map<string, string>();

  static async load(promptRef: string | PromptConfig): Promise<LoadedPrompt> {
    if (typeof promptRef === 'string') {
      const content = await this.loadFile(promptRef);
      return { content, meta: undefined };
    }

    const content = await this.loadFile(promptRef.file);
    return { content, meta: promptRef.meta };
  }

  private static async loadFile(promptPath: string): Promise<string> {
    const cached = this.cache.get(promptPath);
    if (cached) {
      return cached;
    }

    const fullPath = resolvePromptPath(promptPath);
    if (!fullPath) {
      throw new Error(
        `Failed to load prompt: ${promptPath} (searched: ${ALL_PROMPT_SEARCH_PATHS.join(', ')})`,
      );
    }

    try {
      const content = await readFile(fullPath, 'utf-8');
      this.cache.set(promptPath, content);
      logger.debug(`[PromptLoader] Loaded prompt: ${promptPath}`);
      return content;
    } catch {
      throw new Error(
        `Failed to load prompt: ${promptPath} (searched: ${ALL_PROMPT_SEARCH_PATHS.join(', ')})`,
      );
    }
  }

  static clearCache(): void {
    this.cache.clear();
  }
}
