# specs/

Approved, refined specifications — the source of truth for implementation.

**Flow:** `concept/ → specs/ → implementation → docs/`. A `concept/` document is exploratory and may be rejected or conflict with others. Once agreed, it is rewritten here as a **gap-free, concise, aligned** spec. Implementation follows the spec precisely; shipped behavior (and only shipped behavior) is then described in `docs/`.

A spec here is binding. If reality and a spec diverge, one of them is wrong — fix the spec first, then the code. Engineering rules that apply across all specs are in [`../CLAUDE.md`](../CLAUDE.md) / [`../AGENTS.md`](../AGENTS.md).

## What these specs describe

They define the **baseline**: the codebase as it will be after the structure & cleanup refactor — the current functional behavior, restructured and cleaned, with the committed correctness fixes. This is deliberately **not** the functional redesign (verifier, fingerprint identity, folder-config, AI-SDK swap), which is still in `concept/` and will graduate spec-by-spec as it is built. Getting the baseline in sync with the code first is the point.

## Index

| Spec | Scope |
|---|---|
| [architecture.md](architecture.md) | Post-refactor module structure, layering, ports, conventions, structural budget |
| [contracts.md](contracts.md) | The unified type & validation system (Zod-first, one definition per concept) |
| [behavior/pipeline.md](behavior/pipeline.md) | Pipeline behavior: stages, the three review dialects, gate; refactor acceptance list |
| [behavior/configuration.md](behavior/configuration.md) | Config file, CLI, GitHub Action, env vars, custom-agent mechanism |
| [behavior/integrations.md](behavior/integrations.md) | AI providers & dialects; GitHub/GitLab posting behavior |
| [quality.md](quality.md) | Testing, coverage, error handling, logging, security, dependency standards |
| [plans/refactor.md](plans/refactor.md) | The structure & cleanup refactor plan (PR-stack order, defect buckets, exit criteria) |
| [adr/](adr/README.md) | Decision records (0001–0004; 0004 superseded by the harness decision) |

## Reading order

New to the project: `architecture.md` → `behavior/pipeline.md` → the other `behavior/` specs → `contracts.md` → `quality.md`. Implementing the refactor: `plans/refactor.md` first, with the above as the target contract.
