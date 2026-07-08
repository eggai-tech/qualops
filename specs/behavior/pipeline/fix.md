# Spec — Fix stage

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: pipeline · Overview: [README.md](README.md)

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

## Open discrepancy — decide refactor scope

Selection today is hardcoded to `severity === 'high' && confidence >= 7 && !context.startsWith('[ESLint]')` and ignores `fix.severities` / `fix.minConfidence` and `--include-medium`; **`critical` is never fixed**. The intended contract is that selection honors the configured severities and threshold. **Decision required:** implement as bucket C (behavior change) in the refactor, or defer explicitly. Until decided, an implementing agent must not guess — this is flagged, not specified.

## Cleanup

⚠ Rollback-point metadata persistence is currently dead code (writes commented out; `listRollbackPoints` always empty). Either restore it or remove it, keeping the rollback feature intact (the per-file backup copies stay). Bucket A.
