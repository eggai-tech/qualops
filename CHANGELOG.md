# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- A/B testing for QualOps config changes: run N config files against the same dataset and compare quality (precision/recall/F1) and cost/latency — for testing per-stage model choices, budgets, prompts, or pipeline modes. New `--config=<repo-relative-path>` eval flag runs against an arbitrary config file (validated: inside repo, `.json`, exists; precedence over `--preset`), so real ship configs are A/B-tested with no copy to drift. `evals/src/run-ab.ts` (TypeScript) takes configs via repeatable `--config=<path>` (same flag name as the qualops CLI), runs the full dataset per arm by default (scope with `--dataset`/`--limit`/`--repeats`, matching a normal eval run), and calls `evals/src/compare-experiments.ts`, which reads run-logs from `evals/logs/` (by path or experiment-label prefix via repeatable `--eval-log=<X>`) and renders a metric × arm table — one column per arm, N arms supported — with a held-or-up vs. regressed verdict for the 2-arm case. Run-log file/entry types are shared from `run-log.ts` (`RunLogFile`, `ItemCompleteEntry`). npm aliases: `eval:ab`, `eval:ab:compare`. Documented under "A/B testing configurations" in `evals/README.md`.

### Changed
- `BASH_TOOL_DESCRIPTION` constant removed; callers use `buildBashToolDescription(root)` directly so the description always reflects the actual workspace root rather than a hardcoded `/workspace/pr`.

### Fixed
- Hardened the eval A/B tooling's CLI-path handling: filesystem access is confined to the repo/`evals/logs/` (run-log write path, `--eval-log` reads, and `--config`/`--experiment` values), and `--config`/`--repeats` are validated up front so a bad arg fails immediately rather than after a costly run.
- Bash tool description in `createToolSet` now derives its workspace root from `toolConfig.bash.workspaceRoot ?? cwd`, matching the root the policy enforces. Previously the description always pointed at `/workspace/pr`, causing every command to be denied with `path-outside-workspace` in local environments.
- `git-config-template` `safe.directory` is now derived from the actual `workspaceRoot` passed by the session. Previously it was hardcoded to `/workspace/pr` and `/workspace/base`, causing `git` commands to fail with a dubious ownership error in local environments.
- `GIT_CEILING_DIRECTORIES` in `env-scrub` is now set to the parent of `workspaceRoot` rather than the hardcoded `/workspace`, so git's directory-traversal protection is effective in local checkout environments.
- `workspaceRoot` is now validated against a safe path charset before being interpolated into the git config file. A newline in the value would have allowed config injection (e.g. overriding `hooksPath`).

### Documentation
- Add TDR 0005 (intent-based agentic review) — reframes false-positive reduction as a review-architecture problem (plan/decompose by intent → execute → aggregate → critique) above the provider-agnostic `AgentAdapter`. **Status: Rejected (on Opus 4.6).** Built and A/B-tested against the flat `agentic` baseline on CRB (10 cases): `agentic-v2` was *worse* on recall (0.348 vs 0.412) and F1 (0.246 vs 0.299) at ~4× the cost. The result is scoped to Opus 4.6 — smaller models are untested and could differ. The `AgenticExecutorV2` code is dropped (not merged; kept only on its implementation branch as a reference). TDR records the evidence, the reject decision, the filtering options to pursue instead, and consequences (cost is a first-class constraint; the config-A/B eval tooling built to test it is the lasting win).

## [0.2.7] - 2026-06-18

### Changed
- Upgraded eval Langfuse SDK from `langfuse@3.38.20` to `@langfuse/client@5.4.1`. Eval runs are now registered as Langfuse experiments via `datasetRunItems.create()` with a consistent `runName`, grouping all items from a single eval run under one experiment entry in the Langfuse UI.

### Fixed
- Agentic adapters now use SDK-native structured output (same `detectCapabilities()` path as the file-by-file pipeline) instead of heuristic JSON text parsing. `AnthropicAdapter` passes `outputFormat: {type: "json_schema"}`, `OpenAIAdapter` uses `outputType`, and `ConfigurableAgentAdapter` uses `output: {structured: true}` — all gated on `isUnstructured()`. The text fallback path is kept for unstructured models and now restores the pre-QUALOPS-18 trailing-comma fix. Runs that return non-empty non-JSON output now throw instead of silently producing zero findings.
- `--diff-filter` parameter in `listChangedFiles` agentic tool now validated against the allowed git diff-filter character set (`[ACDMRTUXB*]`), consistent with how `base`/`head` refs are validated via `isSafeGitRef`.
- `AIProviderType` enum in `factory.ts` was missing `OPENAI_COMPATIBLE`, causing the `openai-compatible` switch case to use a raw string literal and bypass the exhaustive `never` check in the `default` branch.

## [0.2.6] - 2026-06-17

### Added
- `baseUrl` field added to `aiStageConfig` schema for `openai-compatible` providers, with `OPENAI_BASE_URL` / `OPENAI_API_KEY` env-var fallbacks resolved in `getResolvedStageConfig`.
- `openai-compatible` provider support for agentic review mode via `@eggai/configurable-agent` (Vercel AI SDK v5 agent loop). Any provider with a custom `baseUrl` can now run the full agentic security audit without SDK-specific adapters.
- Provider-dialect smoke spec: `npm run test:smoke` runs the 4 AI caller stages migrated in PR #145 (`file-reviewer`, `validation-resolver`, `dedup-resolver`, `root-cause-extract`) against each real provider (`anthropic`, `openai`, `bedrock`, `github`) using a slice fixture as input. Validates that the structured-output dialect path returns a zod-validated response without throwing. Implemented as a Jest spec under `tests/smoke/` with its own `jest.smoke.config.ts` — not picked up by default `npm test` (whose `roots` are limited to `tests/unit/`). Provider config comes from `ConfigService` + the existing `PROVIDER_DEFAULTS` table, not a duplicated table. Providers with missing credentials are `describe.skip()`-ed; providers with malformed credentials fail loudly via the provider class's own `validateApiKey()`. Input is a slice fixture under `evals/datasets/inbox/smoke-sql-injection/`, loosely following TDR 0002. Nightly + manual CI workflow at `.github/workflows/provider-dialect-smoke.yml`. Automates the unchecked manual smoke item from PR #145's test plan; distinct from the deferred per-stage golden-evals item which validates output quality.
- `unstructured` dialect for LLM models without `response_format: {type: "json_schema"}` support (e.g. Llama, Qwen2.5, DeepSeek-V3, Phi, older o1-series). When `isUnstructured()` is true, the pipeline runs a full prose path: `ProseFileReviewer` → `ProseValidationResolver` → `ProseDeduplicationResolver` → `session/prose-report.md`. No JSON parsing, no structured schemas — the model writes free-form prose and subsequent stages refine it in-kind.
- Bundled litellm model capability snapshot (`src/ai/providers/model-capabilities.json`, 2101 chat models) for automatic `supportsResponseSchema` lookup. Unknown models default to `unstructured` (safe).
- `scripts/update-model-capabilities.ts` maintenance script to sync the snapshot from upstream litellm (`npm run maintenance:update-model-capabilities [--write]`).

## [0.2.5] - 2026-06-08

### Fixed
- Azure OpenAI keys (non-`sk-` format) no longer fail validation when `OPENAI_BASE_URL` is set. The `sk-` prefix check is now correctly skipped for custom endpoints.

## [0.2.4] - 2026-06-04

### Added
- `skipPatterns` config field is now fully functional as a pre-filter: excluded files never reach the review pipeline in file-by-file mode, and agentic tool calls (`read_file`, `grep_files`, `glob_files`) enforce patterns at the handler layer for both OpenAI and Anthropic providers.
- Anthropic agentic mode now uses MCP tools for file access instead of SDK built-ins, ensuring `skipPatterns` enforcement is consistent across providers.
- `globFiles` tool upgraded from `find`-based to `glob` npm package for proper `**` glob support.
- Default `skipPatterns` in `ConfigService` changed from infrastructure dirs to empty (`[]`) — patterns are project-specific and should be set per project. qualops's own `.qualopsrc.json` now lists its TS-specific patterns.
- Removed `file-exclusions.ts` (dead code — `applyPenalty()` was never called).

## [0.2.3] - 2026-05-28

### Changed
- CRB evals are now self-contained slice directories (`evals/datasets/crb/<id>/slice.json` + `repo/`) — no external repo cloning required. Replaced `fetch-crb-dataset.ts` with `check-crb-staleness.ts` which validates local slices against upstream CRB PR URLs.
- Neutralize language-specific wording in built-in prompts where the underlying tooling is genuinely language-agnostic, so review output is no longer TypeScript-flavored when qualops is pointed at a non-TS repo.
- Bump `@anthropic-ai/claude-agent-sdk` from 0.2.139 to 0.3.144.
- Bump `@anthropic-ai/claude-agent-sdk-linux-x64` from 0.2.139 to 0.3.144.
- Bump `@opentelemetry/sdk-node` from 0.217.0 to 0.218.0.
- Migrated all `evals/` JavaScript files to TypeScript: scorers, schemas, llm-client, config, reviewer, run-log, upload-datasets, recall-report, fetch-crb-dataset, jest config, and all spec files.

### Fixed
- `npm-publish` workflow: remove `npm install -g npm@latest` step.

## [0.2.2] - 2026-05-19

### Added
- Zero-config mode: run `qualops` with just `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` and no `.qualopsrc.json`. Provider is auto-detected (Anthropic takes priority), defaulting to an agentic review with all built-in subagents.
- Bundled default prompt (`src/config/prompts/review/quality.md`) and agent placeholder (`src/config/agents/`) shipped with the package and used as fallbacks via layered search paths.
- Native LLM structured-response support across all stages (QUALOPS-18). Replaces fragile fenced-JSON parsing with provider-native structured output: OpenAI `response_format: json_schema` (strict mode where supported) + `json_object` fallback; Anthropic `output_config` (Claude 4.5+) + forced `tool_use` fallback; Bedrock forced `tool_use` with `input_schema`. Schema is the single source of truth — zod definitions emit JSON Schema with field descriptions transmitted to the model via the structured channel; responses are parsed and validated by zod automatically.
- New `BaseAIProvider` consolidating shared token accounting + cost computation while preserving exact per-provider semantics (OpenAI `prompt_tokens` incl. cached, Anthropic/Bedrock `input_tokens` excl. cached; Bedrock log policy unchanged).
- New `ProviderCapabilities` descriptor that routes `(provider, model)` to the right structured-output dialect, replacing model-name string sniffing.
- Reusable zod schemas in `src/ai/shared/schemas/` for review issues, validation results, dedup indices, search/replace fixes, and root-cause classifications.
- Agentic mode now supports OpenAI and Azure OpenAI providers via `@openai/agents`. Set `provider: "openai"` in your stage config to use the OpenAI adapter; set `OPENAI_BASE_URL` to an Azure endpoint and the correct Azure client is used automatically.
- You can now specify a model and provider together in stage config using `model: { provider: "openai", name: "gpt-4o" }` instead of relying on a separate top-level `provider` field.
- OpenTelemetry observability instrumentation across the full review pipeline (file-by-file, agentic, and eval runs), with auto-detection for Langfuse and generic OTLP backends. All span attributes are sanitized to prevent credential leakage.
- Agentic jobs now support a `prompt` field for file-based prompt instructions, combined with the existing inline `systemPrompt`
- GitHub Models AI provider (`provider: "github"`) via `https://models.github.ai/inference`
- Zod-based runtime validation for `.qualopsrc.json` with deprecation warnings for legacy fields
- JSON Schema generated from Zod schemas (`npm run generate:schema`) replacing hand-maintained schema
- Eval `--severity` filter to run only CRB cases with matching golden comment severity
- Report on eval flakiness for Code Review Benchmark `npm run eval:recall-report` with filtering options `-- --severity=critical`
- `init-claude` now scaffolds a validated default config, quality prompt, and supports `--provider` flag
- New `Promote to Stable` workflow (`workflow_dispatch`) for promoting a beta release to a clean stable version
- New `update-beta-ref` and `update-stable-ref` jobs in the npm publish workflow that force-move the `beta` / `stable` lightweight git tags after each release
- `docs/tdr/` folder for Technical Design Records, with TDR 0001 documenting the release process
- New `Releases` page on the docs site explaining the two-tier model to consumers

### Changed
- `AIProvider.complete` is now overloaded: `complete<S extends z.ZodType>(opts & { schema: S })` returns `AIResponse<z.infer<S>>` (schema-typed); plain `complete(opts)` still returns `AIResponse<string>`.
- `AIMessage.cacheControl` is now a typed first-class field (replaces runtime `'cache_control' in m` sniff in the Anthropic provider).
- All migrated callers (`file-reviewer`, `validation-resolver`, `dedup-resolver`, `fix-generator`, `root-cause-extract`) now use schema-driven `complete`. Hand-written `<response_format>` prompt blocks removed; semantic rules moved into zod `.describe()` annotations.
- Upgrade TypeScript from 5.9 to 6.0 with tsconfig migration (`moduleResolution: bundler`, `baseUrl` removal)
- Upgrade eslint from 9.x to 10.x, migrate `eslint-plugin-import` to `eslint-plugin-import-x`
- Release process: introduce two-tier `@beta` / `@stable` model. `beta` and `stable` are movable lightweight git tags, force-moved by CI on each publish or promotion. See `docs/tdr/0001-release-process.md` and the rewritten Release Process section of `CONTRIBUTING.md`
- `Create Release PR` workflow now deletes its half-created `release/v*` branch on failure
- Release failure issues now include the failing stages and release kind (beta vs stable)
- Normalize `uses: eggai-tech/qualops@v1` examples across the README, docs, and example workflows to `@stable`
- Refactor agentic tools: `tools/index.ts` is now a provider-agnostic registry (`createToolSet`); Anthropic and OpenAI SDK wiring stays inside their respective adapters
- AI provider types/factory now include `github` and use stricter provider typing
- Environment config and test setup now include `GITHUB_API_KEY`
- Update documentation to reference the new JSON Schema and provide configuration examples
- Added eval suite

### Removed
- Deleted `JsonParser` class and the duplicated private `fixMalformedJson` (last production callers migrated).
- Deleted misnamed `src/ai/shared/structured-ai.ts` (relocated `detectFrameworkContext` to `src/shared/utils/framework-detector.ts`).
- Removed dead `completeWithStructure` interface method (never used in production).

### Fixed
- Fix GitHub Action post-integration step
- Update the logger config loading to read from `${cwd}/.qualops/.qualopsrc.json` instead of CWD
- Remove unused `promptfoo` devDependency
- Fix lint failure with `typescript-eslint` 8.58+ due to unused type predicate parameter
- npm publish workflow now passes `--tag beta` on pre-release versions so that the `latest` dist-tag is not clobbered by betas
- CI changelog gate now treats `release/v*-beta.N` PRs like ordinary PRs (requires entries under `[Unreleased]` instead of a versioned heading), so beta release PRs pass CI
- Movable `beta` / `stable` tag pushes now use an explicit-SHA `--force-with-lease` so the push succeeds on every release after the first (lightweight tags have no remote-tracking ref for the implicit lease to use)
- Release-branch cleanup-on-failure now only runs when this workflow run actually pushed the branch (sentinel via `$GITHUB_ENV`), so a pre-existing `release/v*` branch is never deleted by a failed run
- Release version validation now allows only the prerelease labels the publish workflow recognises (`rc`, `alpha`, `beta`); unrecognised labels like `0.3.0-preview.1` are rejected up-front instead of silently publishing to `latest`
- `Promote to Stable` workflow now asserts that `stable_version` equals `beta_version`'s base (e.g., `0.4.0-beta.1` can only promote to `0.4.0`)

## [0.2.1] - 2026-03-14

### Changed
- Release workflows: migrate from PAT to GitHub App token with auto-publish on merge
- Pin all GitHub Actions to SHA digests for supply chain security
- Enable npm trusted publishing with OIDC provenance (repo now public)
- Replace softprops/action-gh-release with native gh CLI

### Fixed
- Script injection vulnerabilities in CI and release workflow inputs
- Remove unnecessary contents:write permission from dependabot auto-merge
- EOF heredoc injection in changelog extraction (random delimiter)
- Add npm pre-flight check for idempotent publish retries
- Add failure notification job (auto-creates GitHub issue on release failure)

## [0.2.0] - 2026-03-14

### Fixed
- Resolve all npm audit vulnerabilities (diff, @aws-sdk/client-bedrock-runtime, transitive deps)
- Release PR workflow: add Node.js setup, sync package-lock.json after version bump
- Fix script injection vulnerability in release workflow version inputs
- Fix `@aggai/qualops` package name typo in qualops-llm.txt

### Added
- Dependabot integration with grouped updates and auto-merge for patch/minor
- Agentic reviewer mode using Claude Agent SDK for PR-level analysis
- Context preloading: inject diffs/content directly into agent prompt (70% fewer tool calls)
- Cross-file dependency tracing with `find_usages` tool
- Security analysis subagent for vulnerability detection
- Custom agent support via configuration or markdown files in `.qualops/agents/`

### Changed
- Release workflows: migrate from PAT to GitHub App token, auto-publish on release PR merge
- Refactor qualops-llm.txt: add multi-provider support, updated models/pricing, 47% size reduction
- Upgrade all AI SDKs: @anthropic-ai/sdk 0.78, openai 6, claude-agent-sdk 0.2, zod 4
- Upgrade GitHub Actions: checkout v6, setup-node v6, upload-artifact v7, download-artifact v8
- Pipeline jobs now support `mode: 'file-by-file' | 'agentic'` configuration
- Extended `AgenticConfig` with `contextMode`, `maxTokensPerFile`, `maxTotalTokens` options
- `init-claude` command now bundles LLM context locally (works with private repos)
- Updated documentation with agentic mode examples and configuration

## [0.1.1] - 2025-01-06

### Added
- `.qualops/` folder structure for configuration and examples
- LLM context distribution with `init-claude` command
- GitHub integration with PR comments and checks API

### Changed
- Moved configuration from root `.qualopsrc.json` to `.qualops/.qualopsrc.json`
- Moved examples to `.qualops/examples/`

### Fixed
- ESLint and Prettier configuration alignment

## [0.1.0] - 2025-01-05

### Added
- Initial release of QualOps
- Multi-stage pipeline: analyze, review, fix, report, judge
- AI-powered code review with Claude, GPT-4, and AWS Bedrock support
- Framework-specific documentation loading (Angular, NgRx, RxJS, OWASP)
- Session-based review with context management
- Fix suggestion generation with automatic application
- HTML and Markdown report generation
- GitLab CI integration with MR comments
- GitHub Actions integration
- Extract log caching for incremental analysis
- Configurable thresholds and quality gates
