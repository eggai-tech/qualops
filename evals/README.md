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

# With presets
node evals/src/run-eval.js --preset=thorough --source=crb
node evals/src/run-eval.js --preset=fast --dataset=qualops/crb-sentry
node evals/src/run-eval.js --preset=security --source=crb --no-judge

# Direct invocation with options (override preset values)
node evals/src/run-eval.js --source=all --limit=5
node evals/src/run-eval.js --dataset=qualops/crb-sentry --mode=agentic --no-judge
node evals/src/run-eval.js --model=claude-opus-4-20250514 --concurrency=2

# List available presets
node evals/src/run-eval.js --list-presets
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--preset` | `default` | Named config preset from `evals/qualopsrc/` |
| `--source` | `qualops` | Dataset source: `qualops`, `crb`, `all` |
| `--dataset` | — | Specific Langfuse dataset name (overrides `--source`) |
| `--mode` | from preset | Review mode: `file-by-file`, `agentic`, `pipeline` |
| `--model` | from preset | Model to use (overrides preset) |
| `--provider` | `anthropic` | AI provider: `anthropic`, `openai`, `bedrock` |
| `--limit` | all | Max items per dataset |
| `--concurrency` | `3` | Parallel review workers |
| `--no-judge` | off | Skip LLM judge scorer |
| `--experiment` | auto-generated | Custom experiment name |
| `--list-presets` | — | Show available presets and exit |

## Viewing results

Results are tracked in Langfuse as dataset runs. Each eval item creates a trace with scores attached. View experiments and compare runs at your Langfuse dashboard.

Run logs are written locally to `evals/logs/<experiment>.json` with error/warning breakdowns.

## Presets

Presets are full `.qualopsrc.json` config files stored in `evals/qualopsrc/`. When a preset is selected, the eval runner loads it via `ConfigService.setConfigPath()`, replacing the default config for that run. This means every setting QualOps supports — model, pipeline jobs, subagents, validation, system prompts, confidence thresholds — can vary between eval runs.

| Preset | Model | Turns | Budget | Context | Subagents | Validation |
|--------|-------|-------|--------|---------|-----------|------------|
| `default` | from `.qualops/.qualopsrc.json` | 15 | — | auto | security, dependency, breaking-change | on |
| `fast` | sonnet 4.6 | 15 | $2 | diff-only | security only | off |
| `sonnet-agentic` | sonnet 4.6 | 50 | $5 | auto | all | on |
| `thorough` | opus 4.6 | 100 | $10 | full | all | on (minConf: 5) |
| `security` | sonnet 4.6 | 80 | $8 | full | security + dependency | on (minConf: 5) |

CLI flags override preset values: `--preset=fast --model=claude-opus-4-20250514` uses the fast config but swaps the model.

### Creating a new preset

1. Copy an existing preset or the default config as a starting point:
   ```bash
   cp evals/qualopsrc/fast.json evals/qualopsrc/my-experiment.json
   ```

2. Edit the config. Key sections to tune:

   ```jsonc
   {
     "ai": {
       "reviewStage": {
         "provider": "anthropic",        // anthropic | openai | bedrock
         "model": "claude-sonnet-4-20250514"
       }
     },
     "review": {
       "minConfidence": 7,               // lower = more findings reported
       "validation": { "enabled": true }, // self-review pass to filter noise
       "deduplication": { "enabled": true },
       "pipeline": [{
         "name": "myJob",
         "enabled": true,
         "mode": "agentic",
         "agentic": {
           "maxTurns": 50,               // agent conversation turns
           "maxBudgetUsd": 5.0,          // cost cap per item
           "contextMode": "full",        // full | diff | auto
           "enabledSubagents": [          // which specialist agents to use
             "security-analyzer",
             "dependency-tracer",
             "breaking-change-detector"
           ],
           "systemPrompt": "..."         // optional custom instructions
         }
       }]
     }
   }
   ```

3. Run it:
   ```bash
   node evals/src/run-eval.js --preset=my-experiment --source=crb
   ```

### Comparing configurations

Each preset run creates a separate Langfuse experiment with the preset name in it (e.g. `fast:claude-sonnet-4-20250514:agentic:2026-03-25T10:00`). To compare two configurations:

1. Run both against the same dataset:
   ```bash
   node evals/src/run-eval.js --preset=fast --source=crb
   node evals/src/run-eval.js --preset=thorough --source=crb
   ```

2. Compare in Langfuse: open the dataset, select both runs, and compare scores side-by-side. Key metrics:
   - **crb_recall** — did the config find the known issues?
   - **crb_precision** — how much noise did it produce?
   - **crb_f1** — overall balance

3. Check local run logs for cost and error differences:
   ```bash
   cat evals/logs/fast_*.json | jq '.totals, .errorBreakdown'
   cat evals/logs/thorough_*.json | jq '.totals, .errorBreakdown'
   ```

Typical comparisons:
- **Model A vs Model B**: same preset, override model with `--model=...`
- **Fast vs thorough**: measures how much extra turns/budget improves recall
- **With vs without validation**: toggle `validation.enabled` to see noise impact
- **Subagent combinations**: enable/disable specific subagents to measure their contribution
- **Confidence thresholds**: lower `minConfidence` for more findings, higher for less noise

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

Each eval run writes a structured JSON log to `evals/logs/`:

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
