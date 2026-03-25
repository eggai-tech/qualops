# QualOps Eval Suite

Evaluates QualOps review quality against annotated code samples using [Langfuse](https://langfuse.com) for experiment tracking, scoring, and comparison.

## Setup

1. `.env` in the qualops root with:
   - `ANTHROPIC_API_KEY` (required)
   - `LANGFUSE_SECRET_KEY`, `LANGFUSE_PUBLIC_KEY` (required)
   - `LANGFUSE_BASE_URL` (optional, defaults to `https://cloud.langfuse.com`)
   - `OPENAI_API_KEY` (optional, for dual-judge scoring)

2. Fetch and upload datasets:
   ```bash
   npm run eval:fetch:crb          # fetch CRB golden comments + clone source repos
   npm run eval:upload:all          # upload all datasets to Langfuse
   ```

## Running evals

```bash
# QualOps native dataset (file-by-file mode)
npm run eval:run:qualops

# All CRB repos (agentic mode)
npm run eval:run:crb:all

# Single CRB repo
npm run eval:run:crb:sentry
npm run eval:run:crb:grafana
npm run eval:run:crb:calcom
npm run eval:run:crb:discourse
npm run eval:run:crb:keycloak

# Direct invocation with options
node evals/langfuse/run-eval.js --source=all --limit=5
node evals/langfuse/run-eval.js --dataset=qualops/crb-sentry --mode=agentic --no-judge
node evals/langfuse/run-eval.js --model=claude-opus-4-20250514 --concurrency=2
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--source` | `qualops` | Dataset source: `qualops`, `crb`, `all` |
| `--dataset` | — | Specific Langfuse dataset name (overrides `--source`) |
| `--mode` | `file-by-file` | Review mode: `file-by-file`, `agentic`, `pipeline` |
| `--model` | `claude-sonnet-4-20250514` | Model to use |
| `--provider` | `anthropic` | AI provider: `anthropic`, `openai`, `bedrock` |
| `--limit` | all | Max items per dataset |
| `--concurrency` | `3` | Parallel review workers |
| `--no-judge` | off | Skip LLM judge scorer |
| `--experiment` | auto-generated | Custom experiment name |

## Viewing results

Results are tracked in Langfuse as dataset runs. Each eval item creates a trace with scores attached. View experiments and compare runs at your Langfuse dashboard.

Run logs are written locally to `evals/langfuse/logs/<experiment>.json` with error/warning breakdowns.

## Review modes

| Mode | What it exercises | Use case |
|------|-------------------|----------|
| `file-by-file` | Single LLM call per file via FileReviewer | Fast model comparison on single-file diffs |
| `agentic` | Multi-turn Claude Agent SDK with tools (Read, Grep, Glob, find_usages) | Cross-file analysis with full repo context |
| `pipeline` | Full PipelineExecutor: multi-pass, validation, dedup | End-to-end pipeline quality |

Agentic mode checks out the target repo at the PR's head commit so tools read the right codebase. If the repo isn't cloned, it falls back to the qualops root and logs a `REPO_NOT_CLONED` warning.

## Datasets

### QualOps native (`evals/datasets/*.jsonl`)

Hand-annotated code samples with known issues. Each line:

```json
{
  "id": "sql-injection-1",
  "language": "typescript",
  "filePath": "src/api/users.ts",
  "diff": "@@ -10,6 +10,12 @@ ...",
  "fullContent": "import ...",
  "expected": [
    { "line": 6, "type": "security", "severity": "critical", "category": "security", "description": "SQL injection" }
  ]
}
```

### Code Review Bench — CRB (`evals/datasets/crb/`)

50 PRs across 5 repos from the [Code Review Benchmark](https://github.com/withmartian/code-review-benchmark):

| Repo | Language | PRs |
|------|----------|-----|
| sentry | Python | 10 |
| grafana | Go | 10 |
| cal.com | TypeScript | 10 |
| discourse | Ruby | 10 |
| keycloak | Java | 10 |

Each repo has a `.jsonl` file with PR diffs, golden comments, and git metadata. Source repos are shallow-cloned to `evals/datasets/crb/repos/` for agentic tool access.

Fetch with: `npm run eval:fetch:crb`

Options: `--repo=sentry`, `--limit=3`, `--skip-repos`

## Scoring

### QualOps dataset scorers

| Scorer | What it measures |
|--------|-----------------|
| `parse` | Output is valid JSON with required fields |
| `line_accuracy` | Line IoU between detected and reference issue locations |
| `coverage` | Recall — fraction of expected issues detected (±3 line tolerance) |
| `severity` | Severity match rate on matched pairs |
| `judge` | LLM-judged quality score (dual Sonnet+GPT with single-judge fallback) |

### CRB dataset scorers

| Scorer | What it measures |
|--------|-----------------|
| `parse` | Output is valid JSON with required fields |
| `crb_recall` | Fraction of golden comments matched by detected issues (USE THIS PRIMARILY)|
| `crb_precision` | Fraction of detected issues semantically matching golden comments (penalizes qualops for finding issues that humans have not found) |
| `crb_f1` | Harmonic mean of CRB precision and recall |

CRB scoring uses a pairwise LLM judge for semantic matching (golden comments have no line numbers).

## Run logs

Each eval run writes a structured JSON log to `evals/langfuse/logs/`:

```json
{
  "experiment": "claude-sonnet-4-20250514:agentic:2026-03-24T15:31",
  "totals": { "items": 10, "successes": 8, "errors": 1, "warnings": 1 },
  "errorBreakdown": { "TIMEOUT": 1 },
  "warningBreakdown": { "REPO_NOT_CLONED": 1 },
  "entries": [ ... ]
}
```

Error codes: `RATE_LIMITED`, `AUTH_FAILED`, `TIMEOUT`, `BUDGET_EXHAUSTED`, `PARSE_ERROR`, `NETWORK_ERROR`, `API_ERROR`

Warning codes: `NO_REPO_PATH`, `REPO_NOT_CLONED`, `CHECKOUT_FAILED`

## Tests

```bash
npm run test:evals    # run eval unit tests (scorers, dataset builders, helpers)
```

## npm scripts reference

| Script | Description |
|--------|-------------|
| `eval:run:qualops` | Run qualops dataset (file-by-file) |
| `eval:run:crb:all` | Run all CRB repos (agentic) |
| `eval:run:crb:<repo>` | Run single CRB repo (agentic) |
| `eval:fetch:crb` | Fetch CRB golden comments + clone source repos |
| `eval:upload:all` | Upload all datasets to Langfuse |
| `eval:upload:qualops` | Upload qualops dataset only |
| `eval:upload:crb:all` | Upload all CRB per-repo datasets |
| `test:evals` | Run eval unit tests |
