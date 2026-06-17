interface EnvironmentConfig {
  // Secrets
  anthropicApiKey?: string;
  openaiApiKey?: string;
  openaiBaseUrl?: string;
  awsRegion?: string;
  awsAccessKeyId?: string;
  awsSecretAccessKey?: string;
  githubApiKey?: string;

  // Feature Flags
  enableReAct?: boolean;
  skipCache?: boolean;
  debug?: boolean;
  verbose?: boolean;

  // Performance
  maxFiles?: number;
  maxFilesPerBatch?: number;
  timeoutSeconds?: number;

  // Quality Thresholds
  maxCritical?: number;
  maxHigh?: number;
  maxMedium?: number;
  maxLow?: number;
  failOnMedium?: boolean;
  failOnLow?: boolean;
  minQualityScore?: number;

  // Paths
  sessionsDir?: string;
  cacheDir?: string;

  // Node Environment
  nodeEnv?: string;

  // Additional configuration
  qualopsAiTemperature?: number;
  qualopsBaseBranch?: string;
  useConsolidatedReview?: boolean;
}

class EnvironmentConfigService {
  private static instance: EnvironmentConfigService;
  private config: EnvironmentConfig;
  private loaded = false;

  private constructor() {
    this.config = {};
    this.load();
  }

  static getInstance(): EnvironmentConfigService {
    if (!EnvironmentConfigService.instance) {
      EnvironmentConfigService.instance = new EnvironmentConfigService();
    }
    return EnvironmentConfigService.instance;
  }

  private load(): void {
    if (this.loaded) return;

    this.config = {
      // API Keys
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      openaiApiKey: process.env.OPENAI_API_KEY,
      openaiBaseUrl: process.env.OPENAI_BASE_URL,
      awsRegion: process.env.AWS_REGION,
      awsAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
      awsSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      githubApiKey: process.env.GITHUB_API_KEY,

      // Feature Flags
      enableReAct: process.env.QUALOPS_ENABLE_REACT === 'true',
      skipCache: process.env.QUALOPS_SKIP_CACHE === 'true',
      debug: process.env.DEBUG === 'true' || process.env.DEBUG?.includes('qualops'),
      verbose: process.env.VERBOSE === 'true' || process.env.QUALOPS_VERBOSE === 'true',

      // Performance
      maxFiles: process.env.QUALOPS_MAX_FILES ? parseInt(process.env.QUALOPS_MAX_FILES) : undefined,
      maxFilesPerBatch: process.env.QUALOPS_MAX_FILES_PER_BATCH
        ? parseInt(process.env.QUALOPS_MAX_FILES_PER_BATCH)
        : undefined,
      timeoutSeconds: process.env.QUALOPS_TIMEOUT_SECONDS
        ? parseInt(process.env.QUALOPS_TIMEOUT_SECONDS)
        : undefined,

      // Quality Thresholds
      maxCritical: process.env.QUALOPS_MAX_CRITICAL
        ? parseInt(process.env.QUALOPS_MAX_CRITICAL)
        : undefined,
      maxHigh: process.env.QUALOPS_MAX_HIGH ? parseInt(process.env.QUALOPS_MAX_HIGH) : undefined,
      maxMedium: process.env.QUALOPS_MAX_MEDIUM
        ? parseInt(process.env.QUALOPS_MAX_MEDIUM)
        : undefined,
      maxLow: process.env.QUALOPS_MAX_LOW ? parseInt(process.env.QUALOPS_MAX_LOW) : undefined,
      failOnMedium: process.env.QUALOPS_FAIL_ON_MEDIUM === 'true',
      failOnLow: process.env.QUALOPS_FAIL_ON_LOW === 'true',
      minQualityScore: process.env.QUALOPS_MIN_QUALITY_SCORE
        ? parseInt(process.env.QUALOPS_MIN_QUALITY_SCORE)
        : undefined,

      // Paths
      sessionsDir: process.env.QUALOPS_SESSIONS_DIR,
      cacheDir: process.env.QUALOPS_CACHE_DIR,

      // Node Environment
      nodeEnv: process.env.NODE_ENV,

      // Additional configuration
      qualopsAiTemperature: process.env.QUALOPS_AI_TEMPERATURE
        ? parseFloat(process.env.QUALOPS_AI_TEMPERATURE)
        : undefined,
      qualopsBaseBranch: process.env.QUALOPS_BASE_BRANCH,
      useConsolidatedReview: process.env.USE_CONSOLIDATED_REVIEW !== 'false',
    };

    this.loaded = true;
  }

  get<K extends keyof EnvironmentConfig>(key: K): EnvironmentConfig[K] {
    if (
      key === 'anthropicApiKey' &&
      !this.config.anthropicApiKey &&
      process.env.ANTHROPIC_API_KEY
    ) {
      this.config.anthropicApiKey = process.env.ANTHROPIC_API_KEY;
    }
    return this.config[key];
  }

  getAll(): EnvironmentConfig {
    return { ...this.config };
  }

  isProduction(): boolean {
    return this.config.nodeEnv === 'production';
  }

  isDevelopment(): boolean {
    return this.config.nodeEnv === 'development' || !this.config.nodeEnv;
  }

  isDebug(): boolean {
    return this.config.debug === true;
  }

  isVerbose(): boolean {
    return this.config.verbose === true;
  }
}

export const envConfig = EnvironmentConfigService.getInstance();
export type { EnvironmentConfig };
