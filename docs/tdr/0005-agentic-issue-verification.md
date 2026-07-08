# TDR 0005 — Intent-Based Agentic Review (Plan → Execute → Aggregate → Critique)

**Status:** Rejected (Opus 4.6) — 2026-07-02 (built and A/B-tested on Opus 4.6; recall and F1 *worse* than the flat baseline at ~4× cost — see *Evidence* and *Decision*). Smaller models untested. Originally Proposed 2026-06-22.

**Two framings of the same problem.** False positives can be framed as a *filtering* problem — clean an
existing finding stream with cheaper downstream levers (deterministic pre-checks, richer context, a tightened
verdict) — or as a *review-architecture* problem — they are evidence the review step reasons too shallowly, to
be fixed by redesigning review generation itself. This TDR proposes and evaluates the second (intent-based
redesign) and, having **rejected** it on Opus 4.6, records the *filtering* levers as the path forward — see
[*The options to pursue*](#the-options-to-pursue) under Consequences. The two differ in unit
(finding vs. intent), fix location (downstream filter vs. review generation), and critique (separate stage vs.
intrinsic phase); the filtering framing is the floor, the redesign was the (unrealized) ceiling.

## Context

QualOps reports code-quality and security findings on pull requests. The recurring complaint is **false
positives** — findings that survive to the report but are not real problems. Common shapes:

- a `process.exit()` in a CLI entry point flagged as a "bug",
- an "unvalidated input" that is in fact operator-controlled, not attacker-controlled,
- a vulnerability that is already guarded by a check elsewhere in the call chain,
- a finding against code that a later commit in the same PR already fixed.

Today, review runs as a **single flat agentic loop**. `AgenticExecutor`
(`src/stages/review/agentic/agentic-executor.ts`) builds one user prompt over a set of files
(`buildUserPrompt(files, config)`), hands the model bash/read/grep with `maxTurns`/`maxBudgetUsd` caps, and
parses findings out of the result. A downstream batched LLM call in `ValidationResolver.validateWithAI()`
(`src/stages/review/processors/validation-resolver.ts:80-158`) then tries to drop false positives.

The common thread in the false-positive shapes above is **missing cross-file, intent-level context**. The
input *is* validated — two files away. The vulnerability *is* guarded — elsewhere in the call chain. The bug
*was* fixed — by a later commit in the same change set. A file-by-file reviewer that reasons in one pass
cannot reliably see this evidence, and a downstream judge that sees only a captured snippet certainly cannot.
The false positives are an artifact of the **unit of review** (a file) and the **shape of reasoning** (one
flat pass), not merely of a missing filter.

This is how human reviewers — and how Claude Code itself — approach the same task. A senior reviewer does not
think "file A, then file B"; they ask "what is this PR trying to do, and does the change across these files
correctly and safely achieve it?" They decompose the diff by **intent**, verify each intent end-to-end across
whatever files it touches, then critique their own conclusions before speaking. Claude Code structures complex
work the same way (see *Grounding* below): a coordinator that plans and decomposes, workers that execute
focused tasks, and an independent adversarial verification pass.

The problem is too complex to solve with a single agent prompt and loop. It is a **workflow**: a small number
of deterministic phases — plan/decompose, execute, aggregate, critique — each driven by its own prompt and,
where useful, its own sub-agents and tool loops. This TDR proposes that architecture and weighs it against the
status quo and against v1's filtering approach.

## Grounding — transferable patterns, and provider-agnosticism

Production agent systems converge on the same shape for complex work — and it is **not** a bigger loop. The
transferable principles, with Claude Code cited as one well-documented reference (*Claude Code from Source*,
`book/ch05,ch08,ch10`):

- **Planning is its own phase, not bolted onto the loop.** A core agent loop is a forward-moving
  call→tools→repeat machine with no planning step; planning lives in a separate plan/decompose phase that
  *precedes* execution and distils work into specific, scoped tasks (Claude Code's coordinator: Research →
  Synthesis → Implementation → Verification; "never delegate understanding" — vague delegation is lossy).
- **Sub-agents are isolated and return only results.** A child runs with its own context, tool set, and
  permission boundary; the parent sees the final output, not the reasoning. Fan-out is deliberately fenced to
  avoid exponential spawning.
- **Critique is a distinct adversarial persona** — read-only, told to refute by default, required to produce
  evidence, and barred from spawning further agents.
- **Failure is per-task, recovery is explicit** — no all-or-nothing cascade.

**This must hold across providers, not just Anthropic.** QualOps reviews run through a provider-agnostic
`AgentAdapter` (`src/stages/review/agentic/adapters/`) with `anthropic`, `openai`, and OpenAI-compatible
(`configurable-agent`, per TDR 0004) implementations, so the workflow is designed *above* the adapter and
depends only on the common adapter contract (`run({systemPrompt, userPrompt, model, maxTurns, maxBudgetUsd,
tools, baseUrl})` → `{output, structuredOutput?, tokens, errorSubtype?}`). Concretely:

- **Phases and fan-out are orchestrated by QualOps, not the SDK.** Each phase is a separate `adapter.run()`
  call; sub-agent fan-out is `processConcurrently` over adapter runs. This works identically whether the
  underlying model is Claude via the Anthropic SDK or Mistral/Groq/Ollama via the OpenAI-compatible loop — no
  provider-specific orchestration primitive is required.
- **Provider-specific optimisations are treated as optional accelerators, not load-bearing.** Anthropic
  prompt-cache prefix sharing and fork-agents lower cost when available; the OpenAI-compatible path may lack
  them. The design must be *correct and affordable without them* (via deterministic gating and model tiering,
  below) and merely *cheaper* with them.
- **Capability differences are handled by the existing adapter layer.** Structured output, tool-calling
  reliability, and context-window/compaction differ by model; the adapter already normalises these (e.g.
  `structuredOutput` vs. text parsing, `errorSubtype` codes), so phases consume a uniform result shape.

Two caveats carried into the design, since QualOps runs **unattended on every PR** with no human coordinator:
concurrency is **hard-capped** (not the "3-5 workers" methodology heuristic) and task failure has an
**explicit fail-open/fail-closed policy** (not coordinator judgement).

## Prior art — the `code-review` skill (a working multi-agent reviewer)

A mature, in-use review workflow already encodes many of these patterns: the `code-review` skill
(`~/.claude/skills/code-review/SKILL.md`). It is a six-step workflow — collect context → fan-out review →
validate → filter → collate → output — and it is **evidence that complicates this TDR's thesis as much as it
supports it**, so it is recorded faithfully rather than as endorsement.

**Harness-enforced mechanisms (not prompt-discretionary).** These are the parts the runtime — not the model —
guarantees, and they are what a QualOps workflow must replicate *in code*, independent of any prompt wording:

- **Per-agent tool allowlisting.** The skill's `allowed-tools` frontmatter restricts every agent and subagent
  to read-only git/`gh` plus the inline-comment MCP tool. This is runtime tool-scoping (Claude Code's
  per-agent permission boundary), the same isolation v2 relies on — not a request the model can ignore.
- **Parallel sub-agent fan-out with context isolation.** "Launch 6 agents in parallel" (Step 3) and one
  validation subagent per issue (Step 4) are scheduled and isolated by the harness; each child has its own
  context and returns only its final output. The prompt declares the fan-out; the harness enforces it.
- **Per-task model pinning.** Haiku for cheap precondition/path-collection checks, Sonnet for CLAUDE.md, Opus
  for bug/logic/security/maintainability — a harness routing decision, matching v2's cost-tiering claim.
- **Mode branching and precondition gates.** PR-vs-local control flow, and a hard stop if the PR is
  closed/draft/trivial/already-reviewed — deterministic gating, not model judgement.
- **Output-side-effect gating.** A `--comment` flag switches between writing a local markdown file and posting
  `gh pr comment` + inline MCP comments. Side effects are flag-gated, not left to the model.

**Prompt patterns worth stealing into whichever option wins.** These transfer directly:

- **Adversarial steelman validation.** For maintainability issues, Step 4 instructs the validating subagent to
  *"actively argue against the flagged issue. Only confirm it if you cannot find a reasonable justification for
  the existing code… Only confirm if the problem clearly stands after steelmanning the existing code."* This is
  the cleanest available phrasing for v2's Phase 4 critique persona — refute-by-default, confirm only what
  survives steelmanning — and should be lifted rather than reinvented.
- **High-signal-only gating.** "If you are not certain an issue is real, do not flag it" plus an explicit
  flag/don't-flag list — a precision lever applied at *generation* time, not only at validation.
- **Known-issue false-positive classification.** Step 2 collects prior review comments; Step 4B classifies
  each as Addressed / Still present / **False positive**. This is structurally the same labelled-FP loop as the
  eval `falsePositives[]` corpus — confirmation the FP-tracking concept is sound and already in practice.

**The tension this surfaces — and it is the crux of v1-vs-v2.** The skill decomposes review **by reviewer
dimension** (CLAUDE.md ×2, bug, security/logic, maintainability, structural), *not by intent*, and most agents
are told to **stay inside the diff** (the bug agent: "Focus only on the diff; do not read extra context… Do not
flag issues that require context outside the diff to validate"). Only the maintainability and structural agents
may read beyond the diff. In other words, a working review system deliberately chose **diff-scoped,
dimension-fanned generation** and achieved its false-positive control through the **adversarial validation
step** — *not* by restructuring the unit of review into cross-file intents. This is a real-world prior leaning
toward *"validation, not generation-redesign"*: it is direct evidence that strong precision is reachable
without v2's intent decomposition, and it raises the bar v2 must clear. It also makes the root-cause check
below decisive — the skill implicitly bets that false positives come from *sloppy reasoning over visible code*
(fixable by adversarial validation), which is exactly the hypothesis v2's intent unit only pays off if it is
*false*.

## Proposed architecture — review as a bounded workflow

Review becomes a four-phase workflow. Each phase is a distinct prompt; phases 1, 2, and 4 use agentic
sub-runs with tools; phase 3 is mostly deterministic. The whole thing is **bounded control flow**, not an
open-ended loop — the workflow script owns fan-out and budget; agents own reasoning inside each node.

Schematically, the change is from one flat agentic call to a decompose → fan-out → merge → refute pipeline:

```
  FLAT BASELINE (mode: 'agentic')            PROPOSED v2 (mode: 'agentic-v2')
  ─────────────────────────────             ──────────────────────────────────

                                            diff
                                              │
                                              ▼
                                    ┌───────────────────────┐
                                    │ Phase 1 · PLAN        │  1 agentic run
                                    │ decompose by intent   │  → ReviewPlan
                                    └───────────┬───────────┘    (N intents)
                                                │
                          ┌─────────────────────┼─────────────────────┐
   diff                   ▼                     ▼                     ▼   (bounded
    │            ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  fan-out,
    ▼            │ Phase 2 · VERIFY│  │ Phase 2 · VERIFY│  │ Phase 2 · VERIFY│  concurrency
 ┌──────────┐    │ intent A (tools)│  │ intent B (tools)│  │ intent C (tools)│  cap; one
 │ one      │    └────────┬────────┘  └────────┬────────┘  └────────┬────────┘  agentic run
 │ agentic  │             └─────────────────────┼─────────────────────┘          per intent)
 │ run w/   │                                   ▼
 │ tools +  │                        ┌───────────────────────┐
 │ subagents│                        │ Phase 3 · AGGREGATE   │  deterministic:
 └────┬─────┘                        │ dedup + pre-checks    │  no model
      │                              └───────────┬───────────┘
      ▼                                          ▼
  findings                          ┌───────────────────────┐
      │                             │ Phase 4 · CRITIQUE    │  1 agentic run,
      ▼                             │ refute each finding + │  adversarial
 (downstream                        │ "same issue elsewhere"│  → IssueVerdicts
  validate/dedup)                   └───────────┬───────────┘
                                                ▼
                                          final findings
                                    (critique IS the FP filter)
```

The cost delta is visible in the diagram: the flat path is **one** model call; v2 is **1 + N + 1** agentic
runs (plan, per-intent verify, critique) — the ~4× cost the *Evidence* section measured.

**Phase 1 — Plan & decompose (by intent).** One agentic run reads the PR diff and decomposes it into a small
set of **intents** — the things the change is trying to accomplish (e.g. "add health monitoring to the span
buffer", "harden the auth callback"). Each intent names the files/regions it spans and what end-to-end
property must hold for it to be correct and secure. Output is a structured **review plan**: a bounded list of
intent-scoped verification tasks. This mirrors the coordinator's Research/Synthesis phases and the "never
delegate understanding" rule — the plan carries concrete file paths and the property to check, not a vague
instruction.

**Phase 2 — Execute the plan.** Each intent task is a **focused agentic sub-run** with read/grep/bash,
prompted to "verify this intent end-to-end across its files; report real, evidence-backed findings." Tasks for
disjoint intents run **concurrently, with a hard cap** (`processConcurrently`,
`src/shared/utils/concurrency.ts`). A task returns its findings via a tool/structured output. Because the unit
is an intent spanning all its files, the agent *has the cross-file evidence* that today's file-by-file pass
lacks — the validation two files away, the guard up the call chain — so it produces fewer false positives at
the source and catches cross-file bugs the current pass misses (a recall gain, not only a precision gain).

**Phase 3 — Aggregate.** Deterministic merge of per-task findings: dedup across intents (the same root issue
surfaced by two intents), reconcile overlapping line ranges, and apply the cheap deterministic pre-checks from
v1 (e.g. "already fixed by a later commit in this PR" via `git log -L`/blame — no model needed). This phase is
LLM-free and stable.

**Phase 4 — Critique (adversarial self-review).** A distinct persona — modelled on Claude Code's Verification
agent — takes the aggregated findings and is told to **refute** them: open the code, attempt to prove each
finding is *not* real (operator-controlled input, guard exists, unreachable), and require an evidence block
for the verdict. Crucially, this phase also does the inverse sweep the current pipeline cannot express:
**"given this confirmed finding, check whether the same class of issue exists elsewhere in the changed code"**
— one confirmed finding seeds a focused targeted review, the way a senior reviewer says "you forgot to escape
here — and here, and here." Phase 4 is structurally close to Phase 2 (same investigate-with-tools capability)
but with a different persona, return shape, and possibly a different model/reasoning tier; the two can share
machinery.

Phase 4 is the false-positive filter — but it is *part of producing the answer*, not a separate stage cleaning
a stream. There is no standalone "verification stage" to place in the pipeline; critique is the last phase of
review.

### Mapping to the current agentic execution path

This workflow is scoped to the **agentic execution path only** (`mode: 'agentic'`). It does **not** touch the
`file-by-file` / prose paths or the shared `PipelineExecutor` plumbing (validation/dedup resolvers, etc.);
those are explicitly out of scope. The four phases are a **re-orchestration of `AgenticExecutor.execute`**
(`src/stages/review/agentic/agentic-executor.ts:56`), not new infrastructure. How each phase maps onto what
exists today:

  | Phase                  | Maps to in the agentic path                                                                                                                               | Status today                                                                                                                                                                                         |
  |------------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
  | **1 — Plan/decompose** | A new step before the agentic run, replacing `buildUserPrompt(files)` (`agentic-executor.ts:77`, `prompt-builder.ts:3`)                                   | **Missing.** The unit is the whole file set; `buildUserPrompt` only churn-sorts files (`prompt-builder.ts:14-18`) — the opposite of intent grouping.                                                 |
  | **2 — Execute**        | The **existing subagent framework** (`createSubagentDefinitions`, `subagents/definitions.ts:52`; the adapter's `agents` param, `agentic-executor.ts:103`) | **Partial — strong base.** Isolated workers, per-agent tools, and per-agent model overrides (`applyModelOverrides`, `:196`) already exist. Missing: intent-scoped dispatch + a **hard fan-out cap**. |
  | **3 — Aggregate**      | Issue collection + `confidence >= 7` filter + `normalizeIssue` (`agentic-executor.ts:152-178`)                                                            | **Degenerate.** Concatenation + a threshold only. Dedup and deterministic pre-checks lived in `PipelineExecutor` — now out of scope — so within the agentic path Phase 3 is **net-new**.             |
  | **4 — Critique**       | A new final agentic sub-run reusing the same `adapter.run` + subagent machinery (`agentic-executor.ts:100`) with a refute persona                         | **Missing.** The agentic path has no critique step of its own; the old `ValidationResolver` is out of scope. **Net-new.**                                                                            |

Two semantic shifts this surfaces, both worth naming because they are the crux of the redesign:

- **Capability decomposition → intent decomposition.** Today's subagents (`dependency-tracer`,
  `breaking-change-detector`, `security-analyzer`, `pattern-validator` — `agentic-executor.ts:30-35`) are
  **capability/dimension** helpers the coordinator invokes opportunistically. Phase 2's workers are
  **intent-scoped** ("verify *this* intent end-to-end across its files"). Same worker machinery, different
  decomposition axis. This is the same capability-vs-intent tension the TDR flags about the `code-review`
  skill (above) — it applies to QualOps's *own* existing subagents too.
- **Model-decided fan-out → deterministic fan-out.** Today `adapter.run` lets the model decide if/when to
  spawn subagents inside one loop (`agentic-executor.ts:100-120`). That directly **violates** the design
  constraint below ("not model-decided"). V2 makes the workflow script own decomposition and fan-out; the
  model owns reasoning *inside* a node.

So in the agentic path, Phases 1 and 4 are genuinely new, Phase 3 is new (its old home is out of scope), and
Phase 2 is a re-orchestration of an existing subagent framework. Context-building (`buildUserPrompt` /
`buildFileContext`, `prompt-builder.ts`) is still whole-file/whole-diff and churn-sorted today; it is replaced
by Phase 1 (intent scoping) and is also the plug-in site for [0006](./0006-structural-context-enrichment-for-verification.md)'s
structural slicing in Phase 4.

### Implementation strategy — `AgenticExecutorV2` behind a new mode

To evaluate v2 against today's behaviour **without a risky in-place rewrite**, build the workflow as a new
`AgenticExecutorV2` selected by a new review mode, so both implementations coexist and A/B comparison is a
config flip:

- **New mode value.** Extend `ReviewMode` (`src/shared/types/config.ts:18`) from
  `'file-by-file' | 'agentic'` to also include `'agentic-v2'`.
- **Single new dispatch branch.** The only change to `PipelineExecutor` is one branch in `execute()`
  (`pipeline-executor.ts:72-76`): `mode === 'agentic-v2'` → `executeAgenticJobV2` → `AgenticExecutorV2`. This
  is the *minimal* touch the "don't rewrite the pipeline executor" constraint allows — a sibling branch, not a
  modification of the existing `agentic` path.
- **`AgenticExecutorV2` is a sibling, not a replacement.** It reuses the existing adapters, subagent loader,
  tools, and result parser; the new logic is the four-phase orchestration around them. The current
  `AgenticExecutor` is left **untouched** so `mode: 'agentic'` remains the stable baseline.
- **Why this shape.** It lets the CRB/Langfuse experiments below run `agentic` vs. `agentic-v2` as two
  variants on the same harness (the eval config sets `mode`), so the precision/recall comparison is
  apples-to-apples and migration is a decision made *on evidence*, not committed up front. The v2 mode can ship
  disabled-by-default and be promoted only if it clears the pass condition.

### Design constraints (where this departs from Claude Code's defaults)

QualOps runs unattended on every PR, so two of Claude Code's "methodology-driven" choices must become
hard mechanisms:

- **Deterministic, bounded fan-out — not model-decided.** The workflow script decomposes (Phase 1 proposes
  intents; the script caps how many become tasks) and fans out (Phase 2 runs them under a fixed concurrency
  and per-task `maxTurns`/`maxBudgetUsd`). We do **not** let an orchestrator agent spawn sub-agents at its own
  discretion: that re-introduces the divided-attention and unbounded-cost failures v1 identifies, and there is
  no human to catch a runaway. "Give the LLM all findings and let it decide the fan-out" is explicitly
  rejected for this reason.
- **Explicit failure & fallback policy.** A failed Phase-2 task is isolated (its intent's findings are
  dropped or marked low-confidence — a **fail-open vs fail-closed** choice that must be made explicitly, as in
  v1). A pathologically large diff falls back to a cheaper path (e.g. v1's batched verdict), and that fallback
  is **logged and surfaced**, never silent — large PRs are the ones most likely to carry false positives.

## Options Considered

### Option 1 — Status quo (flat loop + batched downstream filter)

Keep the single-pass `AgenticExecutor` and the batched `ValidationResolver`.

**Pros:**
- Cheapest and simplest; no new orchestration.

**Cons:**
- Reviews file-by-file with no planning/decomposition, so it structurally lacks the cross-file evidence that
  the dominant false-positive shapes require. The downstream filter inherits the same blind spot.

---

### Option 2 — v1 filtering (better verdict mechanism on the current stream)

The filtering framing: keep review as-is, and improve the false-positive *filter* — deterministic pre-checks, a
per-issue agentic verdict, or tiered escalation. (See [*The options to pursue*](#the-options-to-pursue)
under Consequences for the full menu.)

**Pros:**
- Incremental and lower-risk; reuses the existing pipeline scaffolding.
- Deterministic pre-checks and tiered escalation are cheap, high-value, and **carry over into Option 3 as
  Phase 3 / gating** — so this work is not wasted even if Option 3 is later adopted.
- **Has a proven instantiation.** The `code-review` skill (above) is essentially "this option done well":
  diff-scoped, dimension-fanned generation plus adversarial steelman validation, and it produces high-signal
  results in practice without any intent-based generation redesign. That weakens the "treats symptom not
  cause" objection — the symptom-level approach demonstrably works.

**Cons:**
- May treat the symptom (bad findings) rather than the cause (shallow, file-scoped review) — *if* the cause is
  in fact missing cross-file context. A per-issue verifier re-derives cross-file context one finding at a time
  that an intent-based review would establish once. (Whether this con is real is exactly what the root-cause
  check below decides — the skill is evidence it may not be.)
- Adds the false-negative, non-determinism, latency, checkout-dependency, and prompt-injection risks v1
  documents. It does not, on its own, bring the recall upside intent-based review claims — though the skill's
  structural/eagle-eye agent shows some cross-file recall is reachable within a dimension fan-out.

---

### Option 3 — Intent-based review workflow (this proposal)

Plan → execute → aggregate → critique, as above.

**Pros:**
- Attacks false positives **at the source**: the intent unit gives the reviewer the cross-file evidence the
  FP shapes depend on, so fewer bad findings are produced in the first place.
- **Recall gain, not only precision:** intent-level verification and the Phase-4 "same issue elsewhere" sweep
  catch cross-file bugs the file-by-file pass misses.
- Critique is intrinsic to producing the answer (adversarial self-review), matching how humans and Claude
  Code actually review — no separate verification stage to wire and place.
- Maps onto proven patterns (coordinator phases, isolated sub-agents, adversarial verifier). Affordability
  rests on provider-agnostic controls — deterministic gating and model tiering (read-only search on a cheap
  tier); provider-specific accelerators (Anthropic prompt-cache prefix sharing, fork-agents) lower cost
  further *when available* but are not assumed on the OpenAI-compatible path.

**Cons:**
- **Largest change:** it redesigns review *generation*, not just filtering — higher implementation and
  validation cost, and a bigger behavioural shift to evaluate.
- **Highest cost/latency per PR**, because every review now runs a multi-phase workflow. This makes the cheap
  gates (deterministic pre-checks; "is this a 3-line dep bump?" skip) **load-bearing**, not optional.
- More moving parts: a plan whose quality bounds everything downstream (a bad decomposition mis-scopes every
  task), plus per-phase prompts and failure policies to tune.
- Inherits the agentic risks (non-determinism, checkout-dependency, prompt-injection surface from reading
  PR-authored code with tools) across more phases.

---

### Comparison

 | Criterion                   | 1 — Status quo | 2 — v1 filtering         | 3 — Intent workflow        |
 |-----------------------------|----------------|--------------------------|----------------------------|
 | Cross-file / intent context | ❌ file-scoped | ⚠️ re-derived per finding | ✅ native unit             |
 | Attacks cause vs symptom    | —              | symptom                  | ✅ cause                   |
 | Precision (fewer FPs)       | ❌             | ✅                       | ✅                         |
 | Recall (fewer missed bugs)  | baseline       | ❌ no gain               | ✅ gain                    |
 | Built-in critique           | ❌             | ⚠️ separate stage         | ✅ intrinsic phase         |
 | Cost / latency              | ✅ lowest      | ⚠️ medium                 | ❌ highest (gated)         |
 | Implementation risk         | ✅ none        | ⚠️ moderate               | ❌ largest                 |
 | Reuses proven patterns      | n/a            | partial                  | ✅ CC coordinator/verifier |

## Validation — does the hypothesis hold?

Option 3 rests on one empirical claim: **today's false positives stem mainly from missing intent/cross-file
context, not from sloppy reasoning over code the model already saw.** This is testable before committing to the
architecture — and the test now adjudicates between **two demonstrated approaches** (the `code-review` skill's
validation-centric, diff-scoped design vs. Option 3's intent-based generation), not one real and one
hypothetical. The skill is a standing prior that the validation-centric approach suffices; Option 3 must show
the prior is wrong on QualOps's actual false positives.

- **Root-cause check (gate before building).** Pull 5–10 real false positives from the CRB dataset
  (`evals/datasets/crb/`) and classify each: *was the disconfirming evidence in a file the file-by-file
  reviewer never looked at?* If the dominant cause is "evidence lived elsewhere", Option 3 is justified. If
  most FPs are "the model reasoned poorly about code it did see", then the skill's recipe — better adversarial
  validation (Phase 4 alone, or v1's per-issue verifier) — suffices and the full intent decomposition is
  over-engineering.
- **Precision *and* recall, on the existing harness.** The CRB scorers
  (`evals/src/scorers/crb-pairwise.ts`) already compute `crb_precision = TP/(TP+FP)` and
  `crb_recall = TP/(TP+FN)`. The `AgenticExecutorV2`-behind-a-mode strategy above makes this a clean A/B:
  run the **`agentic`** baseline vs. the **`agentic-v2`** candidate as two variants of the same Langfuse
  experiment (the eval config sets `mode`), so the comparison is apples-to-apples on identical inputs. Pass
  condition is **precision up, recall flat-or-up** (Option 3 should additionally *raise* recall — if it does
  not, its main advantage over v1 is unproven). The new mode ships disabled-by-default and is promoted only
  if it clears this bar.
- **Targeted FP regression set.** Curate real-PR slices via `/new-eval-from-pr`, which writes
  `expected[]`/`falsePositives[]` to `evals/datasets/inbox/<slug>/`; seed with the enumerated shapes plus
  production misses. Target: every `falsePositives[]` entry dropped, every `expected[]` entry kept. (Asserting
  on `falsePositives[]` is a small scorer extension and part of the implementation work.)

## Evidence (2026-06 A/B run)

Option 3 was built (`AgenticExecutorV2` behind `mode: 'agentic-v2'`) and run head-to-head against the flat
`agentic` baseline on the CRB `crb-sentry` dataset via the config-driven eval harness (`--config` selecting
two symmetric `.qualops/.qualopsrc-eval-agentic-v{1,2}.json` configs: same Opus model, security system prompt,
budgets, and dedup; the only difference is the executor). The comparison that matters is the **full 10-case
dataset run** of each arm (single-item smoke runs were also done but are too noisy to draw from — see below):

| Metric (mean over 10 cases) | `agentic` (v1) | `agentic-v2` | Δ |
|---|---|---|---|
| crb_precision | 0.248 | 0.239 | −0.009 |
| crb_recall | **0.412** | 0.348 | **−0.064** |
| crb_f1 | **0.299** | 0.246 | **−0.053** |
| wall-clock / item | ~145 s | ~600 s | **~4× slower** |

v2 was **worse on recall and F1** than the flat baseline, at ~4× the cost. This is the opposite of the pass
condition from *Validation* ("precision up, recall flat-or-up, ideally recall up"): recall dropped ~15%
relative and F1 dropped ~18% relative, while cost quadrupled.

**Scope of this result — model-specific, only Opus 4.6 tested.** Both arms ran `claude-opus-4-6`. The finding
that intent-decomposition adds cost without upside may be *specific to a strong model*: the flat single pass
already reasons well over the whole diff, so the decomposition has little attention-headroom to exploit. A
**smaller/cheaper model** (e.g. Sonnet or Hauku tiers) is untested and could plausibly go either way — it might
benefit more from the structured decomposition (the attention-budget hypothesis is strongest when a single
pass is weakest), or it might fail at the planning/critique steps that v2 leans on. This is a real open
question, not a settled one; the rejection below is scoped to the model tested.

**On run-to-run noise.** Several single-item runs were also executed (not all well-logged); they are cited only
to show variance, not as evidence. On the same one case, v2 f1 ranged 0.000 → 0.333 across runs and v1 ranged
0.200 → 0.250 — swings that dwarf any between-arm signal at N=1. This is exactly why the 10-case aggregate is
the basis for the decision, and why a robust conclusion would want N≥3 full-dataset runs (not affordable here
at ~10 min/item for v2, which is itself part of the finding).

Two observations reinforce the negative result:

- The critique phase (Phase 4) *does* drop false positives with reasoning, but the net effect vs. the flat
  path was neutral-to-negative on precision and actively lost recall — the extra generation/critique work did
  not surface findings the cheaper baseline missed.
- Operationally, a Phase-2 verification intent exhausted its turn budget and failed open, losing that intent
  entirely — the added machinery introduces new failure surface without a corresponding quality upside.

## Decision

**Rejected.** Do not adopt Option 3 (intent-based `agentic-v2`) as the default or promoted path. On the full
10-case dataset it was *worse* than the flat `agentic` baseline on recall (0.348 vs 0.412) and F1 (0.246 vs
0.299) at ~4× the cost — the opposite of the pass condition. The
`code-review`-skill prior (validation-centric, diff-scoped) stands: better *validation* of a cheaply-generated
finding stream, not a *generation* redesign, is where the leverage is.

The `AgenticExecutorV2` code remains in the tree behind the disabled-by-default `mode: 'agentic-v2'` flag as a
recorded, runnable negative result — not deleted, not promoted. The rejection is scoped to **Opus 4.6**; the
clearest reason to revisit is a **different (smaller/cheaper) model**, where decomposition might have more to
exploit. If revisited, it must clear the same bar with N≥3 full-dataset runs and a per-item cost that makes the
tradeoff worthwhile.

The genuinely useful artifacts from this effort were **not** the v2 executor but the **evaluation tooling**
built to test it: the config-driven eval entry point (`--config`, per-job executor routing), the
`compare-experiments` precision/recall/cost diff, and the A/B harness. Those generalise to "compare any two
QualOps configs (model per stage, budgets, prompts) on quality vs. cost" and are being extracted to a
dedicated branch/feature independent of this TDR.

## Consequences

- **False-positive reduction reverts to the filtering framing.** The options — deterministic pre-checks,
  richer context capture, a tightened validation/critique on the existing stream — are the path forward, not
  an architectural rewrite. They are catalogued below under [*The options to pursue*](#the-options-to-pursue).
- **Cost is a first-class constraint.** This experiment quantified that multi-phase agentic review multiplies
  token/latency cost several-fold; any future FP work is measured on a quality-*and*-cost frontier, not
  quality alone.
- **Config A/B tooling is the lasting win.** The harness that produced this evidence is reusable for the real
  ongoing question — per-stage model/config cost-quality tradeoffs — and outlives the rejected architecture.
- **Untested: smaller models.** The result holds only for Opus 4.6. Whether intent-decomposition helps a
  weaker model (more attention-limited, more to gain from structure) — or breaks on the planning/critique steps
  — is open. The config-A/B harness above makes this a cheap follow-up: swap the model in each arm's config and
  re-run. Worth doing before the `agentic-v2` code is ever deleted.

### The options to pursue

Concrete filtering options, recovered from the earlier v1 draft so this record is self-contained. They are
complementary — each intervenes at a different point in the pipeline and combines with the others — and none
requires the rejected redesign.

- **Git/diff pre-check (LLM-free).** Drop findings whose lines a later commit in the same PR already fixed —
  `git log -L` / `git blame` on the line range, no model. Deterministic and cheap; narrow (history-visible FPs
  only) and needs precise line-range mapping.
- **Static heuristics (LLM-free).** Pattern rules for common pattern-shaped FPs (`process.exit()` in a
  CLI/entry-point, guard/reachability). Auditable, but each rule carries a precision/recall risk and needs
  validation on labelled data.
- **Tiered verdict.** Cheap batched judge as triage; escalate only the borderline tail (low-confidence /
  near-threshold) to a bounded per-issue agentic run. Attacks the cost weakness of a blanket per-issue pass;
  cost is a threshold to calibrate and two failure modes to handle.
- **Source-side richer context.** Capture more lines / enclosing signature / call site at review time so the
  existing batched judge can reject evidence-based FPs cheaply. Changes what review *produces*, not how a
  verdict is reached.
- **Confidence calibration.** Tune the hard `issue.confidence >= 7` pre-filter (`validation-resolver.ts:49-57`);
  raising the bar trades recall for precision with no model change.

**Measuring any of these** (existing harness):

- **Aggregate (CRB).** `evals/src/scorers/crb-pairwise.ts` already computes `crb_precision` and `crb_recall`.
  **Pass condition: precision up, recall flat-or-up** — precision up at recall's expense is a regression.
- **Targeted (curated FP set).** Curate labelled slices via `/new-eval-from-pr` (`expected[]` / `outOfScope[]`
  / `falsePositives[]`); seed with the four FP shapes plus real misses. **Target: every `falsePositives[]`
  dropped, every `expected[]` kept.** (Scoring `falsePositives[]` is a small scorer extension.)

**Constraints on any FP work:**

- **Baseline first** — measure current FP *and* FN rate, else a precision win can hide a recall regression.
- **Recall guard** — only deterministic checks hard-drop; an LLM/agent verdict may lower confidence but a
  verification *failure* keeps the finding (fail-open). Choose fail-open vs fail-closed explicitly per
  mechanism.
- **No silent fallback** — if a per-issue path falls back to the batched call for large lists, log it; large
  PRs are the likeliest to carry FPs.

## Implementation notes

The rejected implementation (kept for reference) lives on the `feat-reduce-reported-false-positives-implementation`
branch: `AgenticExecutorV2` (`src/stages/review/agentic/agentic-executor-v2.ts`), the per-phase schemas
(`review-plan`, `issue-verdict`), the per-call adapter output schema (`AgentOutputSpec`), and the phase-output
capture in the eval log. Selectable only via `mode: 'agentic-v2'`; off by default.
