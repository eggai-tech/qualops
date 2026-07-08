# Spec — Error handling & exit codes

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: quality · Overview: [README.md](README.md)

- All failures normalize to the shared `StructuredError { code, category, recoverable, exitCode, details }` (`kernel/error`). No bare `throw new Error`, no empty `catch`, no swallowed rejections.
- **One process exit point** (`app/run`): telemetry is flushed before exit; the gate verdict drives the exit code ([`../behavior/pipeline/gate.md`](../behavior/pipeline/gate.md)). Recoverable stage failures record an `error-<stage>.json` and continue; unrecoverable ones abort after flush.

## Exit codes (stable, documented)

| Code | Meaning |
|---|---|
| 0 | success / gate passed |
| 1 | gate failed |
| 2 | configuration error |
| 3 | provider / runtime error |
