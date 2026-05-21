# Provider-dialect smoke (QUALOPS-45)

A thin, real-API smoke harness for the 4 AI caller stages migrated in PR #145
(`file-reviewer`, `validation-resolver`, `dedup-resolver`, `root-cause-extract`).
Runs each stage through each real provider (`anthropic`, `openai`, `bedrock`,
`github`) using one tiny eval dataset entry as input. Validates plumbing only —
the structured-output dialect path returns a zod-validated response without
throwing. Output quality is out of scope; that is the deferred per-stage
golden-evals item.

Not a Jest spec. Real provider calls cost money, so this runs as a standalone
`tsx` script, gated on API-key env vars, with a dedicated CI lane.

## Run

```bash
# All four providers, defaults (first row of evals/datasets/typescript-bugs.jsonl)
npm run test:smoke

# Subset
npm run test:smoke -- --providers=anthropic,openai

# Override the model for every provider
npm run test:smoke -- --providers=anthropic --model=claude-opus-4-6

# Different input row
npm run test:smoke -- --input=evals/datasets/typescript-bugs.jsonl:2
```

## Env vars

A provider is **skipped** (warn, not fail) if its env vars are missing. A
provider whose env vars are present but malformed (e.g., `OPENAI_API_KEY` that
doesn't start with `sk-`) is **attempted** and **fails** loudly — the format
check lives in the provider class itself (`src/ai/providers/*.ts`), so a real
misconfigured CI secret surfaces as a real failure rather than being silently
hidden.

| Provider | Env vars |
|---|---|
| `anthropic` | `ANTHROPIC_API_KEY` |
| `openai` | `OPENAI_API_KEY` (+ optional `OPENAI_BASE_URL` for Azure / proxies) |
| `bedrock` | `AWS_REGION` + `AWS_ACCESS_KEY_ID` + `AWS_SECRET_ACCESS_KEY` |
| `github` | `GITHUB_API_KEY` (a `ghp_…`, `github_pat_…`, etc. PAT — **not** `GITHUB_TOKEN`) |

In CI, every entry above corresponds to a GitHub Actions repo secret of the
same name (e.g. `secrets.ANTHROPIC_API_KEY`). The `ANTHROPIC_API_KEY` secret
already exists in the repo (used by `ci.yml`); the others need to be added
before their providers contribute non-skip coverage in the nightly run.

## Output

- Exit code: `0` if every attempted stage × provider combination passed (or was
  skipped for missing credentials), `1` if any attempted call failed.
- Run log: `evals/logs/smoke_<timestamp>.json` (same format as eval run logs;
  reuses `evals/src/run-log.js` for shape + error classification).
- Cost target: under $0.20 per full 16-call run on the default tiny input.

## CI

`.github/workflows/provider-dialect-smoke.yml` — manual `workflow_dispatch` and
nightly cron at 03:17 UTC. Gated on API-key repository secrets. **Not** part of
PR-blocking CI.

## Why a standalone script, not Jest

- Default `npm test` must never make paid API calls.
- Jest `describe.skip` based on env vars is brittle and easy to misread.
- A standalone exit-coded script is the simplest contract for a cost-aware
  smoke lane.
