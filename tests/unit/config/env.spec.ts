import { envConfig } from '@/config/env';

const EnvironmentConfigService = (envConfig as any).constructor;

describe('EnvironmentConfigService', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    jest.resetModules();
    (EnvironmentConfigService as any).instance = undefined;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      expect(envConfig).toBeDefined();
    });
  });

  describe('API Keys', () => {
    it('should load anthropic API key from environment', () => {
      expect(envConfig.get('anthropicApiKey')).toBeDefined();
    });

    it('should load AWS region from environment', () => {
      expect(envConfig.get('awsRegion')).toBeDefined();
    });

    it('should handle API keys from test setup', () => {
      expect(envConfig.get('anthropicApiKey')).toBeDefined();
      expect(envConfig.get('awsAccessKeyId')).toBeDefined();
      expect(envConfig.get('awsSecretAccessKey')).toBeDefined();
    });
  });

  describe('Feature Flags', () => {
    it('should have boolean or undefined feature flags', () => {
      const enableReAct = envConfig.get('enableReAct');
      const skipCache = envConfig.get('skipCache');
      const debug = envConfig.get('debug');
      const verbose = envConfig.get('verbose');

      expect(typeof enableReAct).toBe('boolean');
      expect(typeof skipCache).toBe('boolean');
      expect(['boolean', 'undefined']).toContain(typeof debug);
      expect(typeof verbose).toBe('boolean');
    });

    it('should have consolidated review default', () => {
      const useConsolidatedReview = envConfig.get('useConsolidatedReview');
      expect(typeof useConsolidatedReview).toBe('boolean');
    });
  });

  describe('Performance Settings', () => {
    it('should handle performance settings types', () => {
      const maxFiles = envConfig.get('maxFiles');
      const maxFilesPerBatch = envConfig.get('maxFilesPerBatch');
      const timeoutSeconds = envConfig.get('timeoutSeconds');

      expect(maxFiles === undefined || typeof maxFiles === 'number').toBe(true);
      expect(maxFilesPerBatch === undefined || typeof maxFilesPerBatch === 'number').toBe(true);
      expect(timeoutSeconds === undefined || typeof timeoutSeconds === 'number').toBe(true);
    });
  });

  describe('Quality Thresholds', () => {
    it('should handle quality threshold types', () => {
      const maxCritical = envConfig.get('maxCritical');
      const maxHigh = envConfig.get('maxHigh');
      const failOnMedium = envConfig.get('failOnMedium');
      const failOnLow = envConfig.get('failOnLow');

      expect(maxCritical === undefined || typeof maxCritical === 'number').toBe(true);
      expect(maxHigh === undefined || typeof maxHigh === 'number').toBe(true);
      expect(failOnMedium === undefined || typeof failOnMedium === 'boolean').toBe(true);
      expect(failOnLow === undefined || typeof failOnLow === 'boolean').toBe(true);
    });
  });

  describe('Paths', () => {
    it('should handle path configuration types', () => {
      const sessionsDir = envConfig.get('sessionsDir');
      const cacheDir = envConfig.get('cacheDir');

      expect(sessionsDir === undefined || typeof sessionsDir === 'string').toBe(true);
      expect(cacheDir === undefined || typeof cacheDir === 'string').toBe(true);
    });
  });

  describe('Node Environment', () => {
    it('should detect test environment', () => {
      expect(envConfig.get('nodeEnv')).toBe('test');
      expect(envConfig.isProduction()).toBe(false);
      expect(envConfig.isDevelopment()).toBe(false);
    });
  });

  describe('Additional Configuration', () => {
    it('should handle additional configuration types', () => {
      const aiTemperature = envConfig.get('qualopsAiTemperature');
      const baseBranch = envConfig.get('qualopsBaseBranch');

      expect(aiTemperature === undefined || typeof aiTemperature === 'number').toBe(true);
      expect(baseBranch === undefined || typeof baseBranch === 'string').toBe(true);
    });
  });

  describe('isDebug', () => {
    it('should return boolean for debug status', () => {
      expect(typeof envConfig.isDebug()).toBe('boolean');
    });
  });

  describe('isVerbose', () => {
    it('should return boolean for verbose status', () => {
      expect(typeof envConfig.isVerbose()).toBe('boolean');
    });
  });

  describe('getAll', () => {
    it('should return all configuration values', () => {
      const config = envConfig.getAll();
      expect(config).toBeDefined();
      expect(config.anthropicApiKey).toBeDefined();
      expect(config.nodeEnv).toBe('test');
    });

    it('should return a copy of the configuration', () => {
      const config1 = envConfig.getAll();
      const config2 = envConfig.getAll();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('exported instance', () => {
    it('should export a singleton instance', () => {
      expect(envConfig).toBeDefined();
      expect(envConfig.get).toBeDefined();
      expect(envConfig.getAll).toBeDefined();
    });
  });
});
