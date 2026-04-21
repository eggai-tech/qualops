import { promptConfigSchema } from '@/config/config-schema';
import {
  CONFIG_PARSE_ERROR_CODE,
  CONFIG_VALIDATION_ERROR_CODE,
  ConfigParseError,
  ConfigValidationError,
  assertValidConfig,
  collectConfigWarnings,
} from '@/config/schema-validator';

// Minimal valid config for tests — preferred style: model as object, no top-level provider
const minimalValidConfig = {
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
};

// Legacy style: provider + string model (deprecated fallback, still accepted)
const legacyStyleConfig = {
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

describe('assertValidConfig', () => {
  describe('valid configs', () => {
    it('accepts minimal valid config', () => {
      expect(() => assertValidConfig(minimalValidConfig)).not.toThrow();
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
      expect(() => assertValidConfig(fullConfig)).not.toThrow();
    });

    it('accepts config with $schema field', () => {
      const config = { $schema: '../qualops-config.schema.json', ...minimalValidConfig };
      expect(() => assertValidConfig(config)).not.toThrow();
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
      expect(() => assertValidConfig(config)).not.toThrow();
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
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('accepts old-style provider + string model (deprecated fallback)', () => {
      expect(() => assertValidConfig(legacyStyleConfig)).not.toThrow();
    });

    it('accepts model as object { provider, name } without top-level provider', () => {
      const config = {
        ai: {
          reviewStage: {
            model: { provider: 'openai', name: 'gpt-4o' },
            inputPerMillion: 2.5,
            outputPerMillion: 10,
          },
        },
        review: minimalValidConfig.review,
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('accepts enabledSubagents as plain string array (backward compat)', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: {
                enabledSubagents: ['security-analyzer', 'dependency-tracer'],
              },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('accepts enabledSubagents with model override objects', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: {
                enabledSubagents: [
                  'dependency-tracer',
                  { name: 'security-analyzer', model: { provider: 'openai', name: 'gpt-4o' } },
                ],
              },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('accepts customAgents model as { provider, name } object', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: {
                customAgents: [
                  {
                    name: 'my-agent',
                    description: 'Custom agent',
                    prompt: 'Do things.',
                    model: { provider: 'openai', name: 'gpt-4o' },
                  },
                ],
              },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('accepts customAgents model as plain string', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: {
                customAgents: [
                  {
                    name: 'my-agent',
                    description: 'Custom agent',
                    prompt: 'Do things.',
                    model: 'gpt-4o',
                  },
                ],
              },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });
  });

  describe('schema violations (throws)', () => {
    it('throws when ai section is missing', () => {
      expect(() => assertValidConfig({ review: minimalValidConfig.review })).toThrow(
        ConfigValidationError,
      );
    });

    it('throws when review section is missing', () => {
      expect(() => assertValidConfig({ ai: minimalValidConfig.ai })).toThrow(ConfigValidationError);
    });

    it('throws on unknown top-level field', () => {
      expect(() => assertValidConfig({ ...minimalValidConfig, unknownField: true })).toThrow(
        ConfigValidationError,
      );
    });

    it('throws on type mismatch (string instead of object)', () => {
      expect(() => assertValidConfig({ ...minimalValidConfig, ai: 'not-an-object' })).toThrow(
        ConfigValidationError,
      );
    });

    it('throws when ai.reviewStage is missing', () => {
      expect(() => assertValidConfig({ ai: {}, review: minimalValidConfig.review })).toThrow(
        ConfigValidationError,
      );
    });

    it('throws when pipeline is empty', () => {
      expect(() =>
        assertValidConfig({ ai: minimalValidConfig.ai, review: { pipeline: [] } }),
      ).toThrow(ConfigValidationError);
    });

    it('throws when file-by-file job has no passes', () => {
      expect(() =>
        assertValidConfig({
          ai: minimalValidConfig.ai,
          review: {
            pipeline: [{ name: 'job', enabled: true }],
          },
        }),
      ).toThrow(ConfigValidationError);
    });

    it('throws when file-by-file job has empty passes', () => {
      expect(() =>
        assertValidConfig({
          ai: minimalValidConfig.ai,
          review: {
            pipeline: [{ name: 'job', enabled: true, passes: [] }],
          },
        }),
      ).toThrow(ConfigValidationError);
    });

    it('throws on unknown field inside review', () => {
      expect(() =>
        assertValidConfig({
          ...minimalValidConfig,
          review: { ...minimalValidConfig.review, foobar: true },
        }),
      ).toThrow(ConfigValidationError);
    });

    it('throws on invalid AI provider', () => {
      expect(() =>
        assertValidConfig({
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
      ).toThrow(ConfigValidationError);
    });

    it('throws when subagent override model object is missing name', () => {
      expect(() =>
        assertValidConfig({
          ...minimalValidConfig,
          review: {
            pipeline: [
              {
                name: 'agentic-job',
                enabled: true,
                mode: 'agentic',
                agentic: {
                  enabledSubagents: [{ name: 'security-analyzer', model: { provider: 'openai' } }],
                },
              },
            ],
          },
        }),
      ).toThrow(ConfigValidationError);
    });

    it('throws on invalid confidence score (out of range)', () => {
      expect(() =>
        assertValidConfig({
          ...minimalValidConfig,
          review: { ...minimalValidConfig.review, minConfidence: 15 },
        }),
      ).toThrow(ConfigValidationError);
    });
  });

  describe('error message formatting', () => {
    it('prefixes message with a human-readable header', () => {
      try {
        assertValidConfig({ ...minimalValidConfig, unknownField: true });
        fail('expected ConfigValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        expect((err as Error).message).toContain('Invalid .qualopsrc.json configuration:');
      }
    });

    it('includes a bullet line with path and message per issue', () => {
      try {
        assertValidConfig({ ...minimalValidConfig, unknownField: true });
        fail('expected ConfigValidationError');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toMatch(/^ {2}- <root>: .*unknownField/m);
      }
    });

    it('formats nested field paths with dot notation', () => {
      try {
        assertValidConfig({
          ...minimalValidConfig,
          ai: {
            reviewStage: {
              provider: 'not-a-provider',
              model: 'm',
              inputPerMillion: 0,
              outputPerMillion: 0,
            },
          },
        });
        fail('expected ConfigValidationError');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain('ai.reviewStage.provider');
      }
    });

    it('exposes ZodIssue objects on the error instance', () => {
      try {
        assertValidConfig({ review: minimalValidConfig.review });
        fail('expected ConfigValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        expect((err as ConfigValidationError).issues.length).toBeGreaterThan(0);
      }
    });

    it('exposes a stable machine-readable error code', () => {
      try {
        assertValidConfig({ review: minimalValidConfig.review });
        fail('expected ConfigValidationError');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigValidationError);
        expect((err as ConfigValidationError).errorCode).toBe(CONFIG_VALIDATION_ERROR_CODE);
        expect((err as ConfigValidationError).errorCode).toBe('CONFIG_VALIDATION_ERROR');
      }
    });

    it('marks the error as user-facing so the CLI can suppress the stack trace', () => {
      try {
        assertValidConfig({ review: minimalValidConfig.review });
        fail('expected ConfigValidationError');
      } catch (err) {
        expect((err as ConfigValidationError).userFacing).toBe(true);
      }
    });
  });
});

describe('ConfigParseError', () => {
  it('exposes a stable machine-readable error code', () => {
    const err = new ConfigParseError('/tmp/.qualopsrc.json', new Error('Unexpected token }'));
    expect(err.errorCode).toBe(CONFIG_PARSE_ERROR_CODE);
    expect(err.errorCode).toBe('CONFIG_PARSE_ERROR');
  });

  it('marks the error as user-facing so the CLI can suppress the stack trace', () => {
    const err = new ConfigParseError('/tmp/.qualopsrc.json', new Error('Unexpected token }'));
    expect(err.userFacing).toBe(true);
  });

  it('includes the file path and cause message', () => {
    const err = new ConfigParseError(
      '/tmp/project/.qualopsrc.json',
      new Error('Unexpected token } in JSON at position 42'),
    );
    expect(err.message).toContain('/tmp/project/.qualopsrc.json');
    expect(err.message).toContain('Unexpected token } in JSON at position 42');
  });

  it('has a distinct error name', () => {
    const err = new ConfigParseError('/tmp/.qualopsrc.json', new Error('boom'));
    expect(err.name).toBe('ConfigParseError');
  });
});

describe('path traversal validation', () => {
  describe('promptConfigSchema', () => {
    it('accepts a normal relative path', () => {
      const result = promptConfigSchema.safeParse({ file: 'review.md' });
      expect(result.success).toBe(true);
    });

    it('accepts a nested relative path', () => {
      const result = promptConfigSchema.safeParse({ file: 'custom/review.md' });
      expect(result.success).toBe(true);
    });

    it('rejects absolute path', () => {
      const result = promptConfigSchema.safeParse({ file: '/etc/passwd' });
      expect(result.success).toBe(false);
    });

    it('rejects path traversal with ../', () => {
      const result = promptConfigSchema.safeParse({ file: '../../../etc/passwd' });
      expect(result.success).toBe(false);
    });

    it('rejects path traversal embedded in path', () => {
      const result = promptConfigSchema.safeParse({ file: 'foo/../../etc/passwd' });
      expect(result.success).toBe(false);
    });

    it('accepts path with .. in filename (not traversal)', () => {
      const result = promptConfigSchema.safeParse({ file: 'my..file.md' });
      expect(result.success).toBe(true);
    });
  });

  describe('agentsDir in full config', () => {
    it('accepts normal relative agents dir', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: { agentsDir: '.qualops/agents' },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });

    it('rejects absolute agentsDir', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: { agentsDir: '/tmp/evil' },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).toThrow();
    });

    it('rejects traversal in agentsDir', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'agentic-job',
              enabled: true,
              mode: 'agentic',
              agentic: { agentsDir: '../../malicious' },
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).toThrow();
    });
  });

  describe('prompt ref as bare string in pipeline passes', () => {
    it('rejects traversal in bare prompt string', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'test-job',
              enabled: true,
              passes: [{ name: 'test-pass', enabled: true, prompt: '../../../etc/passwd' }],
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).toThrow();
    });

    it('accepts normal bare prompt string', () => {
      const config = {
        ...minimalValidConfig,
        review: {
          pipeline: [
            {
              name: 'test-job',
              enabled: true,
              passes: [{ name: 'test-pass', enabled: true, prompt: 'review.md' }],
            },
          ],
        },
      };
      expect(() => assertValidConfig(config)).not.toThrow();
    });
  });
});

describe('collectConfigWarnings', () => {
  describe('unknown passthrough field detection', () => {
    it('returns no unknown fields for a clean config', () => {
      const result = collectConfigWarnings(minimalValidConfig);
      expect(result.unknownFields).toEqual([]);
    });

    it('detects unknown fields inside ai.reviewStage', () => {
      const config = {
        ...minimalValidConfig,
        ai: {
          reviewStage: {
            ...minimalValidConfig.ai.reviewStage,
            notARealField: 'oops',
          },
        },
      };
      const result = collectConfigWarnings(config);
      expect(result.unknownFields).toContainEqual({
        path: 'ai.reviewStage',
        field: 'notARealField',
      });
    });

    it('detects unknown fields inside ai.fixStage', () => {
      const config = {
        ...minimalValidConfig,
        ai: {
          ...minimalValidConfig.ai,
          fixStage: {
            provider: 'anthropic',
            model: 'claude-sonnet-4-5-20250929',
            inputPerMillion: 3,
            outputPerMillion: 15,
            misspelled: true,
          },
        },
      };
      const result = collectConfigWarnings(config);
      expect(result.unknownFields).toContainEqual({
        path: 'ai.fixStage',
        field: 'misspelled',
      });
    });

    it('flags every key not declared in the passthrough shape', () => {
      const config = {
        ...minimalValidConfig,
        ai: {
          reviewStage: {
            ...minimalValidConfig.ai.reviewStage,
            topP: 0.9,
          },
        },
      };
      const result = collectConfigWarnings(config);
      // topP is provider-specific but undeclared — flagged as unknown.
      // This is the intended tradeoff: every unknown key surfaces a warning,
      // and provider-specific ones are simply expected noise.
      expect(result.unknownFields.map((f) => f.field)).toEqual(['topP']);
    });

    it('throws (does not warn) for unknown keys inside strict objects', () => {
      // Passthrough detection only fires inside `.passthrough()` schemas.
      // Unknown keys in `.strict()` schemas are caught by `assertValidConfig`,
      // not by warnings.
      const config = {
        ...minimalValidConfig,
        review: { ...minimalValidConfig.review, notARealReviewField: true },
      };
      expect(() => assertValidConfig(config)).toThrow(ConfigValidationError);
    });
  });

  describe('deprecation detection', () => {
    it('returns no deprecations for config without deprecated fields', () => {
      const result = collectConfigWarnings(minimalValidConfig);
      expect(result.deprecations).toEqual([]);
    });

    it('detects deprecated top-level fields', () => {
      const config = {
        ...minimalValidConfig,
        skipPatterns: ['node_modules/**'],
        verbose: true,
        debug: false,
      };
      const result = collectConfigWarnings(config);
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
      const result = collectConfigWarnings(config);
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
      const result = collectConfigWarnings(config);
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
      const result = collectConfigWarnings(config);
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
      const result = collectConfigWarnings(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('paths');
    });

    it('includes description in deprecation warnings', () => {
      const config = {
        ...minimalValidConfig,
        verbose: true,
      };
      const result = collectConfigWarnings(config);
      const verboseWarning = result.deprecations.find((d) => d.path === 'verbose');
      expect(verboseWarning).toBeDefined();
      expect(verboseWarning!.description).toContain('Legacy');
    });

    it('detects deprecated github.enabled', () => {
      const config = {
        ...minimalValidConfig,
        github: { enabled: true, postComments: true },
      };
      const result = collectConfigWarnings(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).toContain('github.enabled');
    });

    it('ignores deprecated fields that are not present', () => {
      const config = {
        ...minimalValidConfig,
        github: { postComments: true },
      };
      const result = collectConfigWarnings(config);
      const paths = result.deprecations.map((d) => d.path);
      expect(paths).not.toContain('github.enabled');
    });
  });

  describe('real-world config', () => {
    it('validates a full production-like config', () => {
      const config = {
        $schema: '../qualops-config.schema.json',
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

      expect(() => assertValidConfig(config)).not.toThrow();
      const warnings = collectConfigWarnings(config);
      // Should have deprecation warnings
      expect(warnings.deprecations.length).toBeGreaterThan(0);
      // Spot-check a few expected deprecations
      const paths = warnings.deprecations.map((d) => d.path);
      expect(paths).toContain('skipPatterns');
      expect(paths).toContain('fix.enabled');
      expect(paths).toContain('performance.throttling.enabled');
    });
  });
});
