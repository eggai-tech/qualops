# Spec — Security

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: quality · Overview: [README.md](README.md)

- Treat all PR-derived text (titles, bodies, comments, diffs) and all model output as **untrusted**: sanitize before prompt assembly, never `eval`/execute it, always path-guard file access (`kernel/path-safety`).
- Tool and shell execution runs only through the sandbox with skip-pattern enforcement, secret redaction, and output limits. A model backend's built-in tools are never enabled — QualOps owns its tools ([`../architecture.md`](../architecture.md) §3).
- No secrets in source, logs, artifacts, or test fixtures. Secrets come from env only, read solely in `platform/env`.
