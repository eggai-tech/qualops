# Spec — Eval Cases (real-PR "slice" format)

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · **Owner:** TBD
**Domain:** evaluation · **Decision record:** [`../decisions/0002-eval-cases.md`](../decisions/0002-eval-cases.md) (the source ADR is itself Draft)

Defines the **data contract** for capturing a real-world review miss as a self-contained, regression-scored eval case (a "slice"). Contract only — the harness/uploader code that consumes it is implementation and out of scope.

## 1. Purpose & shape

A **slice** is a directory that acts as a minimal repo substitute: enough files, at their real repo-relative paths, for the review agent to reach the same conclusion a human reviewer did — nothing more. It runs end-to-end through the existing harness (agentic tools included) without the full repo history.

```
evals/datasets/inbox/<slug>/
├── slice.json      # metadata + expected findings (§2)
├── prompt/         # the review prompt(s) active when QualOps ran, at repo-relative paths
└── repo/           # file tree rooted here, mirroring real repo paths; acts as cwd
    └── <files at baseSha>
```

The harness uses `repo/` as `cwd` (so grep/read tool calls resolve against slice files at their original paths) and omits a head SHA (no worktree is created — the slice *is* the checkout).

## 2. `slice.json` contract

| Field | Type | Req | Purpose |
|---|---|---|---|
| `id` | string | ✓ | unique case id (used as Langfuse caseId) |
| `prUrl`, `prTitle` | string | – | human context (unused by harness) |
| `capturedAt`, `capturedBy` | string | – | provenance |
| `language` | string | ✓ | language tag passed to the reviewer |
| `baseSha` | string | ✓ | commit the `repo/` files + expected findings are based on; use the earliest pre-rebase commit so findings predate review-driven fixes |
| `reviewPromptSha` | string | ✓ | pins the exact prompt version bundled under `prompt/` |
| `reviewPromptDir` | string | ✓ | prompt location (default `prompt/`) |
| `capturedWithProvider`, `capturedWithModel` | string | – | provenance only; the eval runner uses its own preset at run time |
| `diff` | string | ✓ | unified diff of the PR (relevant hunks; may be trimmed) |
| `expected[]` | Finding-like[] | ✓ | real issues at `baseSha` QualOps should catch — the **recall target** |
| `outOfScope[]` | Finding-like[] + `reason` | – | real issues outside the prompt's scope; recorded, **not scored** |
| `falsePositives[]` | Finding-like[] + `reason` | – | confirmed false positives QualOps produced; recorded for precision/noise analysis, **not scored** |

`Finding-like` entry: `{ file, line, lineEnd, type, severity, description }` (aligns with the canonical `Finding` vocabulary in [`../contracts.md`](../contracts.md)).

## 3. Scoring (recall)

A detected issue **matches** an `expected[]` entry when **all** hold:

- **Semantic** — detected description semantically overlaps the expected description (LLM judge).
- **File** — detected file equals `expected.file`.
- **Line** — detected line ∈ `[expected.line − 5, expected.lineEnd + 5]` (the standard line-accuracy tolerance).

Scored by the existing recall scorer. Because slices are captured from *misses*, each new case starts at recall 0; improvement over time is the signal. `outOfScope[]` and `falsePositives[]` are never fed to the recall scorer.

## 4. Datasets

Slices upload to a dedicated Langfuse dataset `qualops/inbox`, separate from the synthetic `qualops` set and the large CRB sets, and individually selectable for fast iteration (optionally severity-filtered).

## 5. File-selection guidance

The goal is the context that makes the bug *findable* — not the minimum file count, not the whole repo.

| Include | Omit |
|---|---|
| Every file touched in the diff | Untouched, unrelated files in the same directory |
| Upstream deps the bug requires understanding | The full transitive import graph |
| Downstream consumers where the bug manifests | Build artifacts, lock files, generated migrations |
| Config files referenced by the changed code (if config-related) | Unrelated docs/assets |
| Architecture docs/READMEs (if the miss was a domain-knowledge gap) | — |
| Test files (if the miss is about coverage/assertions) | — |

A too-thin slice produces a *false* recall failure (missing context, not a QualOps defect) — err toward more files.

## 6. Capture workflow (contract level)

1. Create `evals/datasets/inbox/<slug>/`.
2. Export the relevant diff (trim to interesting hunks).
3. Copy the changed file(s) + the context files that make the bug visible into `repo/` at their repo-relative paths (typically 1–3 files).
4. Bundle the active prompt(s) under `prompt/`.
5. Write `slice.json` (the `diff` and `expected[]` fields are the essential ones).
6. Upload (`--source=inbox`) and run against `qualops/inbox`.

Target: under five minutes for a developer who just spotted a miss.

## 7. Intentionally excluded

- Automatic capture tooling (extension/wizard) — manual capture is fast enough.
- Upstream-PR syncing — a slice is a snapshot, not tracked.
- Precision scoring on `falsePositives[]` — recorded for analysis; a precision scorer is a separate problem ([`../quality.md`](../quality.md) references the broader eval strategy in `concept/`).
- Multi-PR cases — one PR per case; split independent misses.

## 8. Acceptance

| ID | Requirement | Verification |
|---|---|---|
| AC-EVAL-1 | A slice runs through the harness with `repo/` as `cwd`, no worktree created | one real slice runs end-to-end (reference: `evals/datasets/inbox/qualops-pr-144-bash-tool/`) |
| AC-EVAL-2 | Recall scoring matches per §3 | scorer unit test on a known slice |
| AC-EVAL-3 | `slice.json` validates against the field contract (§2) | schema validation on upload |
