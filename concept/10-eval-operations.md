# 10 — Eval Operations: result tracking, dataset growth, quick loop

**Status:** Concept-stage recommendation (2026-07-08) · Refines the eval strategy in [05-quality-spec.md](05-quality-spec.md) with three operational concerns raised by EggAI. Verified against the current `evals/` code and the `codereviewer` spike's `eval/` folder.

## Current state (verified facts)

| Aspect | Today |
|---|---|
| Tracking backend | **Langfuse — required.** The runner `process.exit(1)`s if `LANGFUSE_*` creds are missing (`evals/src/run-eval.ts`). No offline mode. |
| Result history | **None committed.** Outcomes live in Langfuse (remote) + gitignored `evals/logs/*.json`. `recall-report.ts` aggregates *retained local* logs for recall stability, but nothing is in git. |
| Datasets | 3 synthetic TS cases (`typescript-bugs.jsonl`) + 50 CRB slices (10 each: Python/Go/TS/Ruby/Java) + 1 **unwired** smoke slice. |
| Negative (no-finding) cases | **~0.** No per-language "should stay silent" precision probes in the synthetic set. |
| Quick loop | `--limit=N`, `--source=qualops` (the 3-item set), `--preset=fast`, `--no-judge`, `--concurrency`. **Still Langfuse-gated**, and the review still calls a provider. |
| Scorers | parse · line-accuracy · coverage · severity · judge · crb-pairwise (precision/recall/f1). |

> Data-integrity flag: the `CHANGELOG` `[Unreleased]` advertises A/B tooling (`run-ab.ts`, `compare-experiments.ts`, `--repeats`, `--eval-log`) that **does not exist** in this tree — A/B is done manually in the Langfuse UI. Reconcile the changelog with reality (it describes unshipped code).

## Honest framing: what's new vs. already in the concept

Two of the three asks are **already the concept's intent** — the audit shows they aren't built yet and surfaces concrete blockers/ports. One is a **genuine gap**.

| Ask | Status | Action |
|---|---|---|
| Store outcomes in repo over time | **GAP** — history is Langfuse-only + gitignored; nothing committed; Langfuse is a hard requirement | §1 — new: committed scoreboard + make Langfuse optional |
| Extend evals (languages/use cases) | **Already in concept** (05 §3: grow native ≥30, clean-PR negatives, FP-regression, planted-FP, fix harness) — not yet built | §2 — reinforce + port spike specifics (negatives-per-language, taxonomy) |
| Quick-iteration on a few examples | **Already in concept** (05 §7: "fast gate, per PR, ~minutes") — not built, and Langfuse-blocks it | §3 — reinforce + offline deterministic `eval:quick` |

## §1 — Result tracking in the repo (the real gap)

Langfuse **does** give over-time tracking — but remote, account-gated, and unqueryable in a PR diff. The spike shows the opposite failure (fully offline, but *no* history — you diff two JSON files you remembered to save). **Target: both.** Keep Langfuse as the rich historical store; add a lightweight committed layer and stop requiring Langfuse to run.

- **Committed scoreboard.** After a deep run, write a compact, deterministic summary to a **tracked** path (e.g. `evals/results/<dataset>.json` + a human `evals/results/SCOREBOARD.md`): per-dataset/per-language/per-tier precision, recall, F1, productRecall, spurious-rate, cost, and the dataset fingerprint (below). Committed → trends are `git diff`-able and reviewable in the PR that changes them. This is the concrete realization of 05 §7's "every phase PR attaches before/after eval results."
- **Make Langfuse optional.** The runner should degrade gracefully: no creds → skip Langfuse export, still run, still score, still write the local log + scoreboard. Langfuse enriches; it must not gate. (Required today — a blocker for CI, for contributors without an account, and for the committed-scoreboard flow.)
- **Dataset fingerprint** (from the spike's `slice-manifest`): a sha256 of case-IDs + normalized counts (no source text), written into each scoreboard entry, so a comparison can prove both runs used identical inputs.
- **Keep, don't regress:** do not drop Langfuse for the spike's ephemeral model — persistent queryable history beats "diff two files." Add the committed layer alongside it.

## §2 — Are the evals good enough? (dataset growth)

Honest answer: **not yet — and the concept already says so** (05 §3 calls n=3 "statistically meaningless"). Scale is comparable to the spike (~50 real cases, 5 languages), but two weaknesses stand out, both cheaply fixed by porting spike patterns:

- **Negative / no-finding cases (highest value, cheapest).** The spike makes **17%** of its benchmark pure-negative precision probes — per-language no-op diffs (comment-only, rename-only, format-only, docstring-only) where the correct output is *silence*. QualOps has ~none. These are the cases that catch a reviewer that comments on everything — directly serving the precision/noise north star (05 §1). Add ~2 per language. This is 05 §3's "clean-PR negative set", made concrete and per-language.
- **Use-case / taxonomy breadth.** Adopt the spike's richer category set (`bug | security | performance | maintainability | compatibility | policy | test`) and its **tier** axis (`runtime-critical | security | logic | nit`) derived deterministically from category+severity. The tier axis is what makes **productRecall** (already in 05 §2) defensible — a reviewer that correctly ignores nits must not score the same as one that misses real bugs.
- **Grow the real set** via the slice inbox (TDR 0002) toward ≥30 native + the CRB 50, spanning the five languages plus the categories above; every real miss/FP becomes a case (05 §3).

## §3 — Quick-iteration loop

The concept already wants a fast tier (05 §7). The gap is it isn't built and Langfuse blocks even a 1-case run. Port the spike's decisive idea: a **deterministic, offline default matcher**.

- **`eval:quick`** — a first-class fast loop: a small **curated** set (a handful of cases spanning languages + one negative), **deterministic scorers only** (parse/line/coverage/severity — no LLM judge, no Langfuse), runs in seconds locally and in CI with no creds. This is the tight dev loop and the per-PR fast gate.
- **Tiering the scorers, not just the data:** the LLM judge (`crb-pairwise`, `judge`) and Langfuse export are **opt-in** for the deep/nightly run; the quick loop never needs them. (Today `--no-judge` exists but Langfuse is still required — fixing §1's optional-Langfuse unblocks a truly offline quick loop.)
- Keep the existing knobs (`--limit`, `--dataset`, `--source`, `--preset=fast`) as the "scope a bigger run" layer above `eval:quick`.

## Ports from the spike (summary)

| Port | Value | Effort |
|---|---|---|
| Hydration placeholder guard (error, don't score 0, on un-hydrated slices) | Kills a whole class of silent false-regressions | tiny — one marker + one assertion (05 §3 already references it) |
| Per-language negative/no-finding cases (~17%) | Direct precision-pressure; catches over-commenting | low |
| Tier taxonomy + productRecall (nits excluded from the gate) | Defensible headline metric (already in 05 §2) | low |
| Deterministic offline matcher + opt-in boolean judge | Enables the offline quick loop and CI without creds/cost | medium |
| Committed scoreboard + dataset fingerprint | Git-diffable history not tied to a Langfuse account | medium |
| Artifact-only findings scored in a separate set | Track "noticed but not published" without hurting precision (ties to 02 §3.4 needs-more-evidence) | low |
| Refutation-quality counters (false-refutation / false-confirmation) | Scores the verify/admit stage itself (already 05 §5) | low |

**Do NOT copy** the spike's ephemeral, history-less result model — QualOps's Langfuse integration is the better half; the fix is to *add* offline+committed capability, not to remove Langfuse.

## Net change to the concept

- 05-quality-spec gains: committed scoreboard + optional-Langfuse (§1); `eval:quick` offline deterministic loop (§3); negatives-per-language + category/tier taxonomy made concrete (§2). Most of §2/§3 is reinforcement of existing 05 intent; §1 is the one net-new requirement.
- No change to the product pipeline; this is eval tooling only.
