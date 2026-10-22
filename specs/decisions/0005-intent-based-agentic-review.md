# Decision 0005 — Intent-based agentic review (plan → execute → aggregate → critique)

**Status:** **Rejected** — 2026-07-02 · **Normative spec:** [`../behavior/pipeline/review.md`](../behavior/pipeline/review.md) (the review pipeline stays a flat agentic pass)

## Context

False positives are the recurring complaint about QualOps. They can be framed two ways: a **filtering** problem (clean an existing finding stream with cheaper downstream levers) or a **review-architecture** problem (generation itself reasons too shallowly). This decision evaluated the second: replace the single flat agentic pass with a decompose-by-**intent** workflow — plan the PR's intents, execute each end-to-end across the files it touches, aggregate, then adversarially critique — above the provider-agnostic agent adapter.

## Decision

**Rejected on Opus 4.6.** Keep the flat agentic baseline; pursue false-positive reduction through **filtering levers** (pre-checks, richer cross-file context, a tightened verdict) rather than a review-architecture rewrite. Cost is treated as a first-class constraint, not a free variable.

## Alternatives considered

- **Intent-based redesign** (this decision) — rejected on the evidence below.
- **Filtering on the existing flat pass** — the chosen forward path; the principled sequencing lives in the concept's generate→verify pipeline ([`../../concept/02-pipeline-spec.md`](../../concept/02-pipeline-spec.md)).

## Evidence

A/B on CRB (10 cases), Opus 4.6: the intent-based `agentic-v2` was **worse** on recall (0.348 vs 0.412) and F1 (0.246 vs 0.299) at **~4× the cost**. Result scoped to Opus 4.6 — smaller models untested and could differ.

## Consequences

- `AgenticExecutorV2` is dropped (not merged; kept only on its implementation branch as reference).
- The config-A/B eval tooling built to test it (`evals/src/run-ab.ts`, `evals/src/compare-experiments.ts`) is the lasting win — see [`../../concept/10-eval-operations.md`](../../concept/10-eval-operations.md).
- Reused as empirical evidence against user-facing agent chaining (issue #71.2) in [`../../concept/09-issue-triage.md`](../../concept/09-issue-triage.md).

Full decision text with the original framing is recorded in `CHANGELOG.md` (`[Unreleased]`, "Add TDR 0005") and in git history.
