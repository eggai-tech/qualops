# Provider-dialect smoke

A real-API Jest spec for the 4 AI caller stages migrated in PR #145
(`file-reviewer`, `validation-resolver`, `dedup-resolver`,
`root-cause-extract`). Runs each stage through each real provider
(`anthropic`, `openai`, `bedrock`, `github`) using a slice fixture as input.
Validates plumbing only — the structured-output dialect path returns a
zod-validated response without throwing. Output quality is out of scope and
covered by the deferred per-stage golden-evals follow-up.

This spec is **not** part of the default `npm test` run. The base
`jest.config.js` constrains `roots` to `tests/unit/`, so this file is
unreachable from `npm test`. It runs under its own config,
`jest.smoke.config.ts`, via `npm run test:smoke`.

## Architecture

- **Test runner**: Jest (own config; not picked up by unit or integration lanes).
- **Provider configuration**: per-provider temp `.qualopsrc.json` written to
  `tests/smoke/.tmp/` and loaded via `ConfigService.setConfigPath()`. Pricing
  + model defaults come from `PROVIDER_DEFAULTS` in `src/config/config.ts`
  (with one inline default for GitHub Models, which is not in that table).
  Stage classes are obtained via `AIFactory.createForStage('review')` — same
  path that production code uses; no direct provider instantiation.
- **Input**: slice fixture at
  `evals/datasets/inbox/smoke-sql-injection/` (slice.json + repo/ tree),
  loosely following [TDR 0002](../../docs/tdr/0002-evals-from-real-prs.md).
- **Skip vs fail**: a provider whose credential env var is missing is marked
  `describe.skip` at module load — the entire 4-stage block is statically
  skipped in the test report. A provider with present-but-malformed
  credentials is attempted; the provider class's own `validateApiKey()` /
  `validateConfiguration()` throws, surfacing as a failed test with a real
  error.

## Run

```bash
npm run test:smoke
```

The CI workflow exports `--json --outputFile=smoke-result.json` to capture
the test results as an artifact.

## Env vars

| Provider | Env vars |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL` for Azure / proxies) |
| `bedrock` | `AWS_REGION` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| `github` | `GITHUB_API_KEY` (a `ghp_…`, `github_pat_…`, etc. PAT — **not** `GITHUB_TOKEN`) |

In CI, every entry above corresponds to a GitHub Actions repo secret of the
same name (e.g. `secrets.ANTHROPIC_API_KEY`). The `ANTHROPIC_API_KEY` secret
already exists in the repo (used by `ci.yml`); the others must be added
before their providers contribute non-skip coverage in the nightly run.

## CI

`.github/workflows/provider-dialect-smoke.yml` — manual `workflow_dispatch`
and nightly cron at 03:17 UTC. Gated on API-key repository secrets. **Not**
part of PR-blocking CI.

## Notes on `root-cause-extract`

The stage swallows provider errors internally and returns synthetic
`{rootCause: 'other', confidence: 0}` classifications for every input issue.
A naïve "did the function throw" assertion would always pass even when the
API call silently failed. The spec cross-checks
`AIFactory.createForStage('review').getTokenStats()` and the classification
distribution to detect this case and surface it as a failure.
