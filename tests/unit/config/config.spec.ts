import { existsSync, readFileSync } from 'node:fs';

interface MockEnvConfig {
  get: jest.Mock<string | boolean | undefined, [string]>;
  getAll: jest.Mock<Record<string, unknown>, []>;
  isVerbose: jest.Mock<boolean, []>;
  isDebug: jest.Mock<boolean, []>;
}

jest.mock('@/config/env', () => ({
  envConfig: {
    get: jest.fn((key: string) => {
      if (key === 'reactReview') return undefined;
      if (key === 'multiPassReview') return undefined;
      if (key === 'debug') return false;
      if (key === 'verbose') return false;
      return undefined;
    }),
    getAll: jest.fn(() => ({
      anthropicApiKey: 'test-key',
      awsRegion: 'us-east-1',
      debug: false,
      verbose: false,
    })),
    isVerbose: jest.fn(() => false),
    isDebug: jest.fn(() => false),
  } as MockEnvConfig,
}));
jest.mock('node:fs');
jest.mock('@/shared/utils/logger');

const mockExistsSync = existsSync as jest.MockedFunction<typeof existsSync>;
const mockReadFileSync = readFileSync as jest.MockedFunction<typeof readFileSync>;

import { CACHE_CONFIG, ConfigService, CRITICAL_STAGES, FILE_NAMES } from '@/config/config';
import { envConfig } from '@/config/env';
import type { Config } from '@/shared/types';

const mockEnvConfig = envConfig as jest.Mocked<typeof envConfig>;

describe('ConfigService', () => {
  let originalCwd: string;

  beforeEach(() => {
    jest.clearAllMocks();
    originalCwd = process.cwd();
    (ConfigService as unknown as { instance: undefined }).instance = undefined;

    mockEnvConfig.get = jest.fn((key: string) => {
      if (key === 'reactReview') return undefined;
      if (key === 'multiPassReview') return undefined;
      if (key === 'debug') return false;
      if (key === 'verbose') return false;
      return undefined;
    }) as any;
    mockEnvConfig.getAll = jest.fn(() => ({
      anthropicApiKey: 'test-key',
      awsRegion: 'us-east-1',
      debug: false,
      verbose: false,
    }));
    mockEnvConfig.isVerbose = jest.fn(() => false);
    mockEnvConfig.isDebug = jest.fn(() => false);
    mockExistsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = ConfigService.getInstance();
      const instance2 = ConfigService.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('default configuration', () => {
    it('should initialize with default configuration', () => {
      const instance = ConfigService.getInstance();
      expect(instance.get('maxFilesPerBatch')).toBe(7);
      expect(instance.get('maxConcurrency')).toBe(3);
      expect(instance.get('cacheEnabled')).toBe(true);
      expect(instance.get('cacheTTL')).toBe(1000 * 60 * 5);
      expect(instance.get('outputFormat')).toBe('html');
      expect(instance.get('verbose')).toBe(false);
      expect(instance.get('maxFileSizeKB')).toBe(500);
      expect(instance.get('maxTokensPerFile')).toBe(1000000);
      expect(instance.get('maxReactSteps')).toBe(5);
    });

    it('should initialize with default skip patterns', () => {
      const instance = ConfigService.getInstance();
      const skipPatterns = instance.get('skipPatterns');
      expect(skipPatterns).toEqual(['node_modules/**', '.git/**', 'dist/**', 'build/**', 'coverage/**']);
    });

    it('should set reactReview based on environment', () => {
      mockEnvConfig.get = jest.fn((key: any) => {
        if (key === 'reactReview') return true;
        return undefined;
      }) as any;
      const instance = ConfigService.getInstance();
      expect(instance.get('reactReview')).toBe(true);
    });

    it('should set multiPassReview to true by default', () => {
      const instance = ConfigService.getInstance();
      expect(instance.get('multiPassReview')).toBe(true);
    });

    it('should set debug based on environment', () => {
      mockEnvConfig.get = jest.fn((key: any) => {
        if (key === 'debug') return true;
        return undefined;
      }) as any;
      const instance = ConfigService.getInstance();
      expect(instance.get('debug')).toBe(true);
    });
  });

  describe('loadConfig', () => {
    it('should load configuration from .qualopsrc.json', () => {
      const rcConfig = {
        review: { maxConcurrentFiles: 10 },
        ai: { reviewStage: { provider: 'openai', model: 'gpt-4' } },
        performance: { maxFileSizeKB: 1000 },
        filter: { minConfidence: 0.8 },
        fix: { maxConcurrentFixes: 5 },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      expect(instance.get('review')).toEqual(rcConfig.review);

      expect(instance.get('ai')).toEqual(rcConfig.ai);
      expect(instance.get('filter')).toEqual(rcConfig.filter);
      expect(instance.get('fix')).toEqual(rcConfig.fix);
      expect(instance.get('maxFileSizeKB')).toBe(1000);
    });

    it('should handle throttling configuration', () => {
      const rcConfig = {
        performance: {
          throttling: {
            apiCallsPerMinute: 60,
          },
        },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      expect(instance.get('throttling')).toEqual({
        apiCallsPerMinute: 60,
      });
    });

    it('should continue when .qualopsrc.json does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => ConfigService.getInstance()).not.toThrow();
    });

    it('should handle invalid JSON in .qualopsrc.json', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');
      expect(() => ConfigService.getInstance()).not.toThrow();
    });

    it('should override maxFilesPerBatch from environment', () => {
      mockEnvConfig.getAll = jest.fn(() => ({ maxFiles: 20 }));
      const instance = ConfigService.getInstance();
      expect(instance.get('maxFilesPerBatch')).toBe(20);
    });

    it('should disable cache when skipCache is set', () => {
      mockEnvConfig.getAll = jest.fn(() => ({ skipCache: true }));
      const instance = ConfigService.getInstance();

      expect(instance.get('cacheEnabled')).toBe(false);
    });

    it('should enable verbose from environment', () => {
      mockEnvConfig.get = jest.fn((key: any) => {
        if (key === 'verbose') return true;
        return undefined;
      }) as any;
      const instance = ConfigService.getInstance();
      expect(instance.get('verbose')).toBe(true);
    });

    it('should override multiPassReview from environment', () => {
      mockEnvConfig.getAll = jest.fn(() => ({ multiPassReview: false }));
      const instance = ConfigService.getInstance();
      expect(instance.get('multiPassReview')).toBe(false);
    });

    it('should override reactReview from environment', () => {
      mockEnvConfig.getAll = jest.fn(() => ({ reactReview: true }));
      const instance = ConfigService.getInstance();
      expect(instance.get('reactReview')).toBe(true);
    });
  });

  describe('get', () => {
    it('should return config value by key', () => {
      const instance = ConfigService.getInstance();
      expect(instance.get('maxFilesPerBatch')).toBe(7);
    });

    it('should return undefined for non-existent keys', () => {
      const instance = ConfigService.getInstance();

      expect(instance.get('nonExistent' as keyof Config)).toBeUndefined();
    });
  });

  describe('set', () => {
    it('should update config value', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxFilesPerBatch', 15);
      expect(instance.get('maxFilesPerBatch')).toBe(15);
    });

    it('should update multiple values', () => {
      const instance = ConfigService.getInstance();
      instance.set('verbose', true);
      instance.set('debug', true);
      expect(instance.get('verbose')).toBe(true);
      expect(instance.get('debug')).toBe(true);
    });
  });

  describe('getAll', () => {
    it('should return all configuration values', () => {
      const instance = ConfigService.getInstance();
      const config = instance.getAll();
      expect(config.maxFilesPerBatch).toBe(7);
      expect(config.maxConcurrency).toBe(3);
      expect(config.cacheEnabled).toBe(true);
    });

    it('should return a copy of config', () => {
      const instance = ConfigService.getInstance();
      const config1 = instance.getAll();
      const config2 = instance.getAll();
      expect(config1).not.toBe(config2);
      expect(config1).toEqual(config2);
    });
  });

  describe('merge', () => {
    it('should merge partial config', () => {
      const instance = ConfigService.getInstance();
      instance.merge({ maxFilesPerBatch: 10, verbose: true });
      expect(instance.get('maxFilesPerBatch')).toBe(10);
      expect(instance.get('verbose')).toBe(true);
      expect(instance.get('maxConcurrency')).toBe(3);
    });

    it('should override existing values', () => {
      const instance = ConfigService.getInstance();
      instance.merge({ cacheEnabled: false });
      expect(instance.get('cacheEnabled')).toBe(false);
    });
  });

  describe('reset', () => {
    it('should reset config to initial state', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxFilesPerBatch', 20);
      instance.set('verbose', true);
      instance.reset();
      expect(instance.get('maxFilesPerBatch')).toBe(7);
      expect(instance.get('verbose')).toBe(false);
    });

    it('should reload from .qualopsrc.json on reset', () => {
      const rcConfig = { performance: { maxFileSizeKB: 2000 } };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      mockReadFileSync.mockReturnValue(JSON.stringify({ performance: { maxFileSizeKB: 3000 } }));
      instance.reset();
      expect(instance.get('maxFileSizeKB')).toBe(3000);
    });
  });

  describe('isReActReviewEnabled', () => {
    it('should return true when reactReview is enabled', () => {
      const instance = ConfigService.getInstance();
      instance.set('reactReview', true);
      expect(instance.isReActReviewEnabled()).toBe(true);
    });

    it('should return false when reactReview is disabled', () => {
      const instance = ConfigService.getInstance();
      instance.set('reactReview', false);
      expect(instance.isReActReviewEnabled()).toBe(false);
    });

    it('should return false when reactReview is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('reactReview', undefined);
      expect(instance.isReActReviewEnabled()).toBe(false);
    });
  });

  describe('isCacheEnabled', () => {
    it('should return true when cache is enabled', () => {
      const instance = ConfigService.getInstance();
      expect(instance.isCacheEnabled()).toBe(true);
    });

    it('should return false when cache is disabled', () => {
      const instance = ConfigService.getInstance();
      instance.set('cacheEnabled', false);
      expect(instance.isCacheEnabled()).toBe(false);
    });

    it('should return true when cacheEnabled is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('cacheEnabled', undefined);
      expect(instance.isCacheEnabled()).toBe(true);
    });
  });

  describe('isVerbose', () => {
    it('should return verbose from config', () => {
      const instance = ConfigService.getInstance();
      instance.set('verbose', true);
      expect(instance.isVerbose()).toBe(true);
    });

    it('should fallback to envConfig when config verbose is undefined', () => {
      mockEnvConfig.isVerbose = jest.fn(() => true);
      const instance = ConfigService.getInstance();
      instance.set('verbose', undefined);
      expect(instance.isVerbose()).toBe(true);
    });

    it('should return false when both are disabled', () => {
      mockEnvConfig.isVerbose = jest.fn(() => false);
      const instance = ConfigService.getInstance();
      expect(instance.isVerbose()).toBe(false);
    });
  });

  describe('isDebug', () => {
    it('should return debug from config', () => {
      const instance = ConfigService.getInstance();
      instance.set('debug', true);
      expect(instance.isDebug()).toBe(true);
    });

    it('should fallback to envConfig when config debug is undefined', () => {
      mockEnvConfig.isDebug = jest.fn(() => true);
      const instance = ConfigService.getInstance();
      instance.set('debug', undefined);
      expect(instance.isDebug()).toBe(true);
    });

    it('should return false when both are disabled', () => {
      mockEnvConfig.isDebug = jest.fn(() => false);
      const instance = ConfigService.getInstance();
      expect(instance.isDebug()).toBe(false);
    });
  });

  describe('getAIStageConfig', () => {
    it('should return AI stage configuration', () => {
      const aiConfig = {
        reviewStage: {
          provider: 'openai',
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        },
      };
      const instance = ConfigService.getInstance();
      instance.set('ai', aiConfig);
      expect(instance.getAIStageConfig('review')).toEqual(aiConfig.reviewStage);
    });

    it('should throw error when stage config not found', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {});
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'AI configuration for stage "review" not found in .qualopsrc.json',
      );
    });

    it('should throw error when AI config is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', undefined);
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'AI configuration for stage "review" not found in .qualopsrc.json',
      );
    });

    it('should throw error when required fields are missing', () => {
      const aiConfig = {
        reviewStage: {
          provider: 'openai',
          model: 'gpt-4',
        },
      };
      const instance = ConfigService.getInstance();

      instance.set('ai', aiConfig as Config['ai']);
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'Missing required AI config for stage "review": inputPerMillion, outputPerMillion',
      );
    });

    it('should throw error for missing provider', () => {
      const aiConfig = {
        fixStage: {
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        },
      };
      const instance = ConfigService.getInstance();

      instance.set('ai', aiConfig as Config['ai']);
      expect(() => instance.getAIStageConfig('fix')).toThrow('Missing required AI config for stage "fix": provider');
    });
  });

  describe('getMaxFileSizeKB', () => {
    it('should return maxFileSizeKB from config', () => {
      const instance = ConfigService.getInstance();
      expect(instance.getMaxFileSizeKB()).toBe(500);
    });

    it('should return default when maxFileSizeKB is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxFileSizeKB', undefined);
      expect(instance.getMaxFileSizeKB()).toBe(500);
    });

    it('should return custom value when set', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxFileSizeKB', 1000);
      expect(instance.getMaxFileSizeKB()).toBe(1000);
    });
  });

  describe('getMaxTokensPerFile', () => {
    it('should return maxTokensPerFile from config', () => {
      const instance = ConfigService.getInstance();
      expect(instance.getMaxTokensPerFile()).toBe(1000000);
    });

    it('should return default when maxTokensPerFile is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxTokensPerFile', undefined);
      expect(instance.getMaxTokensPerFile()).toBe(1000000);
    });

    it('should return custom value when set', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxTokensPerFile', 500000);
      expect(instance.getMaxTokensPerFile()).toBe(500000);
    });
  });

  describe('getMaxReactSteps', () => {
    it('should return maxReactSteps from config', () => {
      const instance = ConfigService.getInstance();
      expect(instance.getMaxReactSteps()).toBe(5);
    });

    it('should return default when maxReactSteps is undefined', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxReactSteps', undefined);
      expect(instance.getMaxReactSteps()).toBe(5);
    });

    it('should return custom value when set', () => {
      const instance = ConfigService.getInstance();
      instance.set('maxReactSteps', 10);
      expect(instance.getMaxReactSteps()).toBe(10);
    });
  });

  describe('validate', () => {
    it('should return empty array when config is valid', () => {
      const aiConfig = {
        reviewStage: {
          provider: 'openai',
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        },
      };
      const instance = ConfigService.getInstance();
      instance.set('ai', aiConfig);
      expect(instance.validate()).toEqual([]);
    });

    it('should return error when AI config is missing', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', undefined);
      expect(instance.validate()).toEqual(['AI configuration is required in .qualopsrc.json']);
    });

    it('should return error when maxFilesPerBatch is less than 1', () => {
      const aiConfig = {
        reviewStage: {
          provider: 'openai',
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        },
      };
      const instance = ConfigService.getInstance();
      instance.set('ai', aiConfig);
      instance.set('maxFilesPerBatch', -1);
      expect(instance.validate()).toContain('maxFilesPerBatch must be at least 1');
    });

    it('should return multiple errors', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', undefined);
      instance.set('maxFilesPerBatch', -1);
      const errors = instance.validate();
      expect(errors).toContain('AI configuration is required in .qualopsrc.json');
      expect(errors).toContain('maxFilesPerBatch must be at least 1');
    });
  });

  describe('getFileNames', () => {
    it('should return file name constants', () => {
      const fileNames = FILE_NAMES;
      expect(fileNames.ANALYSIS).toBe('analysis.json');
      expect(fileNames.REVIEW_SUMMARY).toBe('review-summary.json');
      expect(fileNames.FIX_SUMMARY).toBe('fix-suggestions.json');
      expect(fileNames.OVERALL_REPORT).toBe('overall-report.json');
      expect(fileNames.ERROR_LOG).toBe('error-log.json');
    });
  });

  describe('getDirectories', () => {
    it('should return default directories', () => {
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('reports/sessions');
      expect(directories.CACHE).toBe('.qualops-cache');
    });

    it('should return custom directories from config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          paths: {
            sessionsDir: '/custom/sessions',
            cacheDir: '/custom/cache',
          },
        }),
      );
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('/custom/sessions');
      expect(directories.CACHE).toBe('/custom/cache');
    });
  });

  describe('getPerformanceLimits', () => {
    it('should return default performance limits', () => {
      const instance = ConfigService.getInstance();
      const limits = instance.getPerformanceLimits();
      expect(limits.maxFileSizeKB).toBe(500);
      expect(limits.maxFilesPerBatch).toBe(7);
      expect(limits.maxFilesPerProject).toBe(10000);
      expect(limits.timeoutSeconds).toBe(300);
      expect(limits.maxTokensPerFile).toBe(1000000);
      expect(limits.maxRetries).toBe(2);
    });

    it('should return custom performance limits from config', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          performance: {
            maxFileSizeKB: 1000,
            maxFilesPerBatch: 15,
            maxFilesPerProject: 5000,
            timeoutSeconds: 600,
            maxTokensPerFile: 2000000,
            maxRetries: 3,
          },
        }),
      );
      const instance = ConfigService.getInstance();
      const limits = instance.getPerformanceLimits();
      expect(limits.maxFileSizeKB).toBe(1000);
      expect(limits.maxFilesPerBatch).toBe(15);
      expect(limits.maxFilesPerProject).toBe(5000);
      expect(limits.timeoutSeconds).toBe(600);
      expect(limits.maxTokensPerFile).toBe(2000000);
      expect(limits.maxRetries).toBe(3);
    });
  });

  describe('getCriticalStages', () => {
    it('should return critical stages', () => {
      const stages = CRITICAL_STAGES;
      expect(stages).toEqual(['analyze', 'report']);
    });
  });

  describe('getCacheConfig', () => {
    it('should return cache configuration', () => {
      const cacheConfig = CACHE_CONFIG;
      expect(cacheConfig.VERSION).toBe('1.0.0');
      expect(cacheConfig.MAX_ENTRIES).toBe(10000);
      expect(cacheConfig.TTL_DAYS).toBe(7);
    });
  });

  describe('getConfigValue', () => {
    it('should return nested config value', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          paths: {
            sessionsDir: '/custom/sessions',
          },
        }),
      );
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('/custom/sessions');
    });

    it('should return undefined when path does not exist', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({}));
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('reports/sessions');
    });

    it('should return undefined when config file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('reports/sessions');
    });

    it('should handle invalid JSON gracefully', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');
      const instance = ConfigService.getInstance();
      const directories = instance.getDirectories();
      expect(directories.SESSIONS).toBe('reports/sessions');
    });
  });

  describe('exported constants', () => {
    it('should export FILE_NAMES constant', () => {
      const { FILE_NAMES } = require('@/config/config');
      expect(FILE_NAMES.ANALYSIS).toBe('analysis.json');
    });

    it('should export CRITICAL_STAGES constant', () => {
      const { CRITICAL_STAGES } = require('@/config/config');
      expect(CRITICAL_STAGES).toEqual(['analyze', 'report']);
    });

    it('should export CACHE_CONFIG constant', () => {
      const { CACHE_CONFIG } = require('@/config/config');
      expect(CACHE_CONFIG.VERSION).toBe('1.0.0');
    });
  });
});
