import { isAbsolute, normalize } from 'node:path';

import { z } from 'zod';

// --- Reusable primitives ---

const severity = z.enum(['critical', 'high', 'medium', 'low']).meta({
  defName: 'severity',
  description: 'Standard issue severity levels used across review, fix, and reporting.',
});
const severityList = z.array(severity).min(1).meta({
  defName: 'severityList',
  description: 'Non-empty array of severity levels.',
  uniqueItems: true,
});
export const aiProvider = z
  .enum(['anthropic', 'openai', 'bedrock', 'github'])
  .meta({ defName: 'aiProvider', description: 'Supported AI provider names.' });
const confidenceScore = z.int().min(1).max(10).meta({
  defName: 'confidenceScore',
  description: 'Integer confidence score from 1 (lowest) to 10 (highest).',
});
const nonEmptyString = z.string().min(1).meta({ defName: 'nonEmptyString' });
const nonEmptyStringArray = z.array(nonEmptyString).meta({ defName: 'nonEmptyStringArray' });
const relativePath = nonEmptyString
  .refine((p) => !isAbsolute(p), 'Must be a relative path.')
  .refine(
    (p) => !normalize(p).startsWith('..'),
    'Path must not traverse outside its base directory.',
  )
  .meta({ defName: 'relativePath' });
const outputFormat = z.enum(['json', 'html', 'markdown']).meta({
  defName: 'outputFormat',
  description: 'Output format for reports and generated files.',
});

// --- Model config ---
// A model can be specified as a plain string (model name, inherits provider from context)
// or as an object with an explicit name and optional provider override.
export const modelConfigSchema = z
  .union([
    nonEmptyString,
    z.object({ provider: aiProvider.optional(), name: nonEmptyString }).strict(),
  ])
  .meta({
    defName: 'modelConfig',
    description:
      'Model to use: a string name (inherits provider from context) or an object with an explicit name and optional provider override.',
  });

// --- AI stage config ---
// .passthrough() because providers may have extra fields (e.g. topP, topK).
// The `passthrough: true` meta tag is read by the schema validator to find
// passthrough objects without poking at Zod internals.
const aiStageConfigSchema = z
  .object({
    provider: aiProvider.optional().meta({
      deprecated: true,
      description: 'Deprecated. Prefer specifying provider inside the model object.',
    }),
    model: modelConfigSchema.meta({ description: 'Model name or { provider, name } object.' }),
    inputPerMillion: z
      .number()
      .min(0)
      .meta({ description: 'Estimated input token cost per million tokens.' }),
    outputPerMillion: z
      .number()
      .min(0)
      .meta({ description: 'Estimated output token cost per million tokens.' }),
    temperature: z
      .number()
      .min(0)
      .optional()
      .meta({ description: 'Sampling temperature used by compatible providers.' }),
    maxTokens: z.int().min(1).optional().meta({ description: 'Optional model output token cap.' }),
  })
  .passthrough()
  .meta({
    defName: 'aiStageConfig',
    description: 'AI configuration for a specific stage.',
    passthrough: true,
  });

const aiConfigSchema = z
  .object({
    reviewStage: aiStageConfigSchema.optional().meta({
      description:
        'Settings for the review stage runtime. When omitted, QualOps auto-detects the provider from ANTHROPIC_API_KEY or OPENAI_API_KEY and uses the default model for that provider.',
    }),
    fixStage: aiStageConfigSchema
      .optional()
      .meta({ description: 'Settings for the fix stage runtime.' }),
    judgeStage: aiStageConfigSchema.optional().meta({
      description:
        'Planned settings (currently unused) for configuring the judge stage (not yet implemented).',
    }),
  })
  .strict()
  .meta({ defName: 'aiConfig', description: 'AI provider and model settings for each stage.' });

// --- Prompt config ---
export const promptConfigSchema = z
  .object({
    file: relativePath.meta({ description: 'Prompt file path relative to .qualops/prompts.' }),
    meta: z
      .record(z.string(), z.unknown())
      .optional()
      .meta({ description: 'Optional metadata that can be used by prompt templates.' }),
  })
  .strict()
  .meta({
    defName: 'promptConfig',
    description: 'Prompt reference object with optional metadata.',
  });

const promptRef = z.union([relativePath, promptConfigSchema]).meta({
  defName: 'promptRef',
  description: 'Prompt reference as a relative path string or { file, meta } object.',
});

// --- Validation / Deduplication ---
export const validationConfigSchema = z
  .object({
    enabled: z.boolean().optional().meta({ description: 'Enable validation pass for this scope.' }),
    minConfidence: confidenceScore
      .optional()
      .meta({ description: 'Minimum confidence required before/after validation.' }),
    prompt: promptRef.optional().meta({ description: 'Prompt used for AI-assisted validation.' }),
  })
  .strict()
  .meta({
    defName: 'validationConfig',
    description: 'Validation stage settings used to filter/adjust detected issues.',
  });

export const deduplicationConfigSchema = z
  .object({
    enabled: z.boolean().optional().meta({ description: 'Enable deduplication for this scope.' }),
    prompt: promptRef
      .optional()
      .meta({ description: 'Prompt used for AI-assisted deduplication.' }),
  })
  .strict()
  .meta({
    defName: 'deduplicationConfig',
    description: 'Deduplication settings used to remove repeated issues per file.',
  });

// --- Review pass filters ---
const reviewPassFiltersSchema = z
  .object({
    detectionTriggers: nonEmptyStringArray.optional().meta({
      description: 'Regex patterns tested against file content; at least one match is required.',
    }),
    filePatterns: nonEmptyStringArray
      .optional()
      .meta({ description: 'Glob patterns a file path must match to be reviewed.' }),
    excludePatterns: nonEmptyStringArray
      .optional()
      .meta({ description: 'Glob patterns that exclude matching files from the pass.' }),
  })
  .strict()
  .meta({
    defName: 'reviewPassFilters',
    description: 'File/content filters used to decide whether a pass should review a file.',
  });

// --- Review pass ---
export const reviewPassSchema = z
  .object({
    name: nonEmptyString.meta({ description: 'Display name for logging and report grouping.' }),
    enabled: z
      .boolean()
      .meta({ description: 'Set false to disable this pass without removing it.' }),
    docs: nonEmptyString
      .optional()
      .meta({ description: 'Optional docs reference used to build doc-aware review prompts.' }),
    prompt: promptRef.meta({ description: 'Prompt reference used by this review pass.' }),
    filters: reviewPassFiltersSchema
      .optional()
      .meta({ description: 'Optional filters to limit this pass to relevant files/content.' }),
  })
  .strict()
  .meta({
    defName: 'reviewPass',
    description: 'Single review pass executed within a file-by-file pipeline job.',
  });

// --- Custom agent definition ---
export const customAgentDefinitionSchema = z
  .object({
    name: nonEmptyString.meta({ description: 'Unique custom agent name.' }),
    description: nonEmptyString.meta({
      description: 'Human-readable purpose of the custom agent.',
    }),
    prompt: nonEmptyString.meta({ description: 'System instructions for the custom agent.' }),
    tools: nonEmptyStringArray
      .optional()
      .meta({ description: 'Allowed tool names for the custom agent.' }),
    model: modelConfigSchema.optional().meta({
      defName: 'agentModel',
      description: 'Optional model override for this custom agent.',
    }),
  })
  .strict()
  .meta({
    defName: 'customAgentDefinition',
    description: 'Custom subagent definition merged with built-in agentic subagents.',
  });

// --- Agentic config ---
export const agenticSubagentTypeSchema = z
  .enum(['dependency-tracer', 'breaking-change-detector', 'security-analyzer', 'pattern-validator'])
  .meta({
    defName: 'agenticSubagentType',
    description: 'Built-in subagent identifiers supported in agentic mode.',
  });

const subagentOverrideSchema = z
  .object({
    name: agenticSubagentTypeSchema,
    model: modelConfigSchema.optional(),
  })
  .strict()
  .meta({
    defName: 'subagentOverride',
    description: 'Built-in subagent identifier with an explicit model override.',
  });

export const bashConfigSchema = z
  .object({
    mode: z
      .enum(['auto', 'ci', 'local-besteffort', 'none'])
      .optional()
      .meta({
        description:
          'Sandbox mode for the bash tool. auto = detect from environment, ' +
          'ci = CI runner sandbox, local-besteffort = bwrap/Seatbelt, none = unsandboxed (test only).',
      }),
    workspaceRoot: z
      .string()
      .optional()
      .meta({ description: 'Absolute path to the workspace root. Default: /workspace.' }),
    maxCallsPerReview: z
      .int()
      .min(1)
      .max(500)
      .optional()
      .meta({ description: 'Maximum bash tool calls per review session. Default: 200.' }),
    subagentAccess: z
      .enum(['all', 'none'])
      .optional()
      .meta({ description: 'Whether subagents can use the bash tool. Default: all.' }),
    extraDeniedBinaries: z
      .array(z.string().min(1))
      .optional()
      .meta({ description: 'Additional binary names to deny beyond the built-in list.' }),
  })
  .strict()
  .meta({
    defName: 'bashConfig',
    description: 'Configuration for the bash interrogation tool used by agentic review agents.',
  });

export const agenticConfigSchema = z
  .object({
    maxTurns: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Maximum message/tool-call turns for the agentic run.' }),
    maxBudgetUsd: z
      .number()
      .min(0)
      .optional()
      .meta({ description: 'Optional budget guardrail for agentic execution.' }),
    enabledSubagents: z
      .array(z.union([agenticSubagentTypeSchema, subagentOverrideSchema]))
      .optional()
      .meta({ description: 'Built-in subagents to enable, optionally with model overrides.' }),
    customAgents: z
      .array(customAgentDefinitionSchema)
      .optional()
      .meta({ description: 'Custom agents loaded from config and optional agents directory.' }),
    agentsDir: relativePath
      .optional()
      .meta({ description: 'Directory containing external custom agent files.' }),
    systemPrompt: z.string().optional().meta({
      description: 'Additional system instructions appended to the default agentic prompt.',
    }),
    prompt: promptRef.optional().meta({
      description: 'Prompt file reference appended after systemPrompt in the agentic prompt.',
    }),
    contextMode: z
      .enum(['diff', 'full', 'auto'])
      .meta({
        defName: 'contextMode',
        description: 'How file context is sent: diff, full file content, or auto mode.',
      })
      .optional(),
    maxTokensPerFile: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Per-file token budget when building agentic context.' }),
    maxTotalTokens: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Total token budget for all file contexts in one agentic run.' }),
    bash: bashConfigSchema
      .optional()
      .meta({ description: 'Bash tool configuration for agentic review agents.' }),
  })
  .strict()
  .meta({
    defName: 'agenticConfig',
    description:
      'Settings for agentic review execution (cross-file analysis with tools/subagents).',
  });

// --- Pipeline job (discriminated union by mode) ---
const pipelineJobSharedFields = {
  name: nonEmptyString,
  enabled: z.boolean(),
  agentic: agenticConfigSchema.optional(),
  validation: validationConfigSchema.optional(),
  deduplication: deduplicationConfigSchema.optional(),
};

const pipelineJobFileByFileSchema = z
  .object({
    ...pipelineJobSharedFields,
    mode: z.literal('file-by-file').optional(),
    passes: z.array(reviewPassSchema).min(1),
  })
  .strict()
  .meta({
    defName: 'pipelineJobFileByFile',
    description: 'Pipeline job in file-by-file mode. Requires at least one pass.',
  });

const pipelineJobAgenticSchema = z
  .object({
    ...pipelineJobSharedFields,
    mode: z.literal('agentic'),
    passes: z.array(reviewPassSchema).optional(),
  })
  .strict()
  .meta({
    defName: 'pipelineJobAgentic',
    description: 'Pipeline job in agentic mode. Passes are optional in this mode.',
  });

export const pipelineJobSchema = z
  .union([pipelineJobAgenticSchema, pipelineJobFileByFileSchema])
  .meta({
    defName: 'pipelineJob',
    description: 'Union type for supported pipeline job modes.',
  });

// --- Review config ---
export const reviewConfigSchema = z
  .object({
    minConfidence: confidenceScore.optional().meta({
      description: 'Base confidence threshold used by review and template rendering contexts.',
    }),
    maxConcurrentFiles: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Concurrent file reviews for file-by-file pass execution.' }),
    validation: validationConfigSchema
      .optional()
      .meta({ description: 'Global validation settings applied to all pipeline jobs.' }),
    deduplication: deduplicationConfigSchema
      .optional()
      .meta({ description: 'Global deduplication settings applied to all pipeline jobs.' }),
    pipeline: z
      .array(pipelineJobSchema)
      .min(1)
      .meta({ description: 'Ordered list of review jobs to execute.' }),
    sessionBased: z.boolean().optional().meta({
      deprecated: true,
      description: 'Legacy compatibility setting currently ignored by the active review pipeline.',
    }),
    maxFilesBeforeReset: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility setting currently ignored by the active review pipeline.',
    }),
    maxContextTokens: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility setting currently ignored by the active review pipeline.',
    }),
    enableValidation: z.boolean().optional().meta({
      deprecated: true,
      description: 'Legacy compatibility alias for review.validation.enabled.',
    }),
    enableDeduplication: z.boolean().optional().meta({
      deprecated: true,
      description: 'Legacy compatibility alias for review.deduplication.enabled.',
    }),
  })
  .strict()
  .meta({
    defName: 'reviewConfig',
    description: 'Top-level review stage configuration and job pipeline.',
  });

// --- Throttling config ---
const throttlingConfigSchema = z
  .object({
    apiCallsPerMinute: z.int().min(1).optional().meta({
      description: 'Maximum review-time AI calls per minute. If omitted, runtime defaults to 2.',
    }),
    enabled: z
      .boolean()
      .optional()
      .meta({ deprecated: true, description: 'Legacy compatibility field currently ignored.' }),
    maxRequestsPerMinute: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility alias currently ignored at runtime.',
    }),
  })
  .strict()
  .meta({
    defName: 'throttlingConfig',
    description: 'API rate-limit settings for review-time AI calls.',
  });

// --- Performance config ---
const performanceConfigSchema = z
  .object({
    throttling: throttlingConfigSchema.optional(),
    maxFileSizeKB: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    maxFilesPerBatch: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    maxFilesPerProject: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    timeoutSeconds: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    maxTokensPerFile: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    maxRetries: z.int().min(0).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
    maxConcurrentFiles: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field currently not applied by active stages.',
    }),
  })
  .strict()
  .meta({
    defName: 'performanceConfig',
    description:
      'Compatibility fields for performance tuning. In the current runtime, throttling.apiCallsPerMinute is the only actively applied setting.',
  });

// --- Fix config ---
const fixConfigSchema = z
  .object({
    maxConcurrentFixes: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Maximum number of fixes generated concurrently.' }),
    enabled: z
      .boolean()
      .optional()
      .meta({ deprecated: true, description: 'Enable fix stage behaviours.' }),
    prompt: nonEmptyString.optional().meta({
      deprecated: true,
      description: 'Optional fix prompt override used by fix generation workflows.',
    }),
    severities: severityList
      .optional()
      .meta({ deprecated: true, description: 'Severities eligible for fix generation.' }),
    minConfidence: confidenceScore.optional().meta({
      deprecated: true,
      description: 'Minimum issue confidence required before generating fixes.',
    }),
    autoApply: z.boolean().optional().meta({
      deprecated: true,
      description:
        'If true, enables automatic application of generated fixes when requested by stage options.',
    }),
  })
  .strict()
  .meta({
    defName: 'fixConfig',
    description:
      'Fix stage controls for severity filtering, confidence threshold, and apply behaviour.',
  });

// --- Report config ---
const reportConfigSchema = z
  .object({
    includedSeverities: severityList
      .optional()
      .meta({ description: 'Only issues with these severities are included in report outputs.' }),
    generateIssueMarkdown: z
      .boolean()
      .optional()
      .meta({ description: 'Generate per-issue markdown files alongside reports.' }),
    enableRootCauseExtraction: z.boolean().optional().meta({
      description: 'Enable post-processing that classifies issues into root-cause buckets.',
    }),
    outputFormat: outputFormat
      .optional()
      .meta({ deprecated: true, description: 'Preferred report format.' }),
  })
  .strict()
  .meta({
    defName: 'reportConfig',
    description: 'Report rendering and severity filtering settings used by report and CI outputs.',
  });

// --- GitHub config ---
const githubConfigSchema = z
  .object({
    postComments: z
      .boolean()
      .optional()
      .meta({ description: 'Post or update a QualOps PR comment.' }),
    skipOnDraft: z
      .boolean()
      .optional()
      .meta({ description: 'Skip commenting/check updates for draft PRs.' }),
    blockPipeline: z
      .boolean()
      .optional()
      .meta({ description: 'Fail status/check when configured quality conditions are not met.' }),
    maxInlineComments: z
      .int()
      .min(1)
      .optional()
      .meta({ description: 'Maximum number of inline annotations/comments created per run.' }),
    enabled: z
      .boolean()
      .optional()
      .meta({ deprecated: true, description: 'Enable GitHub integration behaviour.' }),
  })
  .strict()
  .meta({ defName: 'githubConfig', description: 'GitHub pull request integration settings.' });

// --- GitLab config ---
const gitlabConfigSchema = z
  .object({
    blockPipeline: z
      .boolean()
      .optional()
      .meta({ description: 'Fail CI pipeline when configured quality conditions are not met.' }),
    enabled: z
      .boolean()
      .optional()
      .meta({ deprecated: true, description: 'Enable GitLab integration behaviour.' }),
    postComments: z
      .boolean()
      .optional()
      .meta({ deprecated: true, description: 'Post or update a QualOps MR note.' }),
    skipOnDraft: z.boolean().optional().meta({
      deprecated: true,
      description: 'Skip MR updates for draft merge requests when supported.',
    }),
  })
  .strict()
  .meta({
    defName: 'gitlabConfig',
    description:
      'GitLab merge request integration settings. This section is read from a root .qualopsrc.json file.',
  });

// --- Paths config (deprecated section) ---
const pathsConfigSchema = z
  .object({
    sessionsDir: nonEmptyString.optional().meta({ description: 'Custom sessions directory path.' }),
    cacheDir: nonEmptyString.optional().meta({ description: 'Custom cache directory path.' }),
    outputDir: nonEmptyString.optional().meta({ description: 'Custom output directory path.' }),
  })
  .strict()
  .meta({
    defName: 'pathsConfig',
    description: 'Legacy directory override settings retained for compatibility.',
  });

// --- Logger config ---
const loggerConfigSchema = z
  .object({
    level: z
      .enum(['debug', 'info', 'warn', 'error'])
      .meta({ defName: 'logLevel', description: 'Minimum log level to emit.' })
      .optional(),
    enableColors: z.boolean().optional().meta({ description: 'Enable ANSI colorized logs.' }),
    enableTimestamps: z
      .boolean()
      .optional()
      .meta({ description: 'Prefix logs with ISO timestamps.' }),
    prefix: z
      .string()
      .optional()
      .meta({ description: 'Optional static prefix added to each log line.' }),
  })
  .strict()
  .meta({
    defName: 'loggerConfig',
    description: 'Logger output formatting options used by shared logger initialization.',
  });

// --- Top-level config ---
export const qualopsConfigSchema = z
  .object({
    $schema: z.string().optional().meta({
      description: 'Optional JSON Schema reference for editor/validator tooling.',
      format: 'uri-reference',
    }),
    ai: aiConfigSchema.optional().meta({
      description:
        'AI provider and model settings for each stage. When omitted, the provider is auto-detected from environment variables.',
    }),
    review: reviewConfigSchema.optional().meta({
      description:
        'Review pipeline configuration. When omitted, a default agentic review pipeline is used.',
    }),
    performance: performanceConfigSchema.optional().meta({
      description:
        'Compatibility settings for performance limits. In current runtime behavior, only throttling.apiCallsPerMinute is actively applied.',
    }),
    fix: fixConfigSchema
      .optional()
      .meta({ description: 'Fix generation behaviour and thresholds for the fix stage.' }),
    report: reportConfigSchema.optional().meta({
      description: 'Report output and filtering options used by report and CI integrations.',
    }),
    github: githubConfigSchema.optional().meta({
      description: 'GitHub PR integration options for comments, annotations, and quality gating.',
    }),
    gitlab: gitlabConfigSchema
      .optional()
      .meta({ description: 'GitLab MR integration options for comments and pipeline blocking.' }),
    paths: pathsConfigSchema.optional().meta({
      deprecated: true,
      description:
        'Legacy directory overrides retained for compatibility. Current pipeline execution does not apply these values.',
    }),
    logger: loggerConfigSchema.optional().meta({
      description:
        'Logger behavior for console output (level, colors, timestamps, prefix). This is read from a root .qualopsrc.json file.',
    }),
    skipPatterns: nonEmptyStringArray.optional().meta({
      description:
        'Glob patterns for files to exclude from all analysis. Applied before any file reaches the review pipeline.',
    }),
    includePatterns: nonEmptyStringArray.optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
    }),
    maxFilesPerBatch: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 7,
    }),
    maxConcurrency: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 3,
    }),
    cacheEnabled: z.boolean().optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: true,
    }),
    cacheTTL: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 300000,
    }),
    outputFormat: outputFormat.optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 'html',
    }),
    outputPath: nonEmptyString.optional().meta({
      deprecated: true,
      description: 'Legacy top-level override currently unused by runtime stage implementations.',
    }),
    verbose: z.boolean().optional().meta({
      deprecated: true,
      description:
        'Legacy compatibility field. Values from config files are currently ignored (environment variables still apply).',
      default: false,
    }),
    debug: z.boolean().optional().meta({
      deprecated: true,
      description:
        'Legacy compatibility field. Values from config files are currently ignored (environment variables still apply).',
      default: false,
    }),
    maxFileSizeKB: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 500,
    }),
    maxTokensPerFile: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 1000000,
    }),
    maxReactSteps: z.int().min(1).optional().meta({
      deprecated: true,
      description: 'Legacy compatibility field. Values from config files are currently ignored.',
      default: 5,
    }),
  })
  .strict();
