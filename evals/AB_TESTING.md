# A/B testing QualOps config changes

Compare two QualOps configs on the same dataset to see how a change affects **quality**
(precision / recall / F1) and **cost/latency**. Use it to test per-stage model choices,
budgets, prompts, or pipeline modes — the enduring question of "which config gives the best
results per dollar."

## Quick start

```bash
# Smoke: 1 item per arm, then compare
evals/run-ab.sh .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json

# Full: N repeats per arm, then compare (REPEATS/LIMIT/DATASET via env)
REPEATS=3 evals/run-ab.sh --full .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json
```

Both arms run the **exact pipeline defined in each config file** — the harness never passes
`--mode`, so model, budgets, prompts, subagents, and mode all come from the config. Make two
config files that differ only in the knob you're testing (e.g. `ai.reviewStage.model`) and the
comparison isolates that change.

## The pieces

| Command | What it does |
|---|---|
| `evals/run-ab.sh [--full] A.json B.json` | Runs both configs on `DATASET` (default `qualops/crb-sentry`), then compares. |
| `npm run eval:ab -- A.json B.json` | npm alias for the above. |
| `npm run eval:ab:compare <labelA> <labelB>` | Compare the latest run-logs for two experiment labels. |
| `npx tsx evals/src/run-eval.ts --config=<path>` | Run one eval against an arbitrary repo config file (precedence over `--preset`). |

`--config=<path>` accepts any repo-relative `.json` config (validated: inside the repo, `.json`,
exists), so you A/B real ship configs (e.g. `.qualops/.qualopsrc.json`) with **no copy to drift**.

## Reading the output

`compare-experiments` prints a per-metric table with `delta (B-A)` and a one-line verdict
(precision/recall held-or-up vs. regressed). It also surfaces **mean ms/item** so a quality gain
can be weighed against its cost. Example:

```
metric       │  baseline (A)  │  candidate (B)  │  delta (B-A)
precision    │  0.250         │  0.300          │  +0.050
recall       │  0.410         │  0.410          │  0.000
f1           │  0.300         │  0.340          │  +0.040
mean ms      │  140000        │  40000          │  -100000.000
```

## Caveats

- **Small N is noisy.** Single-item runs swing widely; use `--full` with `REPEATS>=3` before
  concluding. Full-dataset aggregates are the basis for decisions.
- **Quality scores require a labeled dataset.** Precision/recall/F1 come from the CRB scorer and
  only populate for CRB datasets (`qualops/crb-*`). For unlabeled datasets you still get cost and
  issue counts.
- Env knobs: `DATASET` (which dataset), `REPEATS` (full-mode repeats, default 1), `LIMIT` (items
  per run). Requires the provider key your configs use (loaded from `.env`).
