# Spec — GitHub integration

**Status:** Approved — EggAI, 2026-07-08 · Domain: integrations · Overview: [README.md](README.md)

Posting behavior is preserved by the refactor; shared code moves to `forges/core`.

## Behavior

- **Summary comment:** a single comment identified by the marker `<!-- qualops-analysis-comment -->`, updated in place or created. Status = FAILED (critical/high) / WARNINGS (medium) / PASSED. Per-severity display caps: critical 10 / high 5 / medium 3.
- **Inline findings:** posted as **Checks API annotations** (one check run), capped at `maxInlineComments` (default 50, GitHub's hard limit), severity-prioritized; conclusion `failure` (critical/high) / `neutral` (medium) / `success`. Annotations are per-run (regenerated each run), not resolvable threads.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` exits non-zero.
- API client retries transient errors (rate-limit/timeout/503) up to 3× with backoff.

## Known limitation (not fixed by this refactor)

GitHub inline findings are ephemeral annotations with no resolution semantics. Motivates the future fingerprint-based posting protocol (`concept/02` §7).

## Decided corrections in this refactor

- ⚠ **Config location (bucket B):** both forges read the single configured path, default **`.qualops/.qualopsrc.json`**. *(GitHub already does; GitLab aligns — see [gitlab.md](gitlab.md).)*
- ⚠ **Report source (bucket B):** both forges use the **latest session's** `review-summary.json`. *(GitHub already does; GitLab aligns.)*
- ⚠ Shared comment formatting (`getStatusText`, `formatIssuesByType`, `generateCommentFromResults`) and the `QualOpsResult` shape are duplicated with GitLab → single home in `forges/core` ([`../../architecture.md`](../../architecture.md) §6).
