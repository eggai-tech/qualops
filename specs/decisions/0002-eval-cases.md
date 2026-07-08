# Decision 0002 — Real-PR "slice" eval cases

**Status:** Draft — 2026-05-08 · **Normative spec:** [`../evaluation/eval-cases.md`](../evaluation/eval-cases.md)

## Context

When a developer spots a bug QualOps missed, there was no fast path to turn it into a regression test: the synthetic dataset needed hand-built file content + diff, and a CRB case needed a full repo clone at a commit. Real misses went unrecorded, so QualOps did not learn from them.

## Decision

A "slice" eval case: a self-contained directory (`slice.json` + `prompt/` + `repo/`) that acts as a minimal repo substitute, runnable end-to-end through the existing harness (agentic tools included) without full repo history, and scored for recall automatically. Full data contract: the normative spec.

## Alternatives considered

- **Extend the synthetic JSONL dataset** — rejected: hand-constructing file content + diff is slow and unfaithful.
- **Full CRB case per miss** — rejected: cloning the whole repo at a commit is too heavy for a single bug.
- **Automatic capture tooling** — deferred: manual capture is fast enough (<5 min) and keeps the format simple.

## Consequences

Reuses existing dataset slots (`diff`, `repo_path`, no `head_sha`); a dedicated `qualops/inbox` dataset; recall baseline starts at 0 per case (improvement is the signal). `falsePositives[]` recorded for later precision analysis but not scored. Status is Draft: the format is agreed, harness wiring is partially implemented (one slice validated end-to-end).
