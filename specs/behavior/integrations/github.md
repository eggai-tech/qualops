# Spec — GitHub integration

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: integrations · Overview: [README.md](README.md)

Posting behavior is preserved by the refactor; shared code moves to `forges/core`.

## Behavior

- **Summary comment:** a single comment identified by the marker `<!-- qualops-analysis-comment -->`, updated in place or created. Status = FAILED (critical/high) / WARNINGS (medium) / PASSED. Per-severity display caps: critical 10 / high 5 / medium 3.
- **Inline findings:** posted as **Checks API annotations** (one check run), capped at `maxInlineComments` (default 50, GitHub's hard limit), severity-prioritized; conclusion `failure` (critical/high) / `neutral` (medium) / `success`. Annotations are per-run (regenerated each run), not resolvable threads.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` exits non-zero.
- API client retries transient errors (rate-limit/timeout/503) up to 3× with backoff.

## Known limitation (not fixed by this refactor)

GitHub inline findings are ephemeral annotations with no resolution semantics. Motivates the future fingerprint-based posting protocol (`concept/02` §7).

## Deviations to fix in this refactor

- ⚠ **Config location (bucket B):** GitHub reads `.qualops/.qualopsrc.json` while GitLab reads `.qualopsrc.json` at the repo root — unify to the single configured path.
- ⚠ **Report source (bucket A/B):** GitHub uses the latest session's `review-summary.json`; GitLab aggregates all sessions — pick one consistent behavior.
- ⚠ Shared comment formatting (`getStatusText`, `formatIssuesByType`, `generateCommentFromResults`) and the `QualOpsResult` shape are duplicated with GitLab → single home in `forges/core` ([`../../architecture.md`](../../architecture.md) §6).
