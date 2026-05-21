# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- Neutralize language-specific wording in built-in prompts where the underlying tooling is genuinely language-agnostic, so review output is no longer TypeScript-flavored when qualops is pointed at a non-TS repo:
  - `src/stages/fix/generators/fix-generator.ts`: drop `typescript` tag from prompt code fences (use bare ```` ``` ````). The LLM gets full file content; fence tag added no signal.
  - `src/stages/fix/generators/test-generator.ts`: drop `typescript` tag from the prompt code fences in `createTestPrompt` and the regression test prompt. (Note: the rest of test-generator — framework selection, `.test.ts` filenames — is unchanged; that work is gated on actually wiring test generation into the pipeline.)
  - `src/stages/report/issue-manager.ts`: drop `typescript` tag from the `## Context` code fence in generated issue markdown, so reports for non-TS files don't carry a misleading language tag (also prevents the stale tag from being re-injected into `resolve-issue.ts`'s fix prompt).
  - `src/scripts/resolve-issue.ts`: drop `typescript` from the fix prompt's code fence and the LLM-output strip regex; detect issue-file fence open/close by `\`\`\`` prefix regardless of language tag (so it handles both old TS-tagged and new bare-fenced issue reports); preview tmp file uses the source file's extension instead of hard-coded `.ts`; replace "TypeScript file"/"TypeScript code" with "source file"/"source code".
- Neutralize built-in agent prompts (the JIRA story's [QUALOPS-46] primary goal):
  - `src/config/agents/dependency-tracer.md`: drop the "for TypeScript/JavaScript codebases" framing; generalize import/export wording to dependency relationships (imports, requires, includes, uses) and "public symbols" instead of "exported symbols". Drop the TS-locked MCP tools (`trace_imports`, `find_usages`) from the tool list and instruct the agent to use Bash with language-appropriate `rg` / `git` invocations (e.g. `rg -n '<pattern>' --type <lang>`), with example patterns for Python, JS/TS, Rust, Go, Ruby, C/C++.
  - `src/config/agents/breaking-change-detector.md`: rephrase "interface/type definitions" as "type signatures, interfaces, protocols, or other public contracts"; generalize "exports" to "public symbols (exports, public functions, public classes)" so the agent applies to non-typed languages. Drop the TS-locked MCP tools (`git_diff_analysis`, `analyze_exports`, `find_interface_changes`, `find_usages`) from the tool list and instruct the agent to use Bash with `git diff`, `git show`, and `rg` directly, picking signature patterns appropriate to the project's language.

Note: the MCP tool registrations (`trace_imports`, `find_usages`, `find_interface_changes`, `analyze_exports`, `git_diff_analysis`) in `src/stages/review/agentic/tools/index.ts` and their handler functions in `src/stages/review/agentic/tools/handlers.ts` are not removed in this change — `security-analyzer.md` still references `find_usages` and `trace_imports`. A follow-up JIRA can decommission the unused tools once `security-analyzer.md` is migrated to Bash too.

### Changed
- Bump `@anthropic-ai/claude-agent-sdk` from 0.2.139 to 0.3.144.
- Bump `@anthropic-ai/claude-agent-sdk-linux-x64` from 0.2.139 to 0.3.144.
- Bump `@opentelemetry/sdk-node` from 0.217.0 to 0.218.0.

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

### Added
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
- AI provider types/factory now include `github` and use stricter provider typing
- Environment config and test setup now include `GITHUB_API_KEY`
- Update documentation to reference the new JSON Schema and provide configuration examples
- Added eval suite

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
