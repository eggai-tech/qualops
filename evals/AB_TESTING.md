# A/B testing QualOps config changes

Compare two (or more) QualOps configs on the same dataset to see how a change affects
**quality** (precision / recall / F1) and **cost/latency**. Use it to test per-stage model
choices, budgets, prompts, or pipeline modes — the enduring question of "which config gives the
best results per dollar."

## Quick start

```bash
# Smoke: 1 item per arm, then compare
npm run eval:ab -- .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json

# Full: REPEATS runs per arm, then compare
REPEATS=3 npm run eval:ab -- --full .qualops/.qualopsrc.json .qualops/.qualopsrc-cheap.json

# More than two arms (one column each) — e.g. opus vs sonnet vs haiku configs
npm run eval:ab -- a.json b.json c.json
```

Each arm runs the **exact pipeline defined in its config file** — the harness never passes
`--mode`, so model, budgets, prompts, subagents, and mode all come from the config. Make configs
that differ only in the knob you're testing (e.g. `ai.reviewStage.model`) and the comparison
isolates that change. `npm run eval:ab` loads `.env` for provider keys.

## The pieces (all TypeScript)

| Command | What it does |
|---|---|
| `npm run eval:ab -- [--full] <A.json> <B.json> [<C.json> …]` | Runs each config on `DATASET`, then compares. (`evals/src/run-ab.ts`) |
| `npm run eval:ab:compare -- --eval-log=<X> --eval-log=<Y> …` | Compare existing run-logs (any number of arms). (`evals/src/compare-experiments.ts`) |
| `npx tsx --env-file=.env evals/src/run-eval.ts --config=<path>` | Run one eval against an arbitrary repo config file (precedence over `--preset`). |

`--config=<path>` accepts any repo-relative `.json` config (validated: inside the repo, `.json`,
exists), so you A/B real ship configs (e.g. `.qualops/.qualopsrc.json`) with **no copy to drift**.

## Where run-logs live

Every eval run writes a structured JSON log to **`evals/logs/<experiment>-<timestamp>.json`**.
`--eval-log=<X>` accepts either a **file path** or an **experiment-label prefix** (the latest
matching file in `evals/logs/` is used). `run-ab` labels each arm by its config file's basename,
so after a run you can re-compare directly:

```bash
npm run eval:ab:compare -- --eval-log=qualopsrc --eval-log=qualopsrc-cheap
```

## Reading the output

`compare-experiments` prints a metric × arm table — one column per `--eval-log` — plus a `Δ`
column and a held-or-up/regressed verdict when exactly two arms are given. It also surfaces **mean
ms/item** so a quality gain can be weighed against its cost:

```
metric       │  arm A    │  arm B    │  arm C
precision    │  0.250    │  0.300    │  0.200
recall       │  0.410    │  0.410    │  0.300
f1           │  0.300    │  0.340    │  0.240
mean ms      │  140000   │  40000    │  15000
```

## Caveats

- **Small N is noisy.** Single-item runs swing widely; use `--full` with `REPEATS>=3` before
  concluding. Full-dataset aggregates are the basis for decisions.
- **Quality scores require a labeled dataset.** Precision/recall/F1 come from the CRB scorer and
  only populate for CRB datasets (`qualops/crb-*`). For unlabeled datasets you still get cost and
  issue counts.
- Env knobs: `DATASET` (which dataset), `REPEATS` (full-mode repeats, default 1), `LIMIT` (items
  per run).
