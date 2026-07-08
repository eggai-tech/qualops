# 10 — Eval Operations: result tracking, dataset growth, quick loop

**Status:** Concept-stage recommendation (2026-07-08) · Refines the eval strategy in [05-quality-spec.md](05-quality-spec.md) with three operational concerns raised by EggAI. Verified against the current `evals/` code and the `codereviewer` spike's `eval/` folder. **Updated 2026-07-08** with a benchmark-landscape review (multi-language, multi-use-case: security / performance / memory / concurrency — §4) and a source-verified spike-port mapping including the code blockers that make negatives actually count (§5).

## Current state (verified facts)

| Aspect | Today |
|---|---|
| Tracking backend | **Langfuse — required.** The runner `process.exit(1)`s if `LANGFUSE_*` creds are missing (`evals/src/run-eval.ts`). No offline mode. |
| Result history | **None committed.** Outcomes live in Langfuse (remote) + gitignored `evals/logs/*.json`. `recall-report.ts` aggregates *retained local* logs for recall stability, but nothing is in git. |
| Datasets | 3 synthetic TS cases (`typescript-bugs.jsonl`) + 50 CRB slices (10 each: Python/Go/TS/Ruby/Java) + 1 **unwired** smoke slice. |
| Negative (no-finding) cases | **~0.** No per-language "should stay silent" precision probes in the synthetic set. |
| Quick loop | `--limit=N`, `--source=qualops` (the 3-item set), `--preset=fast`, `--no-judge`, `--concurrency`. **Still Langfuse-gated**, and the review still calls a provider. |
| Scorers | parse · line-accuracy · coverage · severity · judge · crb-pairwise (precision/recall/f1). |

> Note (post-merge, 2026-07-08): the A/B tooling the CHANGELOG advertises now **exists** in the tree — `evals/src/run-ab.ts` (`--repeats`) and `evals/src/compare-experiments.ts` (`--eval-log`, run via `eval:ab:compare`). The earlier changelog/reality gap is closed, and A/B no longer depends on the Langfuse UI. The remaining eval-ops gaps are the committed scoreboard and optional-Langfuse (§1) — not the A/B tooling.

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

- **Negative / no-finding cases (highest value, cheapest — and the data already exists).** The spike ships exactly these: **10 `crb-noise-*` slices, 2 per language across Python/Go/TypeScript/Ruby/Java** (comment-only, docstring-only, constant-only, format-only, copy-only, rename-only, spec/test-helper-only) where the correct output is *silence*. QualOps has ~none. They port directly into our slice format (field rename only — see §5) and are the cases that catch a reviewer that comments on everything, directly serving the precision/noise north star (05 §1). This is 05 §3's "clean-PR negative set", made concrete and per-language. **Caveat (honest):** the spike's noise diffs are *synthetic stubs* (a `+// Safe PR-style fixture…` no-op), so they probe "stay silent on a trivial change" — a real but soft precision test; stronger clean-PR negatives must be captured from the five real CRB repos over time.
- **Semantic use-case cases the CRB set under-covers.** The spike's 5 `proof-quality-slices/semantic-*` cases add concurrency (`semantic-go-cache-concurrency`), cross-file authorization (`semantic-authz-cross-file`, `semantic-authz-defensive-control`), a billing-logic regression, and a date-boundary bug — 4 TypeScript + 1 Go. These are worth porting for use-case breadth, but the cross-file/repo-tree ones need loader wiring (§5).
- **Use-case / taxonomy breadth.** Adopt the spike's richer category set (`bug | security | performance | maintainability | compatibility | policy | test`) and its **tier** axis (`runtime-critical | security | logic | nit`) derived deterministically from category+severity. The tier axis is what makes **productRecall** (already in 05 §2) defensible — a reviewer that correctly ignores nits must not score the same as one that misses real bugs.
- **Grow the real set** via the slice inbox (TDR 0002) toward ≥30 native + the CRB 50, spanning the five languages plus the categories above; every real miss/FP becomes a case (05 §3).

## §3 — Quick-iteration loop

The concept already wants a fast tier (05 §7). The gap is it isn't built and Langfuse blocks even a 1-case run. Port the spike's decisive idea: a **deterministic, offline default matcher**.

- **`eval:quick`** — a first-class fast loop: a small **curated** set (a handful of cases spanning languages + one negative), **deterministic scorers only** (parse/line/coverage/severity — no LLM judge, no Langfuse), runs in seconds locally and in CI with no creds. This is the tight dev loop and the per-PR fast gate.
- **Tiering the scorers, not just the data:** the LLM judge (`crb-pairwise`, `judge`) and Langfuse export are **opt-in** for the deep/nightly run; the quick loop never needs them. (Today `--no-judge` exists but Langfuse is still required — fixing §1's optional-Langfuse unblocks a truly offline quick loop.)
- Keep the existing knobs (`--limit`, `--dataset`, `--source`, `--preset=fast`) as the "scope a bigger run" layer above `eval:quick`.

## §4 — What to adopt vs. build: external-benchmark verdict (multi-language, multi-use-case)

The question "is there honest public data covering more languages and more use-cases (security, code bugs, performance, memory leaks, concurrency) we can just add?" was researched against the current benchmark landscape (2026-07-08). Honest verdict: **for most categories there is nothing drop-in — which is *why* the concept builds its own slices rather than adopting a public set.**

| Use-case | Best public option | Verdict for QualOps |
|---|---|---|
| **General code bugs** (multi-lang) | CRB (already in use); SWR-Bench | **Adopt — done.** CRB is the right anchor; its one weakness (no clean/negative half) is closed by the spike negatives (§2) and the no-finding scorer (§5). |
| **Security** (multi-lang) | **CVEfixes** (MIT/CC-BY, commit-level, multi-lang) + PrimeVul + OWASP Benchmark | **Conditional, not drop-in.** CVEfixes is a relational DB of CVE-fixing commits — must be reshaped into diffs + file/line ground truth **and** sample-verified (CVE-fix labeling carries a documented 40–75% noise rate). A real project, deferred until a security dimension is prioritized. Function-level sets (PrimeVul/OWASP) are a different task shape (isolated function, not PR diff). |
| **Performance / memory leaks / resource leaks / concurrency** | none usable | **Build synthetic.** No public benchmark is diff-scoped, multi-language, and reusable — the candidates are single-language, wrong task shape (whole-repo fix or runtime reproduction), tiny, abandoned, or not even downloadable. These categories must be a small **QualOps-internal planted-defect set** (see 05 §3 dataset item and the templates below), not an adopted benchmark. |
| SWE-bench / Defects4J / BigVul / Juliet / vendor benchmarks | — | **Skip.** Wrong task (patch generation), single-language, heavy label noise, or synthetic-and-gameable. |

**Synthetic planted-defect templates** (for the categories with no public data — seed for 05 §3's set; per-category, per-language before/after diffs with exact file+line + a ~1:1 clean-negative ratio so FP rate is measurable):
- **Performance:** allocation/regex-compile/client construction moved inside a loop · O(n)→O(n²) lookup · N+1 query · `await`-in-loop replacing batched calls · removed cache/memoization.
- **Memory:** listener/observer registered never removed · unbounded static/global collection · closure capturing a long-lived reference · C/C++ free/delete missing on the exception path.
- **Resource:** handle opened without try-with-resources / `using` / context-manager / `defer close()` · leak on exception path only · per-request executor never shut down.
- **Concurrency:** unsynchronized read-modify-write / check-then-act · lock-order inversion (deadlock) · missing `volatile`/atomic visibility flag · non-thread-safe collection shared across threads/goroutines · goroutine/thread spawned with no cancellation path.

**Cross-tool comparison caveat (record it in the scoreboard).** Public reviewer numbers are not comparable across studies (every vendor benchmarks itself and wins; the same 5 repos produced 82% vs 45% depending on who ran it). The only fair external yardstick is the **Martian CRB leaderboard**, because it uses our exact 5 repos — treat it as directional and always report our number with N + matching method (05 §7).

## §5 — Verified port mapping & implementation blockers

The spike data ports, but source-verification against our `evals/` code found the negatives are **inert without two small code changes** — so this is "data + a scorer", not pure copy-paste. Recording the blockers so a future plan does not mistake the port for data-only.

**Field mapping (spike slice → our slice):** `expectedFindings` → `expected`; `.semanticSummary` → `.description`; `.lineRange: [a,b]` → `.line` + `.lineEnd`; `.category` (`performance|maintainability|…`) → `.type` (normalize to our narrower enum). `expectedNoFindingZones`, `changedFiles`, `tags`, `title` have no consumer today.

| Blocker | Where | Why it matters | Fix |
|---|---|---|---|
| **Negatives score `null`, not a penalty** | `evals/src/scorers/crb-pairwise.ts` — empty `expected` returns `crb_precision/recall/f1 = null` ("skipped (no golden comments)") | A reviewer that fires 5 false findings on a clean diff currently scores `null`, so the ported negatives measure **nothing** | Add a **no-finding / spurious-rate scorer**: empty `expected` + any candidate ⇒ record a false-positive count (feeds `spurious_rate`, 05 §2), not `null` |
| **`expectedNoFindingZones` has no consumer** | no scorer reads it | The spike's per-zone "must stay silent here" signal is dropped | Optional: a zone-scoped FP scorer, or fold zones into the spurious-rate scorer above |
| **Semantic repo-tree slices don't load** | `evals/src/reviewer.ts` — CRB path needs `baseSha`/`headSha` for a worktree; `semantic-*` slices ship a `repo/` tree but **no git SHAs**, and aren't single-file `fullContent` cases either | The highest-value cross-file/concurrency cases can't run under either loader path | Loader wiring to mount a slice's `repo/` tree without git (or synthesize a throwaway commit) before porting the cross-file semantic cases |

**Do not port:** the 50 positive CRB cases in the spike (duplicates of ours) and the `fixtures/{lang}/negative/*` bare source files (no diff/expected to port; would add Rust as a net-new language with no other coverage).

## Ports from the spike (summary)

| Port | Value | Effort |
|---|---|---|
| Hydration placeholder guard (error, don't score 0, on un-hydrated slices) | Kills a whole class of silent false-regressions | tiny — one marker + one assertion (05 §3 already references it) |
| **10 per-language negative/no-finding slices** (`crb-noise-*`, 2×5 langs) | Direct precision-pressure; catches over-commenting; **data exists, ports by field-rename** | low data + **small scorer change (§5)** to make them count |
| 5 semantic use-case slices (concurrency, cross-file authz, billing, boundary) | Use-case breadth CRB under-covers | low (single-file) / medium (cross-file needs loader wiring, §5) |
| Tier taxonomy + productRecall (nits excluded from the gate) | Defensible headline metric (already in 05 §2) | low |
| Deterministic offline matcher + opt-in boolean judge | Enables the offline quick loop and CI without creds/cost | medium |
| Committed scoreboard + dataset fingerprint | Git-diffable history not tied to a Langfuse account | medium |
| Artifact-only findings scored in a separate set | Track "noticed but not published" without hurting precision (ties to 02 §3.4 needs-more-evidence) | low |
| Refutation-quality counters (false-refutation / false-confirmation) | Scores the verify/admit stage itself (already 05 §5) | low |

**Do NOT copy** the spike's ephemeral, history-less result model — QualOps's Langfuse integration is the better half; the fix is to *add* offline+committed capability, not to remove Langfuse.

## Net change to the concept

- 05-quality-spec gains: committed scoreboard + optional-Langfuse (§1); `eval:quick` offline deterministic loop (§3); negatives-per-language + category/tier taxonomy made concrete (§2); a **no-finding / spurious-rate scorer** so negatives count (§5); a **synthetic multi-use-case planted-defect set** for the categories with no public data (§4, reflected as a 05 §3 dataset item). Most of §2/§3 is reinforcement of existing 05 intent; §1, the no-finding scorer (§5), and the external-data verdict (§4) are the net-new items.
- **Adopt vs build is now decided (§4):** CRB stays the anchor; security data (CVEfixes) is a conditional, deferred project (label-noise + reshape cost); performance / memory / resource / concurrency have no usable public benchmark and are built synthetically.
- No change to the product pipeline; this is eval tooling only.
