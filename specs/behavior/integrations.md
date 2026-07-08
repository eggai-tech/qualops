# Spec — Providers, Dialects & Forge Integrations

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Current behavior the refactor **preserves**, with the bucket-B corrections flagged ⚠. The refactor wraps this behind the two ports ([`../architecture.md`](../architecture.md) §3) and de-duplicates the forge code into `forges/core`; the model-backbone swap to the Vercel AI SDK and the fingerprint-based posting protocol are **later phases** (`concept/08`, `concept/02`) and are not described here.

## A. AI providers & dialects

### Providers
Five provider kinds: `anthropic`, `bedrock`, `openai`, `github` (GitHub Models), `openai-compatible`. Selection is per stage from `ai.<stage>` config; provider instances are cached per `{provider}-{stage}`. Each requires `model`, `inputPerMillion`, `outputPerMillion`; SDK clients are constructed lazily. Custom/self-hosted endpoints are reached via `openai-compatible` with a `baseUrl` (key optional). Zero-config resolution and defaults: [`configuration.md`](configuration.md) §3.

### Dialects (structured-output routing)
The **dialect** is a property of the *model*, detected from a bundled capability catalog (a filtered litellm snapshot) plus provider rules:
- `anthropic-output-config` — native constrained decoding for Claude 4.5+ models.
- `anthropic-tool-use` — forced single-tool schema for older Claude and all Bedrock.
- `openai-json-schema-strict` — `json_schema` response format (non-strict flag, then local Zod validation) for OpenAI-family models the catalog marks as supporting response schema.
- `unstructured` (prose) — the safe fallback for any model not known to support schema output; routes the review stage to the prose pipeline ([`pipeline.md`](pipeline.md) §3).

Array-rooted schemas are wrapped as `{ items: [...] }` and transparently unwrapped (providers require an object root). Model output always passes through the JSON-recovery + Zod-validation boundary; a failure throws a typed `StructuredOutputError`. Detail: ADR [`0003`](../adr/0003-unstructured-review-dialect.md).
- ⚠ Post-refactor: the two JSON-recovery ladders are merged into one `llm/boundary`, and the loose→strict normalization is one path (`concept/03` §4). Behavior (what parses) is preserved; the code is unified.

### Cost & retries
Token usage is accumulated per run with per-provider cache-token semantics; cost is computed from the configured per-million prices and per-provider cache multipliers. Missing usage falls back to a character-based estimate.
- ⚠ Correction (F-24): transient-error retry is consistent across providers (today Anthropic retries 3×, OpenAI-compatible 0×, Bedrock relies on the AWS default). The shared retry policy lives in `kernel/retry`.

## B. Forge integrations

Both forges post a **summary comment** (marker-based upsert) plus **inline findings**, and can block CI. Posting behavior is preserved by the refactor; only the shared code is extracted into `forges/core`.

### GitHub
- **Summary comment:** single comment identified by the marker `<!-- qualops-analysis-comment -->`, updated in place or created. Status = FAILED (critical/high) / WARNINGS (medium) / PASSED. Per-severity display caps (critical 10 / high 5 / medium 3).
- **Inline findings:** posted as **Checks API annotations** (one check run), capped at `maxInlineComments` (default 50, GitHub's hard limit), severity-prioritized; conclusion `failure` (critical/high) / `neutral` (medium) / `success`. Annotations are per-run (regenerated each run), not resolvable threads.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` exits non-zero.
- API client retries transient errors (rate-limit/timeout/503) up to 3× with backoff.

### GitLab
- **Summary comment:** same marker; upsert with 3× retry and 404→create fallback; all text sanitized and secrets redacted.
- **Inline findings:** posted as **resolvable discussions** with a text position, filtered to `report.includedSeverities` (default critical/high/medium) **and** to lines actually changed in the MR diff.
- **Cross-run dedup:** an issue is skipped if an *unresolved* discussion already exists at the same `file:line`.
- **Gating:** with `blockPipeline`, `critical>0 || high>0` **or** a failed judge decision exits non-zero.

### Known limitations (addressed in a later functional phase, not this refactor)
These are **not** changed by the refactor; they are the motivation for the future fingerprint-based posting protocol (`concept/02` §7):
- GitLab dedup key is content-agnostic `file:line` (two distinct findings on one line collide; a resolved-but-unfixed finding can be re-posted on the next run; line drift across pushes duplicates).
- GitHub inline findings are ephemeral annotations with no resolution semantics.

### Deviations to fix in this refactor
- ⚠ **Config location (bucket B):** GitHub reads `.qualops/.qualopsrc.json` while GitLab reads `.qualopsrc.json` at the repo root — unify to the single configured path.
- ⚠ **Report source (bucket A/B):** GitHub uses the latest session's `review-summary.json`; GitLab aggregates all sessions — pick one consistent behavior.
- ⚠ Forge comment formatting (`getStatusText`, `formatIssuesByType`, `generateCommentFromResults`) and the `QualOpsResult` shape are duplicated across both integrations → single home in `forges/core` (`concept/03` §5).
