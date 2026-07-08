# Spec — Intake stage (analyze)

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: pipeline · Overview: [README.md](README.md)

Determines the set of files to review.

## Behavior

- With `--files`, those paths are used verbatim (glob-expanded).
- Otherwise the git diff `base..head` (base default `main`) yields the changed files.
- Non-existent files are skipped; the extract log dedupes unchanged files by content hash.

## Contract

| | |
|---|---|
| **In** | git refs or `--files`; `extract-log.json`; working tree |
| **Out** | `analysis.json` — `{ timestamp, filePaths[], executionTime, gitRefs? }` |
| **Depends on** | — |
