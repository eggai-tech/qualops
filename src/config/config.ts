import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { envConfig } from './env';
import { ConfigParseError, assertValidConfig, collectConfigWarnings } from './schema-validator';
import type {
  AIProviderName,
  AIStageConfig,
  Config,
  ModelConfig,
  ResolvedStageConfig,
} from '../shared/types';
import type { AgenticConfig } from '../shared/types/config';
import { logger } from '../shared/utils/logger';
import { assertHttpUrl } from '../shared/utils/security';

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

export const PROVIDER_DEFAULTS: Record<
  'anthropic' | 'openai' | 'bedrock',
  { model: string; inputPerMillion: number; outputPerMillion: number }
> = {
  anthropic: { model: 'claude-sonnet-4-6', inputPerMillion: 3, outputPerMillion: 15 },
  openai: { model: 'gpt-4.1', inputPerMillion: 2, outputPerMillion: 8 },
  bedrock: {
    model: 'us.anthropic.claude-sonnet-4-6-v1:0',
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
};

/**
 * Detects the AI provider from environment variables.
 * Priority: ANTHROPIC_API_KEY > OPENAI_API_KEY > undefined.
 */
export function detectProvider(): 'anthropic' | 'openai' | undefined {
  const env = envConfig.getAll();
  if (env.anthropicApiKey) return 'anthropic';
  if (env.openaiApiKey) return 'openai';
  return undefined;
}

/**
 * Returns the default model name for a given provider.
 * Falls back to the anthropic default when the provider is unknown.
 */
export function defaultModelForProvider(provider: string | undefined): string {
  return (
    PROVIDER_DEFAULTS[provider as keyof typeof PROVIDER_DEFAULTS]?.model ??
    PROVIDER_DEFAULTS.anthropic.model
  );
}

export class ConfigService {
  private static instance: ConfigService | undefined;
  private static configPath = DEFAULT_CONFIG_PATH;
  private static readonly DEFAULT_PROVIDER = 'anthropic';
  private config: Config;
  private rawConfig: Record<string, unknown>;

  /**
   * Resolves the default AI stage config from environment variables.
   * Priority: ANTHROPIC_API_KEY > OPENAI_API_KEY > undefined (no default).
   * When undefined, getAIStageConfig throws a clear error at runtime.
   */
  private static resolveDefaultAI(): Config['ai'] | undefined {
    const provider = detectProvider();
    if (!provider) return undefined;
    const d = PROVIDER_DEFAULTS[provider];
    return {
      reviewStage: {
        provider,
        model: d.model,
        inputPerMillion: d.inputPerMillion,
        outputPerMillion: d.outputPerMillion,
      },
    };
  }

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
    skipPatterns: ['.git/**'],
    ai: ConfigService.resolveDefaultAI(),
    review: {
      pipeline: [
        {
          name: 'codeQuality',
          enabled: true,
          mode: 'agentic',
        },
      ],
    },
  };

  private constructor() {
    this.rawConfig = this.loadRawConfig();
    this.validateAgainstSchema();
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
    const content = readFileSync(rcPath, 'utf-8');
    logger.info(`Loaded config from: ${rcPath}`);
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new ConfigParseError(rcPath, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private validateAgainstSchema(): void {
    if (Object.keys(this.rawConfig).length === 0) return;

    // Never call process.exit from this service — let the CLI error handler format and exit.
    assertValidConfig(this.rawConfig);

    const warnings = collectConfigWarnings(this.rawConfig);
    for (const dep of warnings.deprecations) {
      logger.warn(`[CONFIG] Deprecated field "${dep.path}": ${dep.description}`);
    }
    for (const unknown of warnings.unknownFields) {
      logger.warn(
        `[CONFIG] Unknown field "${unknown.field}" at ${unknown.path} — ignored. ` +
          `If this is a provider-specific option it will still be passed through; otherwise check for a typo.`,
      );
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
    if (this.rawConfig.skipPatterns) {
      config.skipPatterns = this.rawConfig.skipPatterns as string[];
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
    this.validateAgainstSchema();
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

  /**
   * Resolves the effective provider and model name. `model` overrides `stage`;
   * both fall back to defaults.
   */
  resolveModel({ stage, model }: { stage?: AIStageConfig; model?: ModelConfig } = {}): {
    provider: AIProviderName;
    model: string;
  } {
    return {
      provider: this.resolveProvider(stage, model),
      model: this.resolveModelName(stage, model),
    };
  }

  private resolveProvider(stage?: AIStageConfig, model?: ModelConfig): AIProviderName {
    if (model !== undefined && model !== null && typeof model === 'object' && model.provider) {
      return model.provider;
    }
    const stageModel = stage?.model;
    if (stageModel && typeof stageModel === 'object' && stageModel.provider) {
      return stageModel.provider;
    }
    return stage?.provider ?? ConfigService.DEFAULT_PROVIDER;
  }

  private resolveModelName(stage?: AIStageConfig, model?: ModelConfig): string {
    if (model !== undefined && model !== null) {
      return typeof model === 'string' ? model : model.name;
    }
    if (stage) {
      const stageModel = stage.model;
      return typeof stageModel === 'string' ? stageModel : stageModel.name;
    }
    return defaultModelForProvider(this.resolveProvider(stage, model));
  }

  /**
   * Resolves the effective provider and model for a named agent, applying
   * per-agent overrides from the agentic config before falling back to the
   * stage config and finally the global defaults.
   */
  resolveAgentModel(
    agentName: string,
    agenticConfig: AgenticConfig,
    stageConfig?: AIStageConfig,
  ): { provider: string; model: string } {
    const subagentOverride = (agenticConfig.enabledSubagents ?? []).find(
      (e) => typeof e === 'object' && e.name === agentName,
    );
    const customAgent = (agenticConfig.customAgents ?? []).find((c) => c.name === agentName);
    const model =
      (typeof subagentOverride === 'object' ? subagentOverride.model : undefined) ??
      customAgent?.model;

    return this.resolveModel({ model, stage: stageConfig });
  }

  getAIStageConfig(stage: string): AIStageConfig {
    const stageKey = `${stage}Stage` as keyof NonNullable<Config['ai']>;
    const stageConfig = this.config.ai?.[stageKey];

    const hasConfigFile = Object.keys(this.rawConfig).length > 0;

    if (!this.config.ai) {
      throw new Error(
        `No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY, or add an "ai" section to .qualopsrc.json`,
      );
    }

    if (!stageConfig) {
      throw new Error(
        hasConfigFile
          ? `AI configuration for stage "${stage}" not found in .qualopsrc.json`
          : `Stage "${stage}" requires explicit AI configuration. Add a "${stage}Stage" section under "ai" in .qualopsrc.json`,
      );
    }

    const required = ['model', 'inputPerMillion', 'outputPerMillion'];
    const missing = required.filter((key) => !(key in stageConfig));

    if (missing.length > 0) {
      throw new Error(`Missing required AI config for stage "${stage}": ${missing.join(', ')}`);
    }

    return stageConfig;
  }

  getResolvedStageConfig(stage: string): ResolvedStageConfig {
    const raw = this.getAIStageConfig(stage);
    const { provider, model } = this.resolveModel({ stage: raw });
    const credentials = this.resolveCredentials(provider, raw);
    return { ...raw, provider, model, ...credentials };
  }

  private resolveCredentials(
    provider: AIProviderName,
    raw: AIStageConfig,
  ): { baseUrl?: string; apiKey?: string } {
    if (provider === 'openai-compatible') {
      const baseUrl = raw.baseUrl ?? envConfig.get('openaiBaseUrl');
      if (baseUrl) assertHttpUrl(baseUrl);
      return { baseUrl };
    }
    return {
      ...(raw.baseUrl !== undefined && { baseUrl: raw.baseUrl }),
    };
  }

  /**
   * Maps a resolved provider name to the agent adapter type to use.
   * Returns `undefined` for providers that do not yet support agentic mode.
   */
  resolveAgentAdapterType(
    provider: AIProviderName,
  ): 'anthropic' | 'openai' | 'openai-compatible' | undefined {
    const mapping: Partial<Record<AIProviderName, 'anthropic' | 'openai' | 'openai-compatible'>> = {
      anthropic: 'anthropic',
      openai: 'openai',
      github: 'openai', // GitHub Models uses an OpenAI-compatible API
      'openai-compatible': 'openai-compatible',
    };
    return mapping[provider];
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
}
