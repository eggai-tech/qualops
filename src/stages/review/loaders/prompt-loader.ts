import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { PromptConfig } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

const PROMPTS_BASE_PATH = join(process.cwd(), '.qualops/prompts');

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

    const fullPath = join(PROMPTS_BASE_PATH, promptPath);

    try {
      const content = await readFile(fullPath, 'utf-8');
      this.cache.set(promptPath, content);
      logger.debug(`[PromptLoader] Loaded: ${promptPath}`);
      return content;
    } catch (error) {
      throw new Error(`Failed to load prompt: ${promptPath} (${fullPath}): ${error}`);
    }
  }

  static clearCache(): void {
    this.cache.clear();
  }
}
