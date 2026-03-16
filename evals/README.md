# QualOps Eval Suite

Evaluates QualOps review quality against annotated code samples with known issues.

## Setup

Requires `.env` in the qualops root with `ANTHROPIC_API_KEY` (and optionally `OPENAI_API_KEY` for dual-judge mode).

## Running

```bash
# QualOps native dataset (evals/datasets/*.jsonl)
npm run eval

# Kodus dataset — all languages
npm run eval -- --source=kodus

# Kodus dataset — TypeScript/JS only, limit 5 cases
npm run eval -- --source=kodus --lang=tsjs --limit=5

# Kodus dataset — non-crossfile only
npm run eval -- --source=kodus --dataset-type=normal

# Available Kodus languages: tsjs, react, python, java, ruby (+ *_crossfile variants)
```

## Viewing results

```bash
# Interactive web UI
npm run eval:view

# Results JSON: evals/promptfoo/results/output.json
# History snapshots: evals/promptfoo/results/history/<timestamp>.json
```

## Review modes

The eval supports three review modes, configured per-provider in `promptfoo.yaml`:

| Mode | What it exercises | Use case |
|------|-------------------|----------|
| `file-by-file` | Single LLM call per file via FileReviewer | Fast model comparison on single-file PRs |
| `agentic` | Multi-turn Claude Agent SDK with tools | Cross-file analysis, dependency tracing |
| `pipeline` | Full PipelineExecutor: multi-pass, validation, dedup | End-to-end pipeline quality (needs multi-file PR dataset) |

Both `file-by-file` and `agentic` are enabled by default. Edit `evals/promptfoo/promptfoo.yaml`:

```yaml
providers:
  - id: file://qualops-provider.js
    label: qualops-sonnet-file
    config:
      model: claude-sonnet-4-20250514
      provider: anthropic
      mode: file-by-file
  - id: file://qualops-provider.js
    label: qualops-sonnet-agentic
    config:
      model: claude-sonnet-4-20250514
      provider: anthropic
      mode: agentic
  # Full pipeline (multi-pass + validation + dedup):
  # - id: file://qualops-provider.js
  #   label: qualops-sonnet-pipeline
  #   config:
  #     model: claude-sonnet-4-20250514
  #     provider: anthropic
  #     mode: pipeline
```

## Dataset conversion (without running eval)

```bash
npm run eval:convert -- --source=qualops
npm run eval:convert -- --source=kodus --lang=tsjs
```

## Assertions

Each test case runs 6 assertions:

| Assertion | What it checks |
|-----------|---------------|
| parse-assertion | Output is valid JSON with required fields |
| judge-assertion | Dual LLM judge (Sonnet + GPT) scores issue quality 1-10, graceful single-judge fallback |
| line-accuracy-assertion | Line IoU between detected and reference issue locations |
| coverage-assertion | Recall — fraction of expected issues detected |
| precision-assertion | Fraction of detected issues that are true positives |
| severity-assertion | Severity match rate on matched pairs |

## Datasets

### QualOps native (evals/datasets/)

JSONL files. Each line:

```json
{
  "id": "sql-injection-1",
  "language": "typescript",
  "filePath": "src/api/users.ts",
  "diff": "@@ -10,6 +10,12 @@\n ...",
  "fullContent": "import ...",
  "expected": [
    { "line": 6, "type": "security", "severity": "critical", "category": "security", "description": "SQL injection" }
  ]
}
```

### Kodus (evals/datasets/kodus/)

80 annotated PR examples across 5 languages (tsjs, react, python, java, ruby) plus crossfile variants and false-positive traps. Uses the Kodus annotated PR format with `codeSuggestions` as ground truth.

## Metrics

| Metric | What it measures |
|--------|-----------------|
| Coverage | Recall — fraction of expected issues detected |
| Precision | Fraction of detected issues that are true positives |
| Line IoU | Line-level accuracy of matched issue locations |
| Severity | Exact severity match on matched pairs |
| Judge Avg | LLM-judged validity score (1-10), dual-judge with fallback |

Issue matching uses ±3 line tolerance and category compatibility.
