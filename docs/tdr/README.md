# Technical Design Records

This folder holds Technical Design Records (TDRs) for qualops — short documents that capture significant technical decisions, the alternatives considered, and the rationale.

## Numbering

TDRs are numbered sequentially starting at `0001`, zero-padded to four digits. Use the next available number when adding a new TDR.

## Filename format

`NNNN-short-kebab-title.md` (for example, `0001-release-process.md`).

## Suggested structure

Each TDR should include:

- **Status** — Proposed / Accepted / Superseded (and by which TDR if applicable), plus the decision date.
- **Context** — what problem are we solving and why now.
- **Decision** — the chosen approach, described concretely enough to implement.
- **Alternatives considered** — at least one or two options that were rejected, with the reason.
- **Consequences** — what changes for contributors, consumers, and operations after this decision lands.
- **Implementation notes** — optional pointers to the workflow files, scripts, or docs that the TDR drove.

TDRs are immutable once accepted. If a future decision changes things, write a new TDR that supersedes the old one rather than editing it in place.

## Index

- [0001 — Release process](./0001-release-process.md)
- [0002 — Evals from real PRs](./0002-evals-from-real-prs.md)
- [0003 — Unstructured review dialect](./0003-unstructured-review-dialect.md)
- [0004 — OpenAI-compatible agentic adapter](./0004-openai-compat-adapter-with-agent-loop.md)
- [0005 — Intent-based agentic review (rejected)](./0005-agentic-issue-verification.md)
