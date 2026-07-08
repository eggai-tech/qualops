# Spec — Pipeline Behavior

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Describes the behavior the code must exhibit **after the refactor** = today's behavior plus the committed corrections in [`../plans/refactor.md`](../plans/refactor.md) §4 (buckets B/C, flagged inline as ⚠). No functional redesign here — the verifier, fingerprint identity, and folder-config are future phases in `concept/`. Structure that realizes this behavior: [`../architecture.md`](../architecture.md).

## 1. Orchestration & sessions

`qualops` (no subcommand) runs the selected stages in dependency order inside a session. A **session** is a directory under `.qualops/reports/sessions/<name>/` (name defaults to a UTC timestamp `YYYYMMDD-HHMMSS`); every artifact is written there, once, by the runner. `metadata.json` records the run; `token-stats.json` records total usage at the end.

- **Stages:** `analyze, review, fix, report, judge`. Default run = all five.
- **Dependencies (enforced, topologically ordered):** `review→analyze`; `fix→review`; `report→analyze,review`; `judge→report,fix`. A missing dependency warns; it is not auto-injected.
- **`fix` auto-drop:** on a default run, `fix` is dropped unless `ai.fixStage` is configured (the shipped default config defines it, so `fix` runs by default).
- ⚠ **Resume (F-6):** a stage reuses its artifact **only** under an explicit `--resume <session>`. Default runs never silently reuse a prior artifact. *(Today: every stage short-circuits if its artifact exists, ignoring `--skip-cache`.)*
- ⚠ **Errors & exit (F-1/F-2/F-3):** a stage failure produces a `StructuredError` artifact; telemetry is flushed before the single process exit; a failed **judge** gate sets a non-zero exit code. *(Today: stage failure calls `process.exit(1)` skipping the tracing flush, and a failed gate exits 0.)*

## 2. Stages

### analyze
Determines the file set to review. With `--files`, those paths are used verbatim (glob-expanded); otherwise the git diff `base..head` (base default `main`) yields changed files. Non-existent files are skipped; the extract log dedupes unchanged files by hash.
**In:** git refs or `--files`, `extract-log.json`, working tree. **Out:** `analysis.json` (`{ timestamp, filePaths[], executionTime, gitRefs? }`).

### review
The core stage. Reads `analysis.json`, loads each file's content and (git mode) its diff, and runs the configured **review pipeline** (§3). Results are validated/enriched, sorted by priority, summarized by severity and type, and written out.
**In:** `analysis.json`, source files, diffs, `review.*` config. **Out:** `review-summary.json` (`ReviewMetadata`: `filesReviewed`, `issues: Finding[]`, `summary{ totalIssues, critical, high, medium, low, byType{…} }`, `tokenUsage?`). Structured runs also dump `issues-before-validation-and-dedup.json` for debugging.
- ⚠ Cleanup: the `projectsReviewed: 0` field and the `GITLAB_CI`-only "injection" type filter (F-15) are vestigial and removed.

### fix
Generates search/replace fix suggestions for selected findings; applies them only when asked.
**In:** `review-summary.json`, `ai.fixStage`, source files. **Out:** `fix-summary.json` (`FixMetadata`), `diff-report.html`; source edits + rollback backups **only** when applying.
- Default is **dry-run** (no file changes); `--fix-apply` enables application. Applied fixes are further restricted to `confidence: high && !breaking`.
- Generation requires the `search` string to occur **exactly once** in the file, else the fix is discarded.
- **Open discrepancy (decide refactor scope):** selection today is hardcoded to `severity === 'high' && confidence >= 7 && !context.startsWith('[ESLint]')` and ignores `fix.severities`/`fix.minConfidence` and `--include-medium`; `critical` is never fixed. The spec's intended contract is that selection honors configured severities and threshold. Resolve as bucket C or defer explicitly.
- ⚠ Cleanup: rollback-point metadata persistence is currently dead code (writes commented out; `listRollbackPoints` always empty) — either restore or remove with the rollback feature intact (per-file backup copies stay).

### report
Aggregates analyze/review/fix data into a human report.
**In:** `analysis.json`, `review-summary.json`, `fix-summary.json`, `report.*`. **Out:** `overall-report.json` (`ReportMetadata`), `report.html`, per-issue `.md` files, `root-cause-metadata.json`.
- Review issues are filtered to `report.includedSeverities` before rendering.
- **Root-cause extraction** classifies each issue markdown against a fixed taxonomy (batched LLM calls) and files each issue under a `<rootCause>/` subfolder.
- ⚠ Correction: root-cause extraction and per-issue markdown are gated on `report.enableRootCauseExtraction` / `report.generateIssueMarkdown`. *(Today those flags are ignored; both run whenever issues exist.)*
- ⚠ Correction (F-5): a prose-dialect run reports its report as **"not gateable"**, not a hardcoded `PASSED` with forced `stageResults`.

### judge
Deterministic quality gate. Not an LLM.
**In:** `overall-report.json`, thresholds. **Out:** `judge-decision.json` (`{ passed, qualityStatus, summary, thresholds, reasons[], warnings[], detailedReport }`).
- Thresholds (defaults): `maxCritical 0`, `maxHigh 0`, `maxMedium 20`, `maxLow 50`, `requireAllStages true`, `failOnMedium false`, `failOnLow false`. `critical`/`high` over threshold → fail; `medium`/`low` over threshold → warn unless `failOn*`. `requireAllStages` fails if any stage result is falsy.
- ⚠ Correction (F-4): thresholds are configurable in the config file (a `judge`/`gate` section), with env vars as overrides. *(Today they are env-only.)*
- ⚠ Correction (F-1): `passed === false` drives a non-zero process exit on the default run. *(Today the gate is advisory — it logs and exits 0; only the separate forge-integration commands with `blockPipeline` can fail CI.)*

## 3. Review pipeline (the three dialects)

The review stage runs one of three paths, chosen by model capability and job mode:

- **Dialect selection:** if the configured model cannot produce schema-constrained output (`isUnstructured()`), the **prose** path runs; otherwise the structured path runs. This is a property of the model, not the provider — specified in full in [`review-dialects.md`](review-dialects.md).
- **Job mode (structured path):** each enabled pipeline job is `file-by-file` (default) or `agentic`.

**Default out-of-the-box behavior:** the shipped config enables exactly one job — an **agentic security audit** (`maxTurns 30`; subagents `security-analyzer`, `dependency-tracer`, `breaking-change-detector`; job validation `minConfidence 8`). The `qualopsSelfReview` file-by-file job ships disabled.

### file-by-file
Per pass, files are filtered (globs + content triggers), then each file is reviewed in one schema-constrained call (`temperature 0`) producing `Finding[]`. Findings are then run through validation and deduplication (below).

### agentic
A tool-using agent (QualOps-owned tools only) investigates the diff across files within a turn/budget cap and returns `Finding[]`, which then go through the same validation and deduplication.
- ⚠ Correction (F-13): the confidence gate uses the **configured** threshold, applied once. *(Today a hardcoded `>= 7` prefilter runs in the executor in addition to the resolver's configured threshold.)*

### validation & deduplication (both structured modes)
- **Validation:** findings below `minConfidence` are dropped; if a validation prompt is configured, one LLM call removes false positives and may rewrite confidence/severity. *(This self-validation is preserved by the refactor; it is replaced by the independent verifier only in a later functional phase — `concept/02`.)*
- **Deduplication:** findings are grouped by file; files with >1 finding get one LLM call returning the indices to keep.
- ⚠ Correction (F-16): a structured-output parse failure triggers one repair retry and, if still failing, a **visible run notice** — never a silent empty result mistaken for "clean file."

### prose
Free-text review per file → prose validation pass → prose cross-file dedup → a Markdown `prose-report.md`; **zero structured findings** are returned. The report stage surfaces the prose report and marks it not-gateable (§2 report/judge corrections). Behavioral detail: [review-dialects.md](review-dialects.md).

## 4. Post-processing (all structured modes)

Findings are validated for shape and enriched with `priority`, `estimatedEffort`, and `tags`, then sorted by priority → severity → confidence. Enrichment is single-pass (F-20: the model's effort estimate is preserved, not overwritten). The unified `Finding` shape and severity/type vocabularies are defined once in [`../contracts.md`](../contracts.md).

## 5. Known deviations summary (refactor acceptance list)

| Area | Today | Spec (post-refactor) | Bucket |
|---|---|---|---|
| Gate → exit code | advisory, exits 0 | failed gate exits non-zero | C (F-1) |
| Telemetry on failure | lost (`process.exit` skips flush) | flushed before exit | C (F-2) |
| Gate thresholds | env-only | config file + env override | C (F-4) |
| Prose gate | forced PASSED | "not gateable" | C (F-5) |
| Resume | implicit, ignores `--skip-cache` | explicit `--resume` only | C (F-6) |
| Agentic confidence | hardcoded `>=7` + configured | configured, once | C (F-13) |
| Parse failure | silent `[]` | repair retry + notice | B (F-16) |
| Enrichment | overwrites model effort | single-pass, preserved | B (F-20) |
| Root-cause / issue-md flags | ignored | honored | B |
| Injection filter, `projectsReviewed` | vestigial | removed | A |
| Rollback metadata | dead (commented out) | restored or removed cleanly | A |
| Fix selection vs config | hardcoded `high`+`>=7` | **open — decide scope** | C? |
