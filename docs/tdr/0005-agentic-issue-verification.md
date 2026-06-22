# TDR 0005 — Agentic Per-Issue Verification of Findings

**Status:** Proposed — 2026-06-22

## Context

QualOps reports code-quality and security findings on pull requests. A recurring complaint is
**false positives** — findings that survive to the report but are not real problems. Common shapes:

- a `process.exit()` in a CLI entry point flagged as a "bug",
- an "unvalidated input" that is in fact operator-controlled, not attacker-controlled,
- a vulnerability that is already guarded by a check elsewhere in the call chain,
- a finding against code that a later commit in the same PR already fixed.

The only mechanism that removes false positives today is a **single batched LLM call** in
`ValidationResolver.validateWithAI()` (`src/stages/review/processors/validation-resolver.ts:80-158`). Every
issue that clears the confidence pre-filter is serialised into one JSON list and sent to the model with the
`ValidationResultsSchema`; entries the model marks `is_false_positive` are dropped (`:139-143`). This has
three structural weaknesses:

1. **No investigation.** The judge sees only the finding's `description`, `reasoning`, and a small `context`
   snippet captured at review time. It cannot open the file, trace a caller, check whether input is actually
   attacker-controlled, or confirm a guard or fix exists. It can reject only *pattern-shaped* false positives
   that the prompt enumerates — not the *evidence-based* ones, which are precisely the ones that slip through.
2. **Divided attention.** One call spreads the model's focus across N findings; per-finding reasoning gets
   shallower as N grows.
3. **Fragility.** Verdicts map back by array `index`, and a single `StructuredOutputError` discards the
   entire batch (`:122-128`) — one malformed response can drop every finding.

QualOps already has an agentic execution path — `AgenticExecutor`
(`src/stages/review/agentic/agentic-executor.ts`) plus provider adapters
(`src/stages/review/agentic/adapters/`) — that grants sandboxed bash/read/grep tools with workspace
boundary enforcement and `maxTurns` / `maxBudgetUsd` / bash `maxCallsPerReview` caps.

False-positive rate is not reducible at a single point. There are at least four distinct levers, each
intervening at a different place in the pipeline:

- **Generation-side** — capture more evidence at review time so fewer false positives are produced or so the
  existing judge can reject them without investigating.
- **Threshold** — where the confidence pre-filter (`>= 7`) is placed.
- **Deterministic pre-checks** — cheap, LLM-free filters that remove pattern-shaped false positives before
  any model is invoked.
- **Verdict mechanism** — how each surviving finding is judged.

This TDR evaluates the structural choices for the last lever (where filtering lives, and how a verdict is
reached) and the deterministic-pre-check lever, and records the generation-side and threshold levers as
adjacent, complementary work. It does not pre-commit to a single configuration.

## Adjacent levers (outside the numbered axes)

These two levers reduce false positives but are not verdict-stage design choices. They combine with any
selection from the axes below rather than competing with them, and are recorded here so the document does not
present the verdict stage as the only intervention point.

**Source-side reduction.** Several enumerated false-positive shapes (`process.exit()` in a CLI,
operator-controlled input) are knowable at review time given enough surrounding code. Capturing a richer
`context` up front — more lines, the enclosing function signature, the call site — would let even the current
batched judge reject them with evidence, at a fraction of the cost of investigation. This is upstream of every
option below and complements all of them; it is not a numbered axis because it changes *what the review
produces*, not *how a verdict is reached*.

**Confidence calibration.** The pre-filter is a hard `issue.confidence >= 7`
(`validation-resolver.ts:49-57`). False-positive rate is partly a threshold-placement problem: raising the
bar drops more findings (trading recall for precision) without any model change. Calibration is orthogonal to
the verdict mechanism and can be tuned independently of, and alongside, any option below.

## Decision 1 — Where does false-positive filtering live?

### Option 1A — Enhance the existing validation step

Keep false-positive removal inside `ValidationResolver`, in the same pipeline position
(`review → validate → dedup`), and change only the *mechanism* of the AI step. The output type stays
`ReviewIssue[]`; the confidence pre-filter (`:49-57`) and all call sites are unchanged.

**Pros:**
- Validation already owns false-positive removal — one home, one responsibility.
- No new stage wiring, metadata, or orchestration; smallest blast radius.
- Medium- and low-severity findings remain covered (they all reach validation).

**Cons:**
- Verification stays buried inside the review stage rather than being a first-class, independently
  traceable/evaluable/toggleable step. This matters precisely because the mechanism is about to become the
  most expensive part of the run, where independent observability and a kill switch are most useful.

---

### Option 1B — Remove validation; new standalone "verify" stage between review and fix

Retire the batched validation step entirely and move false-positive removal into a new dedicated agentic
verification stage that sits between `review` and `fix`.

**Pros:**
- Clean separation of concerns — verification becomes a first-class, independently toggleable stage with its
  own metadata and config, rather than a step buried inside review.
- A natural home if verification later grows beyond false-positive removal (e.g. cross-finding correlation,
  severity re-grading as a deliberate pass).

**Cons:**
- New stage wiring: pipeline ordering, stage metadata, session paths, and config surface all have to be
  added and maintained, where validation already provides that scaffolding today.

---

### Option 1C — Remove validation; fold verification into the fix stage

Retire the batched validation step and have the fix stage decide whether a finding is a false positive
(before generating a fix) as the sole false-positive filter.

**Pros:**
- The fix agent already inspects code with tools, so the investigation capability is nearby.

**Cons:**
- The fix stage only processes HIGH-severity, confidence ≥ 7, non-ESLint issues
  (`src/stages/fix/index.ts:14-23`). With validation removed, medium- and low-severity findings would never
  be verified and would reach the report unfiltered.
- For any run that does not fix (report-only is a common mode), there would be **no** false-positive filter
  at all.

---

## Decision 2 — How is a verdict reached?

### Option 2A — Batched, no tools (status quo)

One LLM call, all issues, pattern-only judgement. The current behaviour, and the baseline the other
options are measured against.

**Pros:**
- Lowest cost and lowest latency — a single call.

**Cons:**
- No investigation: rejects only pattern-shaped false positives, not evidence-based ones.
- Divided attention across N findings; reasoning gets shallower as N grows.
- All-or-nothing parse failure (`:122-128`) — one malformed response drops every finding.

---

### Option 2B — Single agentic run, all issues, with tools

One agent receives the whole list plus bash/read/grep and returns all verdicts.

**Pros:**
- Cheaper than per-issue (one context, one run).
- Can reason about cross-issue relationships in a single pass.

**Cons:**
- Keeps the **divided-attention** weakness — the core reason 2A misses findings — because the model still
  splits focus across N issues.
- Keeps the all-or-nothing parse failure.
- Bolting tools onto a batch does not deliver focused investigation.
- **Introduces a false-negative risk** absent from 2A: an investigating agent can *wrongly drop a real
  finding* (e.g. mistaking a bypassable guard for a safe one). Tool use widens the failure surface in both
  directions, not just toward better precision.
- **Non-deterministic** — tool transcripts vary run-to-run, so verdicts can differ between runs of the same
  PR, which destabilises regression evals.
- **Depends on a correct checkout.** The agent's value is contingent on the repository being checked out at
  the right commit in the sandbox; a stale or wrong checkout makes it investigate the wrong code and produce
  confidently-wrong verdicts — strictly worse than no investigation.
- **Expands the prompt-injection surface** — the agent reads PR-authored (potentially hostile) code with
  bash/read access. For a tool that is partly a security reviewer, this is a real threat-model change.

---

### Option 2C — Per-issue agentic run, tightly bounded

Each issue gets its own agentic run with bash/read/grep, bounded by a low `maxTurns`, a small
`maxBudgetUsd`, and a small bash call cap so it performs a *focused, targeted* check rather than open-ended
exploration. Runs execute concurrently (bounded by `processConcurrently`,
`src/shared/utils/concurrency.ts` — the same utility the fix stage already uses). Each returns a full
verdict `{is_false_positive, confidence, severity, reasoning, evidence}`.

**Pros:**
- Maximum focus and depth per finding; the agent actually inspects the checked-out repository to confirm or
  refute the finding.
- Failures can be isolated to a single finding rather than dropping the batch.
- Clean per-finding evidence trail recorded on the kept issue.

**Cons:**
- N agentic runs cost more **tokens** than one batched call. Mitigated by tight per-issue bounds, bounded
  concurrency, and a `maxIssues` guard that falls back to the batched call for pathologically large lists —
  but see the silent-fallback caveat under *Configuration tradeoffs*.
- Adds **latency** distinct from token cost: even with bounded concurrency, N runs lengthen the wall-clock
  time before a PR comment appears, which is a product constraint for an inline review tool.
- Carries the same **false-negative**, **non-determinism**, **checkout-dependency**, and
  **prompt-injection** risks described under 2B, amplified by running N independent agents instead of one.

**Fail-open vs fail-closed.** Whether a verification timeout or error *keeps* (fail-open) or *drops*
(fail-closed) the finding is the single most consequential precision/recall lever in this option, not an
implementation detail. Fail-open protects recall (real findings survive agent failures) at the cost of
letting some false positives through; fail-closed does the reverse. This choice must be made explicitly and
applies equally to 2B.

---

### Option 2D — Tiered: batched triage, then per-issue escalation

Run the batched judge (2A) first as a cheap triage pass, then escalate only the *uncertain or borderline*
findings — those near the confidence boundary, or where the batched judge's verdict is low-confidence — to a
bounded per-issue agentic run (2C). Clear-cut findings keep the batched verdict; only the ambiguous tail pays
for investigation.

**Pros:**
- Directly attacks the one weakness 2C cannot mitigate on its own — **cost** — by sending only the borderline
  subset to the expensive path.
- Cost/accuracy is tunable via the escalation threshold rather than fixed.
- Preserves per-finding evidence and failure isolation for the escalated set.

**Cons:**
- More moving parts: a two-stage pipeline with its own threshold to tune and validate.
- Two failure modes to reason about (batched parse failure *and* per-issue agent failure), each needing its
  own fail-open/fail-closed policy.
- A miscalibrated escalation threshold can route the wrong findings — sending easy ones to the agent or
  keeping hard ones on the shallow path.

---

## Decision 3 — Deterministic pre-checks (orthogonal)

An LLM-free filter layer that runs *before* any verdict mechanism. It is orthogonal to Decisions 1 and 2:
it combines with any "where" and any "how" selection, and it reduces the population of findings reaching the
verdict stage — cutting cost regardless of which mechanism is chosen.

### Option 3A — None (status quo)

No deterministic pre-check; every survivor of the confidence filter reaches the verdict mechanism.

---

### Option 3B — Git/diff-based checks

Cheap, deterministic checks against the PR's own history. The clearest case: "a later commit in the same PR
already fixed the flagged code" is answerable with `git log -L` / `git blame` against the finding's line
range — no model needed. Findings whose target lines were superseded by a later commit are dropped
deterministically.

**Pros:**
- Removes a whole class of false positives at near-zero cost and with no model variance.
- Fully deterministic — stable across runs, eval-friendly.

**Cons:**
- Narrow: only catches false positives that are visible in version-control history, not semantic ones.
- A precise line-range mapping is required; sloppy mapping risks dropping a still-relevant finding (a
  false-negative risk of its own).

---

### Option 3C — Static heuristics

Pattern-based rules for the most common pattern-shaped false positives — e.g. `process.exit()` in a known
entry-point/CLI file, or simple reachability/guard heuristics — applied before the verdict stage.

**Pros:**
- Catches the highest-frequency pattern-shaped false positives without an LLM call.
- Deterministic and inspectable; each rule is auditable.

**Cons:**
- Heuristics carry a **precision/recall risk**: an over-broad rule drops real findings (false negatives),
  an over-narrow one earns nothing. Each rule needs its own validation on labelled data.
- Rule maintenance is ongoing as the codebase and finding shapes evolve.

---

## Configuration tradeoffs

The axes above are combinable; listing every product is not useful. Instead, a few representative end-to-end
configurations, each labelled by what it optimises:

- **Lowest cost / fastest — `1A + 3A + 2A`** (today) or **`1A + 3B + 2A`.** A single batched call, optionally
  preceded by deterministic git checks. Cheapest and lowest-latency; weakest on evidence-based false
  positives. Adding 3B removes the "already-fixed-in-PR" class for free without changing the cost profile of
  the verdict step. *Favors: speed, $, determinism. Trades away: precision on evidence-based FPs.*

- **Best precision — `1A + 3B/3C + 2C`.** Deterministic checks thin the population, then every survivor gets a
  focused per-issue investigation. Strongest false-positive removal; most expensive in tokens and latency, and
  most exposed to the false-negative / checkout / injection risks unless fail-open is chosen. *Favors:
  precision. Trades away: $, latency, determinism.*

- **Balanced cost/precision — `1A + 3B + 2D`.** Deterministic pre-checks, then batched triage, then per-issue
  escalation only for the borderline tail. Most of 2C's precision at a fraction of its cost, at the price of a
  threshold to tune. *Favors: cost/precision balance. Trades away: simplicity.*

- **Recall-protective — any config with deterministic-only hard drops + fail-open verdicts.** Findings are
  only *dropped* with certainty by deterministic checks (3B/3C); the LLM/agent verdict can lower confidence
  but a verification failure keeps the finding. Minimises false negatives at the cost of admitting more false
  positives. *Favors: recall. Trades away: precision.*

**Open questions to resolve before choosing a configuration:**

- **Baseline.** What is the current false-positive *and* false-negative rate on a labelled set? Without this,
  no option can be shown to improve precision without regressing recall.
- **Recall guard.** Any option that *drops* findings (2B/2C/2D, 3C) needs a measured recall guard — the FP
  win must not come at an unmeasured recall cost.
- **Latency budget.** What wall-clock ceiling is acceptable for an inline PR comment? This bounds how much of
  the population 2C may touch.
- **Checkout reliability.** How reliably is the repository checked out at the correct commit in the sandbox?
  The value of every tool-using option (2B/2C/2D) is contingent on this.
- **Fail-open vs fail-closed.** The default verification-failure policy must be chosen explicitly (see 2C).
- **`maxIssues` fallback visibility.** If 2C/2D fall back to the batched call for large lists, that fallback
  must be **logged and surfaced**, not silent — large PRs are the ones most likely to contain false positives,
  so silently giving them the weaker filter is the opposite of what is intended.

## Evaluation strategy

The goal — *reduce false positives without regressing recall* — is measurable, and the existing harness already
provides the instruments, so the strategy reuses them rather than building new ones. Two tiers:

- **Aggregate (CRB).** The scorers in `evals/src/scorers/crb-pairwise.ts` already compute
  `crb_precision = TP/(TP+FP)` (a direct false-positive measure) and `crb_recall = TP/(TP+FN)`. Run each
  candidate with `npm run eval:run:crb:all` over the 50-PR CRB dataset in `pipeline` mode (so the verification
  step is exercised) and compare against the `3A + 2A` baseline as Langfuse experiments. Pass condition:
  **precision up, recall flat-or-up** — improving precision while dropping recall is a regression, not a win.
- **Targeted (curated FP set).** CRB's golden comments aren't selected for the FP shapes this TDR targets, so
  curate a small labelled set via `/new-eval-from-pr`, which already writes slices with `expected[]`,
  `outOfScope[]`, and `falsePositives[]` to `evals/datasets/inbox/<slug>/`. Seed it with the enumerated shapes
  (CLI `process.exit()`, operator-controlled input, guarded vulnerability, already-fixed-in-PR) plus real
  production misses. Target: **every `falsePositives[]` entry dropped, every `expected[]` entry kept.** Asserting
  on `falsePositives[]` is a small extension of the CRB scorer (captured today but not yet scored) and is part
  of the chosen option's implementation work.

## Decision

_TBD._

## Consequences

_TBD._

## Implementation notes

_TBD._
