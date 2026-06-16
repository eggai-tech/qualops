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
import { ConfigParseError, ConfigValidationError } from '@/config/schema-validator';
import type { Config } from '@/shared/types';
import { logger } from '@/shared/utils/logger';

const mockEnvConfig = envConfig as jest.Mocked<typeof envConfig>;
const mockLogger = logger as jest.Mocked<typeof logger>;

/**
 * Minimal config that satisfies real schema validation. Use as a base and
 * spread extra sections on top when tests need specific fields populated.
 * Preferred style: model as object, no top-level provider.
 */
const VALID_MINIMAL_CONFIG = {
  ai: {
    reviewStage: {
      model: { provider: 'anthropic', name: 'claude-sonnet-4-5-20250929' },
      inputPerMillion: 3,
      outputPerMillion: 15,
    },
  },
  review: {
    pipeline: [
      {
        name: 'test-job',
        enabled: true,
        passes: [{ name: 'test-pass', enabled: true, prompt: 'test.md' }],
      },
    ],
  },
} as const;

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

    it('should initialize with empty skip patterns by default', () => {
      const instance = ConfigService.getInstance();
      const skipPatterns = instance.get('skipPatterns');
      expect(skipPatterns).toEqual(['.git/**']);
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
        ...VALID_MINIMAL_CONFIG,
        performance: { maxFileSizeKB: 1000 },
        fix: { maxConcurrentFixes: 5 },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      expect(instance.get('review')).toEqual(rcConfig.review);
      expect(instance.get('ai')).toEqual(rcConfig.ai);
      expect(instance.get('fix')).toEqual(rcConfig.fix);
      expect(instance.get('maxFileSizeKB')).toBe(1000);
    });

    it('should handle throttling configuration', () => {
      const rcConfig = {
        ...VALID_MINIMAL_CONFIG,
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

    it('should load configuration from .qualops/.qualopsrc.json', () => {
      const rcConfig = {
        ...VALID_MINIMAL_CONFIG,
        ai: {
          reviewStage: {
            provider: 'anthropic',
            model: 'claude-3',
            inputPerMillion: 3,
            outputPerMillion: 15,
          },
        },
      };

      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      expect(instance.get('review')).toEqual(rcConfig.review);
      expect(instance.get('ai')).toEqual(rcConfig.ai);
    });

    it('should throw ConfigParseError on invalid JSON in .qualopsrc.json', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json');
      expect(() => ConfigService.getInstance()).toThrow(ConfigParseError);
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

    it('should load skipPatterns from config file', () => {
      const rcConfig = {
        ...VALID_MINIMAL_CONFIG,
        skipPatterns: ['node_modules/**', 'package-lock.json', '**/*.d.ts'],
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      expect(instance.get('skipPatterns')).toEqual([
        'node_modules/**',
        'package-lock.json',
        '**/*.d.ts',
      ]);
    });

    it('should enable verbose from environment', () => {
      mockEnvConfig.get = jest.fn((key: any) => {
        if (key === 'verbose') return true;
        return undefined;
      }) as any;
      const instance = ConfigService.getInstance();
      expect(instance.get('verbose')).toBe(true);
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
      const rcConfig = {
        ...VALID_MINIMAL_CONFIG,
        performance: { maxFileSizeKB: 2000 },
      };
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(rcConfig));

      const instance = ConfigService.getInstance();
      mockReadFileSync.mockReturnValue(
        JSON.stringify({ ...VALID_MINIMAL_CONFIG, performance: { maxFileSizeKB: 3000 } }),
      );
      instance.reset();
      expect(instance.get('maxFileSizeKB')).toBe(3000);
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
          provider: 'openai' as const,
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
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_MINIMAL_CONFIG));
      const instance = ConfigService.getInstance();
      instance.set('ai', {});
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'AI configuration for stage "review" not found in .qualopsrc.json',
      );
    });

    it('throws with API key hint when ai is undefined and no config file exists', () => {
      // No config file, no API key — rawConfig is {}
      mockExistsSync.mockReturnValue(false);
      const instance = ConfigService.getInstance();
      instance.set('ai', undefined);
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY',
      );
    });

    it('throws with API key hint when config file has no ai section and no API key is set', () => {
      // Config file present, no ai section, no API key — ai remains undefined
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ review: VALID_MINIMAL_CONFIG.review }));
      mockEnvConfig.getAll = jest.fn(() => ({ debug: false, verbose: false }));
      const instance = ConfigService.getInstance();
      expect(() => instance.getAIStageConfig('review')).toThrow(
        'No AI provider configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY',
      );
    });

    it('throws with config hint when stage is missing in zero-config mode', () => {
      // No config file, API key present — auto-configures reviewStage but not fixStage
      mockExistsSync.mockReturnValue(false);
      mockEnvConfig.getAll = jest.fn(() => ({
        anthropicApiKey: 'sk-ant-test',
        debug: false,
        verbose: false,
      }));
      const instance = ConfigService.getInstance();
      expect(() => instance.getAIStageConfig('fix')).toThrow(
        'Stage "fix" requires explicit AI configuration',
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

    it('should not throw error when provider is absent (provider is now optional)', () => {
      const aiConfig = {
        fixStage: {
          model: 'gpt-4',
          inputPerMillion: 5,
          outputPerMillion: 15,
        },
      };
      const instance = ConfigService.getInstance();

      instance.set('ai', aiConfig as Config['ai']);
      expect(() => instance.getAIStageConfig('fix')).not.toThrow();
    });
  });

  describe('resolveModel', () => {
    it('returns default provider and model when called with no arguments', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveModel();
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    });

    it('resolves stage with object model', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveModel({
        stage: {
          model: { provider: 'openai', name: 'gpt-4o' } as any,
          inputPerMillion: 2.5,
          outputPerMillion: 10,
        },
      });
      expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
    });

    it('resolves stage with string model + deprecated provider field', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveModel({
        stage: {
          provider: 'bedrock',
          model: 'anthropic.claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        },
      });
      expect(result).toEqual({ provider: 'bedrock', model: 'anthropic.claude-3-sonnet' });
    });

    it('resolves ModelConfig string override using stage provider as fallback', () => {
      const instance = ConfigService.getInstance();
      const stage = {
        provider: 'openai' as const,
        model: 'gpt-4',
        inputPerMillion: 2.5,
        outputPerMillion: 10,
      };
      const result = instance.resolveModel({ model: 'gpt-4o-mini', stage });
      expect(result).toEqual({ provider: 'openai', model: 'gpt-4o-mini' });
    });

    it('resolves ModelConfig object override directly', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveModel({
        model: { provider: 'bedrock', name: 'anthropic.claude-3' },
      });
      expect(result).toEqual({ provider: 'bedrock', model: 'anthropic.claude-3' });
    });

    it('uses default provider when ModelConfig string has no fallback stage', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveModel({ model: 'some-model' });
      expect(result).toEqual({ provider: 'anthropic', model: 'some-model' });
    });
  });

  describe('getResolvedStageConfig', () => {
    it('resolves when stage model is object form { provider, name }', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {
        reviewStage: {
          model: { provider: 'openai', name: 'gpt-4o' } as any,
          inputPerMillion: 2.5,
          outputPerMillion: 10,
        },
      });
      const result = instance.getResolvedStageConfig('review');
      expect(result.provider).toBe('openai');
      expect(result.model).toBe('gpt-4o');
    });

    it('resolves with string model + deprecated provider field', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {
        reviewStage: {
          provider: 'bedrock' as const,
          model: 'anthropic.claude-3-sonnet',
          inputPerMillion: 3,
          outputPerMillion: 15,
        },
      });
      const result = instance.getResolvedStageConfig('review');
      expect(result.provider).toBe('bedrock');
      expect(result.model).toBe('anthropic.claude-3-sonnet');
    });

    it('throws when stage config is missing (delegates to getAIStageConfig)', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_MINIMAL_CONFIG));
      const instance = ConfigService.getInstance();
      instance.set('ai', {});
      expect(() => instance.getResolvedStageConfig('review')).toThrow(
        'AI configuration for stage "review" not found in .qualopsrc.json',
      );
    });

    it('uses config baseUrl/apiKey for openai-compatible provider', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {
        reviewStage: {
          model: { provider: 'openai-compatible', name: 'my-model' } as any,
          inputPerMillion: 1,
          outputPerMillion: 2,
          baseUrl: 'https://my.api/v1',
          apiKey: 'sk-config',
        },
      });
      const result = instance.getResolvedStageConfig('review');
      expect(result.baseUrl).toBe('https://my.api/v1');
      expect(result.apiKey).toBe('sk-config');
    });

    it('falls back to OPENAI_BASE_URL/OPENAI_API_KEY env vars for openai-compatible', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {
        reviewStage: {
          model: { provider: 'openai-compatible', name: 'my-model' } as any,
          inputPerMillion: 1,
          outputPerMillion: 2,
        },
      });
      const origBase = process.env.OPENAI_BASE_URL;
      const origKey = process.env.OPENAI_API_KEY;
      process.env.OPENAI_BASE_URL = 'https://env.api/v1';
      process.env.OPENAI_API_KEY = 'sk-env';
      try {
        const result = instance.getResolvedStageConfig('review');
        expect(result.baseUrl).toBe('https://env.api/v1');
        expect(result.apiKey).toBe('sk-env');
      } finally {
        process.env.OPENAI_BASE_URL = origBase;
        process.env.OPENAI_API_KEY = origKey;
      }
    });

    it('does not apply OPENAI env vars for non-openai-compatible providers', () => {
      const instance = ConfigService.getInstance();
      instance.set('ai', {
        reviewStage: {
          model: { provider: 'anthropic', name: 'claude-sonnet-4-6' } as any,
          inputPerMillion: 3,
          outputPerMillion: 15,
        },
      });
      const origBase = process.env.OPENAI_BASE_URL;
      process.env.OPENAI_BASE_URL = 'https://should-not-appear/v1';
      try {
        const result = instance.getResolvedStageConfig('review');
        expect(result.baseUrl).toBeUndefined();
      } finally {
        process.env.OPENAI_BASE_URL = origBase;
      }
    });
  });

  describe('resolveAgentModel', () => {
    const stageConfig = {
      provider: 'anthropic' as const,
      model: 'claude-sonnet-4-6',
      inputPerMillion: 3,
      outputPerMillion: 15,
    };

    it('returns stage model when enabledSubagents is absent', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveAgentModel('security-analyzer', {}, stageConfig);
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
    });

    it('applies enabledSubagents object override', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveAgentModel(
        'security-analyzer',
        {
          enabledSubagents: [
            'dependency-tracer',
            { name: 'security-analyzer', model: { provider: 'openai', name: 'gpt-4o' } },
          ],
        },
        stageConfig,
      );
      expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
    });

    it('applies enabledSubagents string model override, inheriting provider from stage', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveAgentModel(
        'security-analyzer',
        { enabledSubagents: [{ name: 'security-analyzer', model: 'claude-haiku-4-5' }] },
        stageConfig,
      );
      expect(result).toEqual({ provider: 'anthropic', model: 'claude-haiku-4-5' });
    });

    it('applies customAgents model override when enabledSubagents is absent', () => {
      const instance = ConfigService.getInstance();
      const result = instance.resolveAgentModel(
        'my-agent',
        {
          customAgents: [
            {
              name: 'my-agent',
              model: { provider: 'openai', name: 'gpt-4o' },
              description: 'test',
              prompt: 'test',
            },
          ],
        },
        stageConfig,
      );
      expect(result).toEqual({ provider: 'openai', model: 'gpt-4o' });
    });
  });

  describe('resolveAgentAdapterType', () => {
    let instance: ConfigService;

    beforeEach(() => {
      (ConfigService as unknown as { instance: undefined }).instance = undefined;
      instance = ConfigService.getInstance();
    });

    it('returns "anthropic" for anthropic provider', () => {
      expect(instance.resolveAgentAdapterType('anthropic')).toBe('anthropic');
    });

    it('returns "openai" for openai provider', () => {
      expect(instance.resolveAgentAdapterType('openai')).toBe('openai');
    });

    it('returns "openai" for github provider (uses OpenAI-compatible API)', () => {
      expect(instance.resolveAgentAdapterType('github')).toBe('openai');
    });

    it('returns undefined for bedrock (not yet supported)', () => {
      expect(instance.resolveAgentAdapterType('bedrock')).toBeUndefined();
    });
  });

  describe('validate', () => {
    it('should return empty array when config is valid', () => {
      const aiConfig = {
        reviewStage: {
          provider: 'openai' as const,
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
          provider: 'openai' as const,
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

  describe('schema validation integration', () => {
    it('should not throw when config file does not exist', () => {
      mockExistsSync.mockReturnValue(false);
      expect(() => ConfigService.getInstance()).not.toThrow();
    });

    it('should throw ConfigParseError on invalid JSON', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue('invalid json {{');
      expect(() => ConfigService.getInstance()).toThrow(ConfigParseError);
    });

    it('should propagate ConfigValidationError to the caller (no process.exit)', () => {
      // ConfigService no longer catches or exits — the CLI's top-level
      // error handler is responsible for that. The service just throws.
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify({ unknownTopLevelField: true }));
      expect(() => ConfigService.getInstance()).toThrow(ConfigValidationError);
    });

    it('should log warnings for deprecations', () => {
      mockExistsSync.mockReturnValue(true);
      // `verbose` is a real deprecated top-level field.
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          ...VALID_MINIMAL_CONFIG,
          verbose: true,
        }),
      );

      ConfigService.getInstance();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[CONFIG] Deprecated field "verbose"'),
      );
    });

    it('should log warnings for unknown passthrough fields', () => {
      mockExistsSync.mockReturnValue(true);
      // `ai.reviewStage` is a passthrough object, so unknown keys survive
      // strict validation but are surfaced as warnings.
      mockReadFileSync.mockReturnValue(
        JSON.stringify({
          ...VALID_MINIMAL_CONFIG,
          ai: {
            reviewStage: {
              ...VALID_MINIMAL_CONFIG.ai.reviewStage,
              notARealField: 'oops',
            },
          },
        }),
      );

      ConfigService.getInstance();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('[CONFIG] Unknown field "notARealField" at ai.reviewStage'),
      );
    });

    it('should not log warnings when there are no deprecations or unknown fields', () => {
      mockExistsSync.mockReturnValue(true);
      mockReadFileSync.mockReturnValue(JSON.stringify(VALID_MINIMAL_CONFIG));

      ConfigService.getInstance();
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });
});
