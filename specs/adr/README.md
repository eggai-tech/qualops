# Architecture Decision Records (ADRs)

This folder holds Architecture Decision Records for QualOps — short documents that capture a significant technical decision, the alternatives considered, and the rationale. (Formerly "TDRs"; renamed to ADR to match the `specs/` vocabulary. Existing files keep their numbers.)

## Numbering

ADRs are numbered sequentially from `0001`, zero-padded to four digits. Use the next available number when adding one.

## Filename format

`NNNN-short-kebab-title.md` (e.g. `0001-release-process.md`).

## Suggested structure

- **Status** — Proposed / Accepted / Superseded (and by which ADR/decision, if applicable), plus the date.
- **Context** — the problem and why now.
- **Decision** — the chosen approach, concrete enough to implement.
- **Alternatives considered** — the rejected options and why.
- **Consequences** — what changes for contributors, consumers, and operations.

ADRs are immutable once accepted. If a later decision changes things, write a new ADR (or add a superseded-by banner) rather than rewriting the body.

## Index

- [0001 — Release process](./0001-release-process.md) — Accepted
- [0002 — Evals from real PRs](./0002-evals-from-real-prs.md) — Draft
- [0003 — Unstructured review dialect](./0003-unstructured-review-dialect.md) — Accepted
- [0004 — OpenAI-compatible agentic adapter](./0004-openai-compat-adapter-with-agent-loop.md) — **Superseded** by the harness-backbone decision ([`../../concept/08-harness-decision.md`](../../concept/08-harness-decision.md): Vercel AI SDK)

The harness-backbone decision itself lives in `concept/08-harness-decision.md` (it will graduate into an ADR here once implementation begins).
