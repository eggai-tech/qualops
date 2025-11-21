import { ConfigService } from '../../../config/config';
import type { PipelineJob, ReviewConfig, ReviewPass } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

export class ConfigLoader {
  private static instance: ConfigLoader | null = null;
  private config: ReviewConfig | null = null;

   
  private constructor() {}

  static getInstance(): ConfigLoader {
    if (!ConfigLoader.instance) {
      ConfigLoader.instance = new ConfigLoader();
    }
    return ConfigLoader.instance;
  }

  load(): ReviewConfig {
    if (this.config) {
      return this.config;
    }

    const rawConfig = ConfigService.getInstance().getAll();

    if (!rawConfig.review) {
      throw new Error('No review configuration found in .qualopsrc.json');
    }

    this.config = rawConfig.review as ReviewConfig;
    this.validate(this.config);

    logger.info(`Loaded review config with ${this.config.pipeline.length} pipeline jobs`);

    return this.config;
  }

  private validate(config: ReviewConfig): void {
    if (!config.pipeline || !Array.isArray(config.pipeline)) {
      throw new Error('review.pipeline must be an array');
    }

    for (const job of config.pipeline) {
      if (!job.name) {
        throw new Error('Pipeline job must have a name');
      }

      if (!job.passes || !Array.isArray(job.passes)) {
        throw new Error(`Pipeline job "${job.name}" must have passes array`);
      }

      for (const pass of job.passes) {
        if (!pass.name) {
          throw new Error(`Pass in job "${job.name}" must have a name`);
        }

        if (!pass.prompt) {
          throw new Error(`Pass "${pass.name}" must have a prompt`);
        }

        if (typeof pass.prompt !== 'string' && typeof pass.prompt !== 'object') {
          throw new Error(`Pass "${pass.name}" prompt must be string or object`);
        }

        if (typeof pass.prompt === 'object' && !pass.prompt.file) {
          throw new Error(`Pass "${pass.name}" prompt object must have "file" property`);
        }
      }
    }
  }

  getEnabledJobs(): Array<{ job: PipelineJob; passes: ReviewPass[] }> {
    const config = this.load();

    return config.pipeline
      .filter((job) => job.enabled !== false)
      .map((job) => ({
        job,
        passes: job.passes.filter((pass) => pass.enabled !== false),
      }))
      .filter((item) => item.passes.length > 0);
  }

  reset(): void {
    this.config = null;
  }
}
