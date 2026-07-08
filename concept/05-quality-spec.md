# 05 — Quality & Evaluation Specification

**Status:** Draft spec for human review · Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Sources: the original eval-strategy analysis, industry evidence (appendix B §5), and the agent-evaluation research from [PR #149](https://github.com/eggai-tech/qualops/pull/149) (three-layer model, cadence, statistical discipline — integrated here; conflicts resolved in §8).

Principle: **you cannot ship a "reliable, non-polluting" reviewer on recall metrics alone.** Every phase of the roadmap is gated by these evals.

## 1. North-star and release gates

**Online north star (production telemetry):**
- **Addressed rate** per published fingerprint (flagged code changed before merge — measured automatically at push/close) — target **> 40%**.
- **Spurious rate on clean PRs ≈ 0**; **FP rate < 10%** (developer-trust threshold); comments/PR treated as a *cost*; silence rate on clean PRs tracked as a positive.

**Offline release gates (per release, statistically grounded — §7):** all deterministic asserts pass · noise scorecard (§2) not regressed · recall within tolerance of baseline · no single stage regressed >5% (statistically significant). PR #149's weighted composite score is computed as a **diagnostic**, not the ship gate (§8, C1).

## 2. Noise scorecard (first-class, all datasets)

- `precision` — on one consistent contingency table (bipartite golden↔candidate assignment; fixes the current tp/fp denominator mismatch, F-29)
- `spurious_rate` — findings on clean-PR negatives
- `unchanged_line_rate` — findings outside the diff (→ ~0 once the scope filter lands; kept to catch regressions)
- `duplicate_rate` — fingerprint collisions in published output (must be 0)
- `findings_per_kloc_changed` — volume as cost
- **Recall, tiered**: headline `productRecall` counts runtime-critical/security/logic findings only — correctly ignoring nits is not punished (spike adoption)
- Scorer fixes carried from the analysis: clean output on a clean case is a pass, not score 0; missing judge keys → `null`, never 0; CRB matching includes anchor proximity where goldens carry locations. **No-finding (empty-expected) cases must score a spurious-finding count, never `null`** — today `crb-pairwise` skips them, so negatives measure nothing (blocker + fix in [10 §5](10-eval-operations.md)); this is what makes `spurious_rate` real.

## 3. Datasets

1. **CRB** (50 real PRs, 5 languages) — kept as the recall/precision workhorse; hydration guard errors on un-hydrated slices instead of silently scoring 0.
2. **Clean-PR negative set** (~20 real merged PRs with no post-merge fixes) — the direct pollution measurement; reuses the slice format (TDR 0002).
3. **Native slice set grown ≥30** via the slice inbox: every real-world miss **and false positive** becomes a case.
4. **FP regression set**: verifier-refuted findings that a human confirms were wrong → "must-not-flag" slices; doubles as the contrastive few-shot pool (§6).
5. **Planted-FP set**: clean slices with programmatically injected plausible-but-wrong candidates — isolates verifier quality from generator quality.
6. **Posting-behavior fixtures**: recorded forge-API push sequences (post → drift → fix-one → human-resolve-one → re-run) asserting no drift duplicates, auto-resolution fires, human resolution respected, summary updated in place. Deterministic asserts — no `pass^k` needed here (§8, C3).
7. **Fix-stage harness**: SWE-bench-style — apply the fix proposal, run FAIL_TO_PASS + PASS_TO_PASS, plus a linter/quality delta to catch tests-pass-but-ugly patches. Seed fresh cases monthly (SWE-bench-Live methodology) for contamination control. *(New — the fix stage previously had no eval at all.)*
8. **Multi-use-case planted-defect set** (QualOps-internal, synthetic): per-language before/after diffs for the categories **no public benchmark covers** — performance regressions, memory leaks, resource leaks, concurrency bugs (templates in [10 §4](10-eval-operations.md)) — plus security probes for languages the public sets skip (JS/TS/Go/Rust). Exact file+line ground truth, severity, and a ~1:1 clean-negative ratio so per-category precision/recall/F1 is measurable and hard categories aren't diluted by an aggregate. Labeled internal/synthetic — not a claimed academic benchmark. The benchmark-landscape review (10 §4) confirmed this must be built, not adopted: CRB stays the anchor; CVEfixes is a deferred, label-noise-heavy reshape project; performance/memory/concurrency have no usable public data.

## 4. What is measured, per layer (PR #149's three-layer model)

| Layer | What | Metrics |
|---|---|---|
| **Component** | each reviewer / tool call / boundary parse in isolation | tool-call F1 vs. expected call set, argument F1, under-tooling (missed-tool) rate, hallucinated-tool rate, parse-recovery rate |
| **Trajectory** | the agent-mode path | redundant-call rate, budget adherence, trajectory diff on **recorded-trace replay** (frozen trajectories re-run with stubbed tool outputs to catch prompt/model drift) |
| **Outcome** | published findings & artifacts | §2 scorecard, faithfulness (every claim cites file:line or is dropped), gate correctness |

The agentic mode was previously evaluated only at outcome level — failures were visible but not attributable. Component + trajectory metrics make them attributable.

## 5. Verifier-as-classifier (kept — ahead of PR #149 here)

- False-refutation rate (killed real bugs) and false-confirmation rate (passed planted FPs) on gold slices.
- **Calibration**: verifier confidence bucketed vs. empirical correctness; the admission threshold (default 80) sits where the curve says, not intuition. ECE tracked.
- Cross-model verifier A/B (same-family vs. different-family) — a config change thanks to multi-provider (D9).

## 6. Judging discipline

- **Bias controls on every LLM judge** (not just the verifier): pairwise with order swap, verbosity normalization, binary pass/fail rubrics over Likert scales, and a **different model family than the stage under test** (self-preference control).
- **Agent-as-judge** for report/finding quality: a tool-enabled judge that re-reads the code — cross-family, per PR #149's evidence (~90% human agreement).
- Judge calibration set: 50–100 human-rated traces, refreshed quarterly; inter-judge agreement reported.
- **Contrastive don't-flag examples** mined from the FP regression set and injected as few-shot negatives into generation prompts — the documented cure for over-flagging, directly serving the noise north star.

## 7. Cadence & statistical discipline

| Tier | When | What |
|---|---|---|
| **Fast gate** | per PR, blocking, ~minutes | deterministic asserts on each stage's output (schema validity, scope filter, dedup, gate/exit-code correctness) + a small pinned slice subset; result posted as a check with a diff-vs-main comment |
| **Deep run** | nightly / per release, non-blocking + alerting | full datasets, `pass^k` (≥3–5 reps) on model-driven stages, noise scorecard, judge suite, Langfuse experiment |
| **Capability & drift** | weekly | pinned datasets against live providers (model-drift detection), fix harness, replay suite, trend dashboard |

**Statistics (normative for any "improved/regressed" claim):** paired comparisons on the same items (McNemar for binary, paired bootstrap for continuous), 95% CIs on headline metrics, ≥3–5 reps for model-driven stages with `pass^k` reported as the reliability number, variance decomposition when results look noisy. "The numbers went up" without this is not a claim.

**Regimes:** deterministic machinery (filters, fingerprints, publishing, gate) is asserted at zero tolerance; model-driven stages (generate, verify, judge) use the statistical regime. (§8, C3.)

## 8. Resolved conflicts with PR #149

- **C1 — Release gate metric.** PR #149 gates releases on a weighted composite + human hold-out; this spec gates on the noise scorecard + addressed rate (the product goal is precision/noise). The composite is retained as a diagnostic trend. 
- **C2 — Confidence source.** PR #149 is softer on self-rated confidence; this spec keeps the hard rule (D1): generator self-rating never gates; verifier confidence is calibrated (§5) and consistency signals (vote counts) may inform it.
- **C3 — Determinism.** PR #149 embraces non-determinism everywhere (`pass^k`); this spec splits regimes (§7) — the machinery that makes the reviewer non-polluting must be exactly right, not probably right.
- **Adopted from PR #149**: three-layer model (§4), tool-call/trajectory metrics (§4), fix harness (§3.7), fast per-PR gate + cadence tiers (§7), statistical discipline (§7), judge bias controls & agent-as-judge (§6), error-analysis loop and improvement hierarchy (§9), prompt-as-code (§9), contrastive few-shot (§6). **Redundant with existing concept** (not re-adopted): golden-set advice, keep-Langfuse, weekly drift runs, LLM-judge legitimacy discussion.

## 9. Improvement loop (offline, between releases — per the non-goal in 01 §2)

1. **Error analysis is the engine**: open coding on sampled failures → axial coding into a 5–15 bucket taxonomy → prioritize by frequency × severity × fixability → each bucket maps to a "likely first fix." Weekly: pick the top bucket, make the smallest fix, run the gates, ship. Confirmed misses/FPs feed the slice inbox as they're triaged.
2. **Hierarchy of fixes, cheapest first**: prompt structure → contrastive few-shot → tools/context → reviewer decomposition → automated prompt optimization (DSPy-style, only for narrow scorable stages) → model routing/swap. Fine-tuning is a non-goal.
3. **Prompt-as-code**: prompt + model + temperature + tool list pinned per version hash (the provenance hashes of [02-pipeline-spec.md](02-pipeline-spec.md) §11); the change *hypothesis* logged separately from the diff; one change at a time.
4. **Process**: every roadmap phase PR attaches before/after deep-run results under §7's statistical rules; external validation via the Martian Code Review Bench once verification ships.

**Ownership note (honest prerequisite from PR #149):** this only works with a designated (part-time) eval owner, human labeling capacity for the quarterly calibration set, and a budget line for cross-model judging. Without those, keep the fast gate + deep run and defer §6's calibration program — but do not skip the noise scorecard; it is the product.
