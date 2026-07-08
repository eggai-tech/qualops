# specs/

Approved, refined specifications — the source of truth for implementation.

**Flow:** `concept/ → specs/ → implementation → docs/`. A `concept/` document is exploratory and may be rejected or conflict with others. Once agreed, it is rewritten here as a **gap-free, concise, aligned** spec. Implementation follows the spec precisely; shipped behavior (and only shipped behavior) is then described in `docs/`.

A spec here is binding. If reality and a spec diverge, one of them is wrong — fix the spec first, then the code.

## Index

| Spec | Status | Derived from |
|---|---|---|
| [plans/refactor.md](plans/refactor.md) | Approved 2026-07-08 | `concept/03-architecture-spec.md`, `concept/06-roadmap.md` Phase 0–1, `concept/appendix/A` |

## Decision records

Architecture/decision records that back these specs live in `concept/appendix/D-spike-analysis.md`, `concept/08-harness-decision.md` (harness backbone), and `docs/tdr/` (to migrate to `specs/adr/`).
