# Spec — GitHub Action & environment variables

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: configuration · Overview: [README.md](README.md)

## GitHub Action (`action.yml`)

Composite action (Node 20).

| Inputs | Required | Default |
|---|---|---|
| `anthropic-api-key` | ✓ | — |
| `github-token` | – | `${{ github.token }}` |
| `config-path` | – | `.qualops/.qualopsrc.json` |
| `stages` | – | `analyze,review,judge,report` |
| `base-ref` | – | — |
| `files` | – | — |

**Outputs:** `total-issues`, `critical-issues`, `high-issues`, `quality-passed`.

- **Consistency note:** the Action's default `stages` omits `fix`, while the CLI default `all` includes it (auto-dropped without `fixStage`). Intentional, not a bug.

## Environment variables

| Group | Variables |
|---|---|
| Secrets / creds | `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `AWS_REGION`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`, `GITHUB_API_KEY` |
| Quality-gate thresholds | `QUALOPS_MAX_CRITICAL/HIGH/MEDIUM/LOW`, `QUALOPS_FAIL_ON_MEDIUM/LOW`, `QUALOPS_MIN_QUALITY_SCORE` |
| Feature flags | `QUALOPS_ENABLE_REACT`, `QUALOPS_SKIP_CACHE`, `DEBUG`, `VERBOSE`/`QUALOPS_VERBOSE`, `USE_CONSOLIDATED_REVIEW` |
| Perf / paths | `QUALOPS_MAX_FILES*`, `QUALOPS_TIMEOUT_SECONDS`, `QUALOPS_SESSIONS_DIR`, `QUALOPS_CACHE_DIR`; misc `NODE_ENV`, `QUALOPS_AI_TEMPERATURE`, `QUALOPS_BASE_BRANCH` |
| CI / forge | the `GITHUB_*` and GitLab `CI_*` / `GITLAB_*` families (read in integrations) |
| Observability | `LANGFUSE_*`, `OTEL_EXPORTER_OTLP_ENDPOINT` |

- ⚠ Correction (F-4): the quality-gate thresholds also become expressible in the config file; env remains an override. Gate logic: [`../pipeline/gate.md`](../pipeline/gate.md).
- ⚠ Post-refactor: all `process.env` reads are centralized in `platform/env` (scattered today). No new env vars; same names. See [`../../architecture.md`](../../architecture.md) §1.
