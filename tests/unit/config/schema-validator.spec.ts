import { z } from 'zod';

import { validateConfig } from '@/config/schema-validator';

// Minimal valid config for tests
const minimalValidConfig = {
  ai: {
    reviewStage: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-5-20250929',
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
};

describe('validateConfig', () => {
  describe('valid configs', () => {
    it('accepts minimal valid config', () => {
      expect(() => validateConfig(minimalValidConfig)).not.toThrow();
    });

    it('accepts full config with all sections', () => {
      const fullConfig = {
        ...minimalValidConfig,
        performance: { throttling: { apiCallsPerMinute: 60 } },
        fix: { maxConcurrentFixes: 5 },
        report: { includedSeverities: ['critical', 'high'] },
        github: { postComments: true, blockPipeline: false },
        gitlab: { blockPipeline: false },
        logger: { level: 'info', enableColors: true },
      };
      expect(() => validateConfig(fullConfig)).not.toThrow();
    });

    it('accepts config with $schema field', () => {
      const config = { $schema: '../docs/qualops-config.schema.json', ...minimalValidConfig };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('accepts agentic pipeline job without passes', () => {
      const config = {
        ai: minimalValidConfig.ai,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: { maxTurns: 10, contextMode: 'auto' },
            },
          ],
        },
      };
      expect(() => validateConfig(config)).not.toThrow();
    });

    it('accepts AI stage config with extra provider-specific fields', () => {
      const config = {
        ai: {
          reviewStage: {
            ...minimalValidConfig.ai.reviewStage,
            topP: 0.9,
            topK: 40,
            customField: 'value',
          },
        },
        review: minimalValidConfig.review,
      };
      expect(() => validateConfig(config)).not.toThrow();
    });
  });

  describe('schema violations (throws)', () => {
    it('throws when ai section is missing', () => {
      expect(() => validateConfig({ review: minimalValidConfig.review })).toThrow(z.ZodError);
    });

    it('throws when review section is missing', () => {
      expect(() => validateConfig({ ai: minimalValidConfig.ai })).toThrow(z.ZodError);
    });

    it('throws on unknown top-level field', () => {
      expect(() => validateConfig({ ...minimalValidConfig, unknownField: true })).toThrow(
        z.ZodError,
      );
    });

    it('throws on type mismatch (string instead of object)', () => {
      expect(() => validateConfig({ ...minimalValidConfig, ai: 'not-an-object' })).toThrow(
        z.ZodError,
      );
    });

    it('throws when ai.reviewStage is missing', () => {
      expect(() => validateConfig({ ai: {}, review: minimalValidConfig.review })).toThrow(
        z.ZodError,
      );
    });

    it('throws when pipeline is empty', () => {
      expect(() => validateConfig({ ai: minimalValidConfig.ai, review: { pipeline: [] } })).toThrow(
        z.ZodError,
      );
    });

    it('throws when file-by-file job has no passes', () => {
      expect(() =>
        validateConfig({
          ai: minimalValidConfig.ai,
          review: {
            pipeline: [{ name: 'job', enabled: true }],
          },
        }),
      ).toThrow(z.ZodError);
    });

    it('throws when file-by-file job has empty passes', () => {
      expect(() =>
        validateConfig({
          ai: minimalValidConfig.ai,
          review: {
            pipeline: [{ name: 'job', enabled: true, passes: [] }],
          },
        }),
      ).toThrow(z.ZodError);
    });

    it('throws on unknown field inside review', () => {
      expect(() =>
        validateConfig({
          ...minimalValidConfig,
          review: { ...minimalValidConfig.review, foobar: true },
        }),
      ).toThrow(z.ZodError);
    });

    it('throws on invalid AI provider', () => {
      expect(() =>
        validateConfig({
          ai: {
            reviewStage: {
              provider: 'invalid-provider',
              model: 'x',
              inputPerMillion: 0,
              outputPerMillion: 0,
            },
          },
          review: minimalValidConfig.review,
        }),
      ).toThrow(z.ZodError);
    });

    it('throws on invalid confidence score (out of range)', () => {
      expect(() =>
        validateConfig({
          ...minimalValidConfig,
          review: { ...minimalValidConfig.review, minConfidence: 15 },
        }),
      ).toThrow(z.ZodError);
    });
  });

  describe('deprecation detection', () => {
    it('returns no deprecations for config without deprecated fields', () => {
      const result = validateConfig(minimalValidConfig);
      expect(result.deprecations).toEqual([]);
    });

    it('detects deprecated top-level fields', () => {
      const config = {
        ...minimalValidConfig,
        skipPatterns: ['node_modules/**'],
        verbose: true,
        debug: false,
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('skipPatterns');
      expect(paths).toContain('verbose');
      expect(paths).toContain('debug');
    });

    it('detects deprecated nested fields in review section', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          ...minimalValidConfig.review,
          sessionBased: true,
          maxFilesBeforeReset: 100,
        },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('review.sessionBased');
      expect(paths).toContain('review.maxFilesBeforeReset');
    });

    it('detects deprecated fields in performance.throttling', () => {
      const config = {
        ...minimalValidConfig,
        performance: {
          throttling: { enabled: true, maxRequestsPerMinute: 50 },
        },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('performance.throttling.enabled');
      expect(paths).toContain('performance.throttling.maxRequestsPerMinute');
    });

    it('detects deprecated fields in fix section', () => {
      const config = {
        ...minimalValidConfig,
        fix: {
          enabled: true,
          severities: ['critical'],
          minConfidence: 8,
          autoApply: false,
        },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('fix.enabled');
      expect(paths).toContain('fix.severities');
      expect(paths).toContain('fix.minConfidence');
      expect(paths).toContain('fix.autoApply');
    });

    it('detects deprecated paths section', () => {
      const config = {
        ...minimalValidConfig,
        paths: { sessionsDir: 'custom/sessions' },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('paths');
    });

    it('includes description in deprecation warnings', () => {
      const config = {
        ...minimalValidConfig,
        verbose: true,
      };
      const result = validateConfig(config);
      const verboseWarning = result.deprecations.find((d) => d.path === 'verbose');
      expect(verboseWarning).toBeDefined();
      expect(verboseWarning!.description).toContain('Legacy');
    });

    it('detects deprecated github.enabled', () => {
      const config = {
        ...minimalValidConfig,
        github: { enabled: true, postComments: true },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('github.enabled');
    });

    it('ignores deprecated fields that are not present', () => {
      const config = {
        ...minimalValidConfig,
        github: { postComments: true },
      };
      const result = validateConfig(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).not.toContain('github.enabled');
    });
  });

  describe('real-world config', () => {
    it('validates a full production-like config', () => {
      const config = {
        $schema: '../docs/qualops-config.schema.json',
        ai: {
          reviewStage: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            inputPerMillion: 3,
            outputPerMillion: 15,
            temperature: 0,
          },
          fixStage: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            inputPerMillion: 3,
            outputPerMillion: 15,
            temperature: 0,
          },
          judgeStage: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            inputPerMillion: 3,
            outputPerMillion: 15,
            temperature: 0,
          },
        },
        performance: {
          maxFileSizeKB: 500,
          maxFilesPerBatch: 15,
          maxTokensPerFile: 8000,
          timeoutSeconds: 300,
          throttling: {
            enabled: true,
            maxRequestsPerMinute: 50,
          },
        },
        review: {
          minConfidence: 7,
          maxConcurrentFiles: 3,
          validation: {
            enabled: true,
            minConfidence: 7,
            prompt: 'validation.md',
          },
          deduplication: {
            enabled: true,
            prompt: 'deduplication.md',
          },
          pipeline: [
            {
              name: 'fileByFileJob',
              enabled: true,
              passes: [
                {
                  name: 'Error Handling',
                  enabled: true,
                  prompt: 'review.md',
                  filters: {
                    detectionTriggers: ['try', 'catch'],
                    filePatterns: ['src/**/*.ts'],
                    excludePatterns: ['**/*.spec.ts'],
                  },
                },
              ],
            },
            {
              name: 'agenticJob',
              enabled: true,
              mode: 'agentic',
              agentic: {
                maxTurns: 15,
                contextMode: 'auto',
                enabledSubagents: ['security-analyzer', 'dependency-tracer'],
              },
            },
          ],
        },
        fix: {
          enabled: true,
          severities: ['critical', 'high'],
          minConfidence: 8,
          maxConcurrentFixes: 5,
          autoApply: false,
        },
        report: {
          outputFormat: 'html',
          includedSeverities: ['critical', 'high', 'medium', 'low'],
          enableRootCauseExtraction: false,
        },
        github: {
          enabled: false,
          postComments: false,
          skipOnDraft: false,
          blockPipeline: false,
          maxInlineComments: 50,
        },
        gitlab: {
          enabled: false,
          postComments: false,
          skipOnDraft: false,
          blockPipeline: false,
        },
        skipPatterns: ['node_modules/**', '.git/**'],
      };

      const result = validateConfig(config);
      // Should pass but have deprecation warnings
      expect(result.deprecations.length).toBeGreaterThan(0);
      // Spot-check a few expected deprecations
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('skipPatterns');
      expect(paths).toContain('fix.enabled');
      expect(paths).toContain('performance.throttling.enabled');
    });
  });
});
