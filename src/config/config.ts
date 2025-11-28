import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { envConfig } from './env';
import type { AIStageConfig, Config } from '../shared/types';
import { logger } from '../shared/utils/logger';

export const FILE_NAMES = {
  ANALYSIS: 'analysis.json',
  REVIEW_SUMMARY: 'review-summary.json',
  FIX_SUMMARY: 'fix-suggestions.json',
  OVERALL_REPORT: 'overall-report.json',
  ERROR_LOG: 'error-log.json',
} as const;

export const CRITICAL_STAGES = ['analyze', 'report'] as const;

export const CACHE_CONFIG = {
  VERSION: '1.0.0',
  MAX_ENTRIES: 10000,
  TTL_DAYS: 7,
} as const;

export const DEFAULT_CONFIG_PATH = '.qualops/.qualopsrc.json';

export class ConfigService {
  private static instance: ConfigService | undefined;
  private static configPath = DEFAULT_CONFIG_PATH;
  private config: Config;
  private rawConfig: Record<string, unknown>;
  private readonly defaultConfig: Config = {
    maxFilesPerBatch: 7,
    maxConcurrency: 3,
    cacheEnabled: true,
    cacheTTL: 1000 * 60 * 5,
    outputFormat: 'html',
    verbose: false,
    debug: envConfig.get('debug') || false,
    maxFileSizeKB: 500,
    maxTokensPerFile: 1000000,
    maxReactSteps: 5,
    skipPatterns: ['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**'],
  };

  private constructor() {
    this.rawConfig = this.loadRawConfig();
    this.config = this.loadConfig();
  }

  static setConfigPath(path: string): void {
    ConfigService.configPath = path;
    if (ConfigService.instance) {
      ConfigService.instance = undefined;
    }
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private loadRawConfig(): Record<string, unknown> {
    const rcPath = join(process.cwd(), ConfigService.configPath);
    if (!existsSync(rcPath)) {
      logger.warn(`Config file not found: ${rcPath}`);
      return {};
    }
    try {
      const content = readFileSync(rcPath, 'utf-8');
      logger.info(`Loaded config from: ${rcPath}`);
      return JSON.parse(content);
    } catch (error) {
      logger.warn(
        `Failed to parse ${rcPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return {};
    }
  }

  private loadConfig(): Config {
    const config = { ...this.defaultConfig };

    if (this.rawConfig.review) {
      config.review = this.rawConfig.review as Config['review'];
    }
    if (this.rawConfig.ai) {
      config.ai = this.rawConfig.ai as Config['ai'];
    }
    if (this.rawConfig.performance) {
      Object.assign(config, this.rawConfig.performance);
      if ((this.rawConfig.performance as Record<string, unknown>).throttling) {
        config.throttling = (this.rawConfig.performance as Record<string, unknown>)
          .throttling as Config['throttling'];
      }
    }
    if (this.rawConfig.fix) {
      config.fix = this.rawConfig.fix as Config['fix'];
    }
    if (this.rawConfig.report) {
      config.report = this.rawConfig.report as Config['report'];
    }

    const env = envConfig.getAll();

    if (env.maxFiles) {
      config.maxFilesPerBatch = env.maxFiles;
    }

    if (env.skipCache) {
      config.cacheEnabled = false;
    }

    if (envConfig.get('verbose')) {
      config.verbose = true;
    }

    return config;
  }

  get<K extends keyof Config>(key: K): Config[K] {
    return this.config[key];
  }

  set<K extends keyof Config>(key: K, value: Config[K]): void {
    this.config[key] = value;
  }

  getAll(): Config {
    return { ...this.config };
  }

  merge(partial: Partial<Config>): void {
    Object.assign(this.config, partial);
  }

  reset(): void {
    this.rawConfig = this.loadRawConfig();
    this.config = this.loadConfig();
  }

  isCacheEnabled(): boolean {
    return this.config.cacheEnabled ?? true;
  }

  isVerbose(): boolean {
    return this.config.verbose ?? envConfig.isVerbose();
  }

  isDebug(): boolean {
    return this.config.debug ?? envConfig.isDebug();
  }

  getAIStageConfig(stage: string): AIStageConfig {
    const stageKey = `${stage}Stage` as keyof NonNullable<Config['ai']>;
    const stageConfig = this.config.ai?.[stageKey];

    if (!stageConfig) {
      throw new Error(`AI configuration for stage "${stage}" not found in .qualopsrc.json`);
    }

    const required = ['provider', 'model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in stageConfig));

    if (missing.length > 0) {
      throw new Error(`Missing required AI config for stage "${stage}": ${missing.join(', ')}`);
    }

    return stageConfig;
  }

  getMaxFileSizeKB(): number {
    return this.config.maxFileSizeKB ?? 500;
  }

  getMaxTokensPerFile(): number {
    return this.config.maxTokensPerFile ?? 1000000;
  }

  getMaxReactSteps(): number {
    return this.config.maxReactSteps ?? 5;
  }

  isIssueMarkdownEnabled(): boolean {
    return this.config.report?.generateIssueMarkdown ?? false;
  }

  isRootCauseExtractionEnabled(): boolean {
    return this.config.report?.enableRootCauseExtraction ?? false;
  }

  validate(): string[] {
    const errors: string[] = [];

    if (!this.config.ai) {
      errors.push('AI configuration is required in .qualopsrc.json');
    }

    if (this.config.maxFilesPerBatch && this.config.maxFilesPerBatch < 1) {
      errors.push('maxFilesPerBatch must be at least 1');
    }

    return errors;
  }

  getDirectories() {
    const paths = this.rawConfig.paths as Record<string, unknown> | undefined;
    return {
      SESSIONS: (paths?.sessionsDir as string) ?? 'reports/sessions',
      CACHE: (paths?.cacheDir as string) ?? '.qualops-cache',
      OUTPUT: (paths?.outputDir as string) ?? 'reports',
    } as const;
  }

  getPerformanceLimits() {
    const perf = this.rawConfig.performance as Record<string, unknown> | undefined;
    return {
      maxFileSizeKB: (perf?.maxFileSizeKB as number) ?? this.config.maxFileSizeKB ?? 500,
      maxFilesPerBatch: (perf?.maxFilesPerBatch as number) ?? this.config.maxFilesPerBatch ?? 10,
      maxFilesPerProject: (perf?.maxFilesPerProject as number) ?? 10000,
      timeoutSeconds: (perf?.timeoutSeconds as number) ?? 300,
      maxTokensPerFile:
        (perf?.maxTokensPerFile as number) ?? this.config.maxTokensPerFile ?? 1000000,
      maxRetries: (perf?.maxRetries as number) ?? 2,
    } as const;
  }
}
