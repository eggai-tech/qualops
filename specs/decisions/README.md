# Decisions

Decision records: **why** a choice was made (context, alternatives, consequences). The **what** (the resulting contract) lives in the domain specs — each record links to its spec. Records are lean and immutable; a later decision supersedes rather than rewrites.

This replaces the former flat `specs/adr/`: normative content moved into domain specs; the rationale stays here.

| # | Decision | Status | Normative spec |
|---|---|---|---|
| [0001](0001-release-process.md) | Two-tier beta/stable release model | Accepted (2026-05-11) | [`operations/release.md`](../operations/release.md) |
| [0002](0002-eval-cases.md) | Real-PR "slice" eval-case format | Draft (2026-05-08) | [`evaluation/eval-cases.md`](../evaluation/eval-cases.md) |
| [0003](0003-review-dialects.md) | Prose dialect for schema-less models | Accepted (2026-06-09) | [`behavior/pipeline/review-dialects.md`](../behavior/pipeline/review-dialects.md) |
| [0004](0004-agent-backbone.md) | Agent-loop backbone | **Superseded** (2026-07-08) | [`../../concept/08-harness-decision.md`](../../concept/08-harness-decision.md) |
| [0005](0005-intent-based-agentic-review.md) | Intent-based agentic review (plan→execute→aggregate→critique) | **Rejected** (2026-07-02) | [`../behavior/pipeline/review.md`](../behavior/pipeline/review.md) |

## Format

Each record: **Context** (why, briefly) · **Decision** · **Alternatives considered** (with the reason rejected) · **Status** · **Normative spec** (where the contract now lives). Keep it short; the contract detail belongs in the spec, not here.
