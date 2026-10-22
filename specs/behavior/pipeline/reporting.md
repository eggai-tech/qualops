# Spec — Report stage

**Status:** Approved — EggAI, 2026-07-08 · Domain: pipeline · Overview: [README.md](README.md)

Aggregates analyze/review/fix data into a human report.

## Contract

| | |
|---|---|
| **In** | `analysis.json`; `review-summary.json`; `fix-summary.json`; `report.*` config |
| **Out** | `overall-report.json` (`ReportMetadata`); `report.html`; per-issue `.md` files; `root-cause-metadata.json` |
| **Depends on** | analyze, review |

## Behavior

- Review issues are filtered to `report.includedSeverities` before rendering.
- **Root-cause extraction** classifies each issue markdown against a fixed taxonomy (batched LLM calls) and files each issue under a `<rootCause>/` subfolder.
- ⚠ Correction: root-cause extraction and per-issue markdown are gated on `report.enableRootCauseExtraction` / `report.generateIssueMarkdown`. *(Today those flags are ignored; both run whenever issues exist.)* Bucket B.
- ⚠ Correction (F-5): a prose-dialect run reports its report as **"not gateable"**, not a hardcoded `PASSED` with forced `stageResults`. Bucket C.
