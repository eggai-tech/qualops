# Spec — Config file (`.qualopsrc.json`)

**Status:** Approved — EggAI, 2026-07-08 · Domain: configuration · Overview: [README.md](README.md)

The top-level object is `.strict()` (unknown top-level keys are rejected). Every field is optional. The Zod schema is the machine source of truth; this captures the contract and invariants.

## Live sections

`$schema`, `ai`, `review`, `report`, `github`, `gitlab`, `logger`, `skipPatterns`, plus `performance.throttling.apiCallsPerMinute` and `fix.maxConcurrentFixes`.

**Deprecated-but-accepted** (marked `deprecated: true`, ignored at runtime, still validate so existing configs don't break): the whole `paths` and most of `performance`/`fix`; top-level `includePatterns`, `maxFilesPerBatch`, `maxConcurrency`, `cacheEnabled`, `cacheTTL`, `outputFormat`, `outputPath`, `verbose`, `debug`, `maxFileSizeKB`, `maxTokensPerFile`, `maxReactSteps`; `ai.*Stage.provider`; `github.enabled`; `gitlab.enabled/postComments/skipOnDraft`; `review.sessionBased/maxFilesBeforeReset/maxContextTokens/enableValidation/enableDeduplication`. *(Kept accepted; removal is a later breaking release — `concept/04`.)*

### `ai`
`reviewStage` / `fixStage` / `judgeStage`, each: `model` (string or `{provider?, name}`), `inputPerMillion`, `outputPerMillion` (all three required when the stage runs), optional `temperature`, `maxTokens`, `baseUrl`, plus passthrough provider options. `ai.judgeStage` is present but currently unused. Provider/model/pricing resolution: [`../integrations/providers.md`](../integrations/providers.md).

### `review`
`minConfidence` (1–10), `maxConcurrentFiles`, global `validation`/`deduplication`, and the required `pipeline: PipelineJob[]`. A job is a discriminated union on `mode`:
- `file-by-file` — requires `passes[]` (each: `name`, `enabled`, `prompt`, optional `docs`, `filters{detectionTriggers, filePatterns, excludePatterns}`).
- `agentic` — `agentic{ maxTurns, maxBudgetUsd, enabledSubagents, customAgents, agentsDir, systemPrompt, prompt, contextMode, maxTokensPerFile, maxTotalTokens, bash{…} }`.

Prompt paths are relative to `.qualops/prompts/`.

### `report`, `github`, `gitlab`, `logger`
`report`: `includedSeverities`, `generateIssueMarkdown`, `enableRootCauseExtraction` (⚠ the latter two are honored post-refactor — [`../pipeline/reporting.md`](../pipeline/reporting.md)). `github`: `postComments`, `skipOnDraft`, `blockPipeline`, `maxInlineComments`. `gitlab`: `blockPipeline` (+ deprecated toggles). `logger`: `level`, `enableColors`, `enableTimestamps`, `prefix`.

- ⚠ Correction (F-4): a **`gate`** thresholds section is **added** to the schema — keys `maxCritical`, `maxHigh`, `maxMedium`, `maxLow`, `failOnMedium`, `failOnLow`, `requireAllStages` (thresholds are env-only today; env remains an override). Additive, non-breaking. Gate logic: [`../pipeline/gate.md`](../pipeline/gate.md).

## Zero-config defaults

Provider auto-detected from env in priority order `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` (bedrock/github/openai-compatible are not auto-detected). Defaults: anthropic `claude-sonnet-4-6` ($3/$15 per M), openai `gpt-4.1` ($2/$8), bedrock `us.anthropic.claude-sonnet-4-6-v1:0` ($3/$15). With a detected provider, `ai.reviewStage` is synthesized; the default `review.pipeline` is a single agentic `codeQuality` job. Using a stage with no resolvable provider throws a clear "no AI provider configured" error.

- **Honesty note:** zero-config synthesizes only `reviewStage`; a stage that needs another (e.g. `fix`) with no config throws. Documented as-is; the config UX rework (`concept/04`) addresses it later.
