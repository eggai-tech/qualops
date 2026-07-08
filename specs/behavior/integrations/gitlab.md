# Spec — GitLab integration

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: integrations · Overview: [README.md](README.md)

Posting behavior is preserved by the refactor; shared code moves to `forges/core`.

## Behavior

- **Summary comment:** marker `<!-- qualops-analysis-comment -->`; upsert with 3× retry and 404→create fallback; all text sanitized and secrets redacted.
- **Inline findings:** posted as **resolvable discussions** with a text position, filtered to `report.includedSeverities` (default critical/high/medium) **and** to lines actually changed in the MR diff.
- **Cross-run dedup:** an issue is skipped if an *unresolved* discussion already exists at the same `file:line`.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` **or** a failed judge decision exits non-zero.

## Known limitation (not fixed by this refactor)

The dedup key is content-agnostic `file:line`: two distinct findings on one line collide; a resolved-but-unfixed finding can be re-posted on the next run; line drift across pushes duplicates. Motivates the future fingerprint-based posting protocol (`concept/02` §7).

## Deviations to fix in this refactor

- ⚠ **Config location (bucket B):** GitLab reads `.qualopsrc.json` at the repo root while GitHub reads `.qualops/.qualopsrc.json` — unify to the single configured path.
- ⚠ **Report source (bucket A/B):** GitLab aggregates all sessions; GitHub uses the latest session — pick one consistent behavior.
- ⚠ Shared comment formatting and the `QualOpsResult` shape are duplicated with GitHub → single home in `forges/core` ([`../../architecture.md`](../../architecture.md) §6).
