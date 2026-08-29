> **Appendix — evidence/analysis record.** Kept as the factual basis for the spec; terminology and document references may predate the consolidation. Normative content lives in the spec documents (01–07); old references map as: 01→appendix A, 02→appendix B, 03→appendix C, 04/05/06→spec 02+06+07, 07→spec 05, 08→spec 03, 09→appendix D, 10→spec 04.

# 01 — Current State: Architecture, Strengths, Defect Inventory

Analysis basis: full code review of `src/`, `evals/`, `tests/`, `docs/tdr/`, and default config, v0.2.7 (2026-07-07).

## 1. Architecture as-is

QualOps is a staged CLI pipeline — `analyze → review → fix → report → judge` — orchestrated by `src/cli/commands/all-command.ts`. Stages communicate **through JSON files on disk** in a session directory, mediated by a global `SessionContext` singleton (`src/shared/runtime/session-context.ts`). It ships as an npm CLI and a composite GitHub Action.

```
ANALYZE   git diff → filePaths[]                          → analysis.json
REVIEW    PipelineExecutor: file-by-file | agentic | prose → review-summary.json
FIX       high-severity issues → LLM fix suggestions       → fix-suggestions.json
REPORT    aggregate + root-cause extraction + HTML         → overall-report.json
JUDGE     deterministic threshold check on summary counts  → judge-decision.json
```

### Review stage (the core)

`PipelineExecutor` (`src/stages/review/processors/pipeline-executor.ts`, 385 lines) selects one of three paths:

- **File-by-file**: per file per pass, one structured completion (`FileReviewer`), then per-job LLM validation (`ValidationResolver`) and per-file LLM dedup (`DeduplicationResolver`).
- **Agentic** (default: only the agentic `security audit` job is enabled): Claude Agent SDK / OpenAI Agents / hand-rolled OpenAI-compatible loop (TDR 0004), locked to a QualOps MCP toolset (`read_file`, `grep_files`, `glob_files`, `bash` sandbox, `find_usages`, `git_diff_analysis`, `list_changed_files`), four markdown-defined subagents, JSON-schema output.
- **Prose** (TDR 0003): for models without structured output — free-text review → LLM validation → LLM cross-file dedup → markdown report, no structured issues.

### Finding acceptance chain (as-is)

```
schema-constrained generation
  → confidence ≥ threshold        (agentic: hardcoded 7; file-by-file: config)
  → LLM self-validation pass      (same model judges its own findings)
  → per-file LLM dedup
  → shape validation + enrichment (overwrites priority/effort/tags)
  → sort
```

There is **no deterministic guardrail anywhere in this chain**: no changed-line scope filter, no exact-duplicate coalescing, no cross-file dedup (structured path), no verification that the cited line exists or contains the referenced code.

### Context the model sees

- File-by-file: full line-numbered file + **only the list of added/deleted line numbers** — never the hunk text, never the pre-image, no cross-file context, and the computed framework context is discarded (see F-19).
- Agentic: token-budgeted diffs/files; the agent gathers cross-file context itself via tools. This is the only mode with real repo context.

## 2. Strengths worth preserving

| Strength | Where |
|---|---|
| Provider abstraction with 5 providers, per-stage config, cost accounting | `src/ai/providers/` |
| Structured-output dialect system: capability catalog, constrained decoding, tool-use fallback, array-root wrapping, truncation-tolerant JSON recovery | `src/ai/providers/capabilities.ts`, `src/ai/shared/structured/` |
| Prose pipeline for schema-less models with fail-visible eval guard | TDR 0003 |
| Locked-down agentic toolset + sandboxed bash (policy engine, env scrub, secret redaction) | `src/stages/review/agentic/tools/` |
| Subagent specialists with per-agent model overrides and "HIGH confidence only" framing | `src/config/agents/` |
| Threat-model gate and "What NOT to Flag" prompt sections | `qualops-self-review/review-system-message.md` |
| Eval harness: Langfuse experiments, 50-PR CRB benchmark (5 languages), semantic pairwise judge, config presets, slice capture format | `evals/`, TDR 0002 |
| Centralized artifact paths, OTel + Langfuse observability layering | `src/config/buildSessionPath.ts`, `src/observability/` |
| ~2,600 unit tests with exhaustive provider coverage | `tests/` |

## 3. Defect inventory

Findings are numbered F-1…F-30 and referenced from the gap analysis and refactoring plan. Severity: 🔴 breaks the product contract, 🟠 quality/correctness defect, 🟡 debt/waste.

### CI / pipeline contract

- **F-1 🔴 Failed quality gate exits 0.** Judge failure only logs `[QUALITY GATE FAILED]` (`src/cli/commands/all-command.ts:152`); the process exit code stays 0. The primary CI use case does not actually gate.
- **F-2 🔴 Telemetry lost on stage failure.** `handleStageError` → `process.exit(1)` (`src/cli/utils/error-handler.ts:34`) fires inside the region whose `finally { shutdownTracing() }` sits in `executeAllStages` (`all-command.ts:59`); `process.exit` skips `finally`, so spans for failed runs are never flushed.
- **F-3 🟠 Dead error-handling subsystem.** `src/shared/utils/error-handling.ts` (CRITICAL_STAGES, per-stage error persistence, graceful continuation) is never called; the live path hard-exits on the first stage failure, making the per-stage try/catch loop illusory.
- **F-4 🟠 Judge thresholds not configurable via config file.** `loadThresholds()` (`src/stages/judge/index.ts:17`) reads only defaults + env vars; the schema has no `judge` section, while `ai.judgeStage` exists in the schema but is documented "not yet implemented" (dead config).
- **F-5 🟠 Prose runs rubber-stamp the gate.** Prose report hardcodes an all-zero summary with `qualityStatus:'PASSED'` and `stageResults {analyze,review,fix} = true` (`src/stages/report/main.ts:45-57`), so the judge can never fail an unstructured-model run.
- **F-6 🟠 Implicit resume cache ignores `--skip-cache`.** Every stage short-circuits if its output file exists (e.g. `judge/index.ts:230`, `report/main.ts:25`); with a named session `-n`, re-runs silently return stale results.
- **F-7 🟡 Double-writes and inconsistent persistence contract.** Fix and report write their outputs both internally and in the orchestrator (`fix/index.ts:216` + `fix-command.ts:13`; `report/main.ts:60,145` + `all-command.ts:145`); analyze/review follow a different convention.
- **F-8 🟡 `getMostRecentSession` scans the wrong directory** (`session-context.ts:103` uses `reports/sessions`, artifacts live in `.qualops/reports/sessions`) — effectively always returns null.

### Review correctness / noise control

- **F-9 🔴 No stable finding identity.** IDs embed `Date.now()` (`file-reviewer.ts:124-133`, `result-parser.ts:89`). This single defect blocks reliable dedup, update-in-place, auto-resolution, drift tolerance, and addressed-rate measurement.
- **F-10 🔴 Self-validation is the only false-positive control.** `ValidationResolver` re-asks the same model to judge its own findings in one batched call. Industry evidence (see 02 §3) shows generator-adjacent self-rating is near-random; there is no independent verifier, no evidence requirement, no cross-model check.
- **F-11 🟠 No changed-line scope enforcement.** "Focus only on changed lines" is a prose instruction (`line-numbered-content.ts:20-21`); findings on unchanged lines are never programmatically dropped.
- **F-12 🟠 No deterministic or cross-file dedup (structured path).** LLM dedup groups by file only (`dedup-resolver.ts:66-73`); no hash/anchor coalescing happens before spending tokens; two passes flagging the same line both survive unless the LLM call catches them.
- **F-13 🟠 Hardcoded confidence ≥7 in agentic path ignores config** (`agentic-executor.ts:159`, `result-parser.ts:33,74`) — diverges from configurable `minConfidence`; the security job's configured `minConfidence: 8` is undermined.
- **F-14 🟠 `normalizeLocation` digit-extraction bug.** `location.match(/\d+/g)[0]` (`file-reviewer.ts:119-122`) extracts `2` from `src/api2.ts:45`. The agentic parser is robust; the two paths are inconsistent.
- **F-15 🟠 Dead GitLab injection filter.** `issue.type.toLowerCase().includes('injection')` (`review/index.ts:88`) can never match — `type` is the enum `security|performance|bug|maintainability`.
- **F-16 🟠 Silent whole-file drop on `StructuredOutputError`.** `FileReviewer` returns `[]` on parse failure (`file-reviewer.ts:63-69`) — indistinguishable from a clean file; no retry/repair, no surfacing in the summary. Dedup similarly returns un-deduped issues on failure.
- **F-17 🟠 Budget exhaustion discards completed work.** `error_max_budget_usd` is mapped to the hard-failure `error_rate_limit_tokens` (`anthropic-adapter.ts:139`), throwing away partial findings; `error_max_structured_output_retries → error_content_filter` is a mislabel.
- **F-18 🟡 Confidence-scale legacy mismatch.** `issue-validator.ts:28-35,51` validates/clamps 1–100 while the schema scale is 1–10 — dormant but misleading.
- **F-19 🟡 Dead framework detection.** `detectFrameworkContext` runs per file in the hot loop (`review/index.ts:64`) but nothing in the review path reads `file.framework`.
- **F-20 🟡 Triple-overwritten enrichment.** `toReviewIssue` computes priority/effort/tags; `IssueValidator.enrichIssue` overwrites all three, silently discarding the model's effort estimate. `ReviewIssue.line` is never populated by the file-by-file path.

### Prompt / schema governance

- **F-21 🔴 Validation prompt omits the `index` contract.** `validation.md` specifies a different output shape than the enforced `ValidationResultsSchema`; the resolver maps verdicts back **by `index`** (`validation-resolver.ts:133-151`) which the prompt never mentions — a mis-indexed response silently discards or mutates real findings.
- **F-22 🟠 Review system prompt drifted from schema.** Output section prompts for `title/category/line/impact/recommendation/references` and **five** severities with numeric bands; the schema enforces `type/description/location/suggestion/...` and **four** severities with a separate 1–10 confidence. Constrained decoding hides the damage but the prompt wastes tokens and attention on wrong instructions.
- **F-23 🟡 Bundled default prompt vestigial.** `src/config/prompts/review/quality.md` is a 14-line generic checklist that contradicts the schema and isn't referenced by the default config.

### AI layer

- **F-24 🟠 Inconsistent retry resilience.** Anthropic `maxRetries: 3`; OpenAI-compatible `maxRetries: 0` (`openai-compatible-provider.ts:69`); Bedrock: no retry wrapper at all.
- **F-25 🟡 No streaming anywhere** — latency and truncation exposure on large reviews (mitigated only by recovery parsers).
- **F-26 🟡 Logger bypasses ConfigService** — reads the hardcoded default config path at import time (`logger.ts:45`); `--config` logger settings are ignored.

### Posting behavior (GitHub / GitLab)

- **F-27 🔴 GitLab noise loop.** Dedup key is content-agnostic `file:line` built **only from unresolved discussions** (`gitlab-integration.ts:733-737,864`): resolved-but-unfixed findings are re-posted (re-spam), line drift across pushes creates duplicates, two distinct findings on one line suppress each other, and QualOps never auto-resolves its own fixed findings.
- **F-28 🟠 GitHub has no persistent inline threads.** Findings are ephemeral Checks annotations (max 50); no resolvable conversations, no suggestion blocks, no update/resolution semantics. Summary comment update-in-place is the only persistent surface.

### Evals / tests

- **F-29 🔴 No false-positive/noise metric on the native dataset.** Native set is n=3; coverage/judge/line-accuracy never penalize extra findings; CRB precision exists but `tp` counts matched *goldens* while `fp` counts unmatched *candidates* (`crb-pairwise.ts:143-151`) — precision and recall don't share a contingency table. The judge scorer scores legitimately-empty output as failure (`judge.ts:51`); missing judge keys record `0` instead of `null` (`crb-pairwise.ts:85`).
- **F-30 🟠 Posting behavior entirely untested/unevaluated.** Dedup-across-pushes, line drift, resolve-then-rerun, update-vs-repost have neither eval coverage nor end-to-end tests (integration tests mock the AI provider and `fetch`).

### Config hygiene (minor)

- `--include-medium`/`--exclude-medium` CLI flags are non-functional (fix selection hardcodes `severity==='high' && confidence>=7`, `fix/index.ts:14-19`).
- `report.generateIssueMarkdown` / `report.enableRootCauseExtraction` flags are inert — `isRootCauseExtractionEnabled()`/`isIssueMarkdownEnabled()` are never called; report runs both unconditionally.
- `FilterMetadata` / `stageResults.filter` are vestigial (no filter stage exists).
- Bedrock silently has no agentic support (`resolveAgentAdapterType` returns `undefined`).
- `plan.md` / `progress.md` at repo root are a stale 2025-11 test journal, not a roadmap — should be removed or archived.

## 4. Structural observations (beyond individual defects)

1. **Filesystem-as-message-bus + global singletons** (`SessionContext`, `ConfigService`, module-level logger, `AIFactory` cache) make the pipeline non-reentrant, hard to test in isolation, and hide ordering bugs (`getSessionPaths()` silently falls back to a `'default'` session).
2. **Prose/structured duplication**: `pipeline-executor.ts` carries fully parallel `executeProse*`/`execute*` method trees plus parallel resolver/reviewer classes — the largest single refactor opportunity (~halves the file).
3. **Orchestrator knows every stage's plumbing**: `executeStage` is a hand-written switch; adding a stage touches the switch, the `STAGES` tuple, the dependency map, and `getStageResults`. A uniform `Stage` interface would collapse these.
4. **Two `addLineNumbers` implementations** with different padding (`line-numbered-content.ts` vs `prompt-builder.ts`).
5. **Prompts and Zod schemas have no single source of truth** — three prompts have drifted from their schemas (F-21/22/23); nothing prevents future drift.
