# Spec — GitLab integration

**Status:** Approved — EggAI, 2026-07-08 · Domain: integrations · Overview: [README.md](README.md)

Posting behavior is preserved by the refactor; shared code moves to `forges/core`.

## Behavior

- **Summary comment:** marker `<!-- qualops-analysis-comment -->`; upsert with 3× retry and 404→create fallback; all text sanitized and secrets redacted.
- **Inline findings:** posted as **resolvable discussions** with a text position, filtered to `report.includedSeverities` (default critical/high/medium) **and** to lines actually changed in the MR diff.
- **Cross-run dedup:** an issue is skipped if an *unresolved* discussion already exists at the same `file:line`.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` **or** a failed judge decision exits non-zero.

## Known limitation (not fixed by this refactor)

The dedup key is content-agnostic `file:line`: two distinct findings on one line collide; a resolved-but-unfixed finding can be re-posted on the next run; line drift across pushes duplicates. Motivates the future fingerprint-based posting protocol (`concept/02` §7).

## Decided corrections in this refactor

- ⚠ **Config location (bucket B):** GitLab **aligns to `.qualops/.qualopsrc.json`** (it reads `.qualopsrc.json` at the repo root today). **Migration/release note required:** GitLab users with a root `.qualopsrc.json` must move it under `.qualops/`; call this out in the release notes and provide a one-line migration hint.
- ⚠ **Report source (bucket B):** GitLab uses the **latest session's** `review-summary.json` (it aggregates all sessions today).
- ⚠ Shared comment formatting and the `QualOpsResult` shape are duplicated with GitHub → single home in `forges/core` ([`../../architecture.md`](../../architecture.md) §6).
