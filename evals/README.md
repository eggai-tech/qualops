# QualOps Eval Suite

Evaluates QualOps review quality against annotated code samples using [Langfuse](https://langfuse.com) for experiment tracking, scoring, and comparison.

## Setup

1. `.env` in the qualops root with:
   - `ANTHROPIC_API_KEY` (required)
   - `QUALOPS_LANGFUSE_SECRET_KEY`, `QUALOPS_LANGFUSE_PUBLIC_KEY` (required)
   - `QUALOPS_LANGFUSE_BASE_URL` (optional, defaults to `https://cloud.langfuse.com`)
   - `OPENAI_API_KEY` (optional, for dual-judge scoring)

2. Upload datasets to Langfuse:
   ```bash
   npm run eval:upload:all
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
npx tsx evals/src/run-eval.ts --preset=thorough --source=crb
npx tsx evals/src/run-eval.ts --preset=fast --dataset=qualops/crb-sentry
npx tsx evals/src/run-eval.ts --preset=security --source=crb --no-judge

# Direct invocation with options (override preset values)
npx tsx evals/src/run-eval.ts --source=all --limit=5
npx tsx evals/src/run-eval.ts --dataset=qualops/crb-sentry --mode=agentic --no-judge
npx tsx evals/src/run-eval.ts --model=claude-opus-4-20250514 --concurrency=2

# List available presets
npx tsx evals/src/run-eval.ts --list-presets
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
   npx tsx evals/src/run-eval.ts --preset=my-experiment --source=crb
   ```

### A/B testing configurations

Compare two (or more) QualOps configs on the same dataset to see how a change affects **quality**
(precision / recall / F1) and **cost/latency** — the "which config gives the best results per dollar"
question. The `eval:ab` harness runs each config arm and prints a side-by-side comparison.

Config files are passed with repeatable `--config=<path>` (same flag name as the qualops CLI). By
default it runs the **full** dataset once per arm; scope it with the same flags as a normal eval run:

```bash
# Full suite, 1 run per arm, then compare
npm run eval:ab -- --config=.qualops/.qualopsrc.json --config=.qualops/.qualopsrc-cheap.json

# Scope it: 5 items, 3 repeats per arm, on a specific dataset
npm run eval:ab -- --config=A.json --config=B.json --dataset=qualops/crb-grafana --limit=5 --repeats=3

# More than two arms (one column each) — e.g. opus vs sonnet vs haiku configs
npm run eval:ab -- --config=a.json --config=b.json --config=c.json
```

| Flag | Default | Meaning |
|---|---|---|
| `--config=<path>` (repeatable) | — | The config arms to compare (≥2). |
| `--dataset=<name>` | `qualops/crb-sentry` | Dataset to run each arm on. |
| `--limit=<N>` | all items | Cap items per run (quick checks). |
| `--repeats=<N>` | 1 | Runs per arm (≥3 to beat run-to-run noise). |

Each arm runs the **exact pipeline defined in its config file** — the harness never passes `--mode`,
so model, budgets, prompts, subagents, and mode all come from the config. Make configs that differ
only in the knob you're testing (e.g. `ai.reviewStage.model`) to isolate its effect. `--config=<path>`
accepts any repo-relative `.json` (validated: inside the repo, `.json`, exists), so you can A/B real
ship configs like `.qualops/.qualopsrc.json` with **no copy to drift**. `npm run eval:ab` loads `.env`
for provider keys.

**Reading the output.** `compare-experiments` prints a metric × arm table (one column per arm), plus a
`Δ` column and a held-or-up/regressed verdict when exactly two arms are compared. It surfaces **mean
ms/item** so a quality gain can be weighed against its cost:

```
metric       │  arm A    │  arm B    │  arm C
precision    │  0.250    │  0.300    │  0.200
recall       │  0.410    │  0.410    │  0.300
f1           │  0.300    │  0.340    │  0.240
mean ms      │  140000   │  40000    │  15000
```

**Re-compare without re-running.** Every run writes `evals/logs/<experiment>-<timestamp>.json`, labelled
by config basename. Compare existing logs directly (each `--eval-log` is a file path or experiment-label
prefix, latest match used):

```bash
npm run eval:ab:compare -- --eval-log=qualopsrc --eval-log=qualopsrc-cheap
```

Typical comparisons:
- **Model A vs Model B**: two configs differing only in `ai.reviewStage.model` (per-stage model cost/quality).
- **Fast vs thorough**: how much extra turns/budget improves recall.
- **With vs without validation**: toggle `validation.enabled` to see noise impact.
- **Subagent combinations**: enable/disable specific subagents to measure their contribution.
- **Confidence thresholds**: lower `minConfidence` for more findings, higher for less noise.

> **Caveats.** Small N is noisy — use `--repeats>=3` (full dataset) before concluding. Precision/recall/F1
> come from the CRB scorer and only populate for CRB datasets (`qualops/crb-*`); other datasets still give
> cost and issue counts.

## Review modes

| Mode | What it exercises | Use case |
|------|-------------------|----------|
| `file-by-file` | Single LLM call per file via FileReviewer | Fast model comparison on single-file diffs |
| `agentic` | Multi-turn Claude Agent SDK with tools (Read, Grep, Glob, find_usages) | Cross-file analysis with full repo context |
| `pipeline` | Full PipelineExecutor: multi-pass, validation, dedup | End-to-end pipeline quality |

Agentic mode uses the pre-extracted slice under `evals/datasets/crb/<id>/repo/` as the working directory so tools read the right files. If the slice path is missing it falls back to the qualops root and logs a `REPO_NOT_FOUND` warning.

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

Each eval is a self-contained slice directory at `evals/datasets/crb/<id>/` containing:
- `slice.json` — metadata, diff, and expected findings
- `repo/` — the source files at the PR's head commit, for agentic tool access

To check whether upstream CRB has added new benchmark PRs:
```bash
npm run eval:crb:check-staleness
```

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
  "warningBreakdown": { "REPO_NOT_FOUND": 1 },
  "entries": [ ... ]
}
```

Error codes: `RATE_LIMITED`, `AUTH_FAILED`, `TIMEOUT`, `BUDGET_EXHAUSTED`, `PARSE_ERROR`, `NETWORK_ERROR`, `API_ERROR`

Warning codes: `NO_REPO_PATH`, `REPO_NOT_FOUND`, `CHECKOUT_FAILED`

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
| `eval:crb:check-staleness` | Check if upstream CRB has new benchmark PRs |
| `eval:upload:all` | Upload all datasets to Langfuse |
| `eval:upload:qualops` | Upload qualops dataset only |
| `eval:upload:crb:all` | Upload all CRB per-repo datasets |
| `test:evals` | Run eval unit tests |
