# researches/

Point-in-time research reports, one folder per topic. These are **background evidence** — dated snapshots of external research and analysis that inform decisions. They are not binding.

How this differs from the other doc trees:

| Folder | Holds | Binding? |
|---|---|---|
| `researches/` | dated research reports & source dossiers (this folder) | no — evidence |
| `concept/` | exploratory design ideas, may be rejected | no — proposals |
| `specs/` | approved, gap-free specifications | yes — source of truth |
| `website/` | shipped-behavior user documentation | — |

A research report may feed a `concept/` document, which (once agreed) graduates into `specs/`.

## Index

| Topic | Report | Fed into |
|---|---|---|
| [agent-evaluation](agent-evaluation/README.md) | Evaluating & improving LLM agents — the three-layer model, two-tier eval cadence, and the QualOps approach (main report + 4 source dossiers + diagrams) | `concept/05-quality-spec` and `specs/quality/`, `specs/evaluation/eval-cases.md` |

## Conventions

- One folder per research topic; a `README.md` inside each is its entry point.
- Reports are dated and treated as immutable snapshots — supersede with a new report rather than rewriting.
- Migrated from PR #149 (`agent-evaluation-research`).
