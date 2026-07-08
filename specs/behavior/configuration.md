# Spec — Configuration & CLI Surface

**Status:** Approved 2026-07-08 · The current user-facing surface, which the refactor **preserves** (config format, CLI flags, and action inputs are unchanged — [`../plans/refactor.md`](../plans/refactor.md) §2). The `qualops-config.schema.json` / `src/config/config-schema.ts` Zod schema is the machine source of truth; this spec captures the contract and invariants. The future folder-based config model is a separate phase in `concept/04-configuration-spec.md` and is **not** part of this baseline.

## 1. CLI

Binary `qualops` (commander). Running it with no subcommand runs the stage pipeline.

**Global options:** `-c/--config <path>` (default `.qualops/.qualopsrc.json`) · `-b/--base <ref>` (default `main`) · `-h/--head <ref>` (note: `-h` is bound to head, not help) · `-f/--files <paths>` (comma/globs) · `-s/--stages <list|all>` (default `all`) · `-n/--name <session>` (default timestamp) · `--report-root <name>` (default `.qualops/reports`) · `--fix-apply` · `--include-medium` / `--exclude-medium` · `--skip-cache`.

**Subcommands:** `all` (alias of default) · `generate-index` (`--filter <pattern>`) · `validate` (config-only check; prints deprecation/unknown-field warnings) · `init-claude` (`--provider anthropic|openai|bedrock`, scaffolds `.qualops/`) · `github-integration` (posts results; run after the pipeline).

File selection: comma-split; entries with `*`/`{`/`?` are globs (ignoring `skipPatterns`); plain paths must exist.

- ⚠ Correction (F-6): `--skip-cache`/resume behavior is made explicit — see [`pipeline.md`](pipeline.md) §1.
- **Open discrepancy:** `--include-medium`/`--exclude-medium` are currently non-functional (fix selection is hardcoded); tie to the fix-selection decision in [`pipeline.md`](pipeline.md) §2.

## 2. Config file

Top-level object is `.strict()` (unknown top-level keys are rejected). Every field is optional. **Live sections:** `$schema`, `ai`, `review`, `report`, `github`, `gitlab`, `logger`, `skipPatterns`, plus `performance.throttling.apiCallsPerMinute`, `fix.maxConcurrentFixes`.

**Deprecated-but-accepted** (marked `deprecated: true`, ignored at runtime, still validate so existing configs don't break): the whole `paths` and most of `performance`/`fix`; top-level `includePatterns`, `maxFilesPerBatch`, `maxConcurrency`, `cacheEnabled`, `cacheTTL`, `outputFormat`, `outputPath`, `verbose`, `debug`, `maxFileSizeKB`, `maxTokensPerFile`, `maxReactSteps`; `ai.*Stage.provider`; `github.enabled`; `gitlab.enabled/postComments/skipOnDraft`; `review.sessionBased/maxFilesBeforeReset/maxContextTokens/enableValidation/enableDeduplication`. *(The refactor keeps these accepted — removing them is a later breaking release, `concept/04`.)*

### `ai`
`reviewStage` / `fixStage` / `judgeStage`, each: `model` (string or `{provider?, name}`), `inputPerMillion`, `outputPerMillion` (all three required when the stage runs), optional `temperature`, `maxTokens`, `baseUrl`, plus passthrough provider options. `ai.judgeStage` is present but currently unused. Provider/model/pricing resolution and zero-config defaults: [`integrations.md`](integrations.md) §A.

### `review`
`minConfidence` (1–10), `maxConcurrentFiles`, global `validation`/`deduplication`, and the required `pipeline: PipelineJob[]`. A job is a discriminated union on `mode`: `file-by-file` (requires `passes[]` — each with `name`, `enabled`, `prompt`, optional `docs`, `filters{detectionTriggers, filePatterns, excludePatterns}`) or `agentic` (with `agentic{ maxTurns, maxBudgetUsd, enabledSubagents, customAgents, agentsDir, systemPrompt, prompt, contextMode, maxTokensPerFile, maxTotalTokens, bash{…} }`). Prompt paths are relative to `.qualops/prompts/`.

### `report`, `github`, `gitlab`, `logger`
`report`: `includedSeverities`, `generateIssueMarkdown`, `enableRootCauseExtraction` (⚠ the latter two are honored post-refactor — [`pipeline.md`](pipeline.md) §2). `github`: `postComments`, `skipOnDraft`, `blockPipeline`, `maxInlineComments`. `gitlab`: `blockPipeline` (+ deprecated toggles). `logger`: `level`, `enableColors`, `enableTimestamps`, `prefix`.

- ⚠ Correction (F-4): a `judge`/`gate` thresholds section is added to the schema (currently thresholds are env-only). Additive, non-breaking.

## 3. Zero-config defaults

Provider auto-detected from env in priority order `ANTHROPIC_API_KEY` > `OPENAI_API_KEY` (bedrock/github/openai-compatible are not auto-detected). Defaults: anthropic `claude-sonnet-4-6` ($3/$15 per M), openai `gpt-4.1` ($2/$8), bedrock `us.anthropic.claude-sonnet-4-6-v1:0` ($3/$15). With a detected provider, `ai.reviewStage` is synthesized; the default `review.pipeline` is a single agentic `codeQuality` job. Using a stage with no resolvable provider throws a clear "no AI provider configured" error.
- **Honesty note:** zero-config synthesizes only `reviewStage`; a stage that needs another (e.g. `fix`) with no config throws. Documented as-is; the config UX rework (`concept/04`) addresses it later.

## 4. GitHub Action (`action.yml`)

Composite action (Node 20). **Inputs:** `anthropic-api-key` (required), `github-token` (default `${{ github.token }}`), `config-path` (default `.qualops/.qualopsrc.json`), `stages` (default `analyze,review,judge,report`), `base-ref`, `files`. **Outputs:** `total-issues`, `critical-issues`, `high-issues`, `quality-passed`.
- **Consistency note:** the action's default `stages` omits `fix`, while the CLI default `all` includes it (auto-dropped without `fixStage`). Kept as-is; noted so the two are understood as intentional, not a bug.

## 5. Environment variables

- **Secrets/creds:** `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `GITHUB_API_KEY`.
- **Quality-gate thresholds:** `QUALOPS_MAX_CRITICAL/HIGH/MEDIUM/LOW`, `QUALOPS_FAIL_ON_MEDIUM/LOW`, `QUALOPS_MIN_QUALITY_SCORE` (⚠ these move into the config file too, F-4; env remains an override).
- **Feature flags:** `QUALOPS_ENABLE_REACT`, `QUALOPS_SKIP_CACHE`, `DEBUG`, `VERBOSE`/`QUALOPS_VERBOSE`, `USE_CONSOLIDATED_REVIEW`.
- **Perf/paths:** `QUALOPS_MAX_FILES*`, `QUALOPS_TIMEOUT_SECONDS`, `QUALOPS_SESSIONS_DIR`, `QUALOPS_CACHE_DIR`; misc `NODE_ENV`, `QUALOPS_AI_TEMPERATURE`, `QUALOPS_BASE_BRANCH`.
- **CI/forge (read in integrations):** the `GITHUB_*` and GitLab `CI_*`/`GITLAB_*` families. **Observability:** `LANGFUSE_*`, `OTEL_EXPORTER_OTLP_ENDPOINT`.
- ⚠ Post-refactor: all `process.env` reads are centralized in `platform/env` (F: scattered reads today). No new env vars; same names.

## 6. Custom agents (current mechanism)

Two ways to add a reviewer sub-agent to an agentic job: **inline** via `agentic.customAgents[]` (`{ name, description, prompt, tools?, model? }`), or **file-based** by dropping `<name>.md` into `.qualops/agents/` (frontmatter `description`/`tools`/`model` + a prompt body; filename is the agent name). Built-in subagents (enum): `dependency-tracer`, `breaking-change-detector`, `security-analyzer`, `pattern-validator`, selectable via `enabledSubagents`.
- ⚠ Post-refactor hardening: the file-based frontmatter parser becomes a real, schema-validated YAML parser with loud errors (today it is a hand-rolled parser that silently ignores malformed frontmatter). Format and location are unchanged. *(The richer folder-based reviewer model is future — `concept/04`.)*
