# Spec — Fix stage

**Status:** Approved — EggAI, 2026-07-08 · Domain: pipeline · Overview: [README.md](README.md)

Generates search/replace fix suggestions for selected findings; applies them only when asked.

## Contract

| | |
|---|---|
| **In** | `review-summary.json`; `ai.fixStage`; source files |
| **Out** | `fix-summary.json` (`FixMetadata`); `diff-report.html`; source edits + rollback backups **only** when applying |
| **Depends on** | review |

## Behavior

- Default is **dry-run** (no file changes); `--fix-apply` enables application. Applied fixes are further restricted to `confidence: high && !breaking`.
- Generation requires the `search` string to occur **exactly once** in the file, else the fix is discarded.

## Selection (decided — bucket C)

⚠ Correction (bucket C): selection **honors the configured `fix.severities` and `fix.minConfidence`**, and the `--include-medium` / `--exclude-medium` flags take effect. In particular `critical` findings are eligible for fixing (they are not today). ESLint-sourced findings (`context` starting with `[ESLint]`) remain excluded — a linter owns its own fixes.

*(Today: selection is hardcoded to `severity === 'high' && confidence >= 7 && !context.startsWith('[ESLint]')`, ignoring the config and the flags, so `critical` is never fixed. This is a behavior change — changelog + release note.)*

Defaults when unset: `fix.severities` defaults to `['critical','high']`; `fix.minConfidence` defaults to the review confidence threshold.

## Cleanup

⚠ Rollback-point metadata persistence is currently dead code (writes commented out; `listRollbackPoints` always empty). Either restore it or remove it, keeping the rollback feature intact (the per-file backup copies stay). Bucket A.
