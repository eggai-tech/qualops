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
boundary enforcement and `maxTurns` / `maxBudgetUsd` / bash `maxCallsPerReview` caps. The question this TDR
answers is how to bring real investigation to bear on false-positive removal.

## Options Considered

This TDR makes two nested decisions: **(1) where false-positive filtering should live**, and **(2) how a
verdict on each finding is reached**.

### Decision 1 — Where does false-positive filtering live?

#### Option 1A — Enhance the existing validation step (chosen home)

Keep false-positive removal inside `ValidationResolver`, in the same pipeline position
(`review → validate → dedup`), and change only the *mechanism* of the AI step. The output type stays
`ReviewIssue[]`; the confidence pre-filter (`:49-57`) and all call sites are unchanged.

**Pros:**
- Validation already owns false-positive removal — one home, one responsibility.
- No new stage wiring, metadata, or orchestration; smallest blast radius.
- Medium- and low-severity findings remain covered (they all reach validation).

**Cons:**
- None material — it is the natural home.

---

#### Option 1B — New standalone "verify" stage between review and fix

Leave the batched validation intact and add a separate agentic verification stage on top of it.

**Pros:**
- Clean separation of concerns; can be toggled independently of validation.

**Cons:**
- Two false-positive filters doing overlapping work, with ambiguous ownership.
- More orchestration, stage metadata, and configuration surface.
- The existing batched judge remains as redundant, now-dead-weight surface.

Rejected — it duplicates a responsibility validation already holds.

---

#### Option 1C — Fold verification into the fix stage

Have the fix agent decide whether a finding is a false positive before generating a fix.

**Pros:**
- The fix agent already inspects code with tools, so the capability is nearby.

**Cons:**
- The fix stage only processes HIGH-severity, confidence ≥ 7, non-ESLint issues
  (`src/stages/fix/index.ts:14-23`). Medium- and low-severity findings would never be verified.
- For any run that does not fix (report-only), false positives would still reach the report.

Rejected — wrong coverage.

**Decision 1 → Option 1A.** Filtering stays in validation.

---

### Decision 2 — How is a verdict reached?

#### Option 2A — Batched, no tools (status quo)

One LLM call, all issues, pattern-only judgement. Already shown above to miss evidence-based false
positives. This is the baseline being replaced.

---

#### Option 2B — Single agentic run, all issues, with tools

One agent receives the whole list plus bash/read/grep and returns all verdicts.

**Pros:**
- Cheaper than per-issue (one context, one run).
- Can reason about cross-issue relationships in a single pass.

**Cons:**
- Keeps the **divided-attention** weakness — the core reason 2A misses findings — because the model still
  splits focus across N issues.
- Keeps the all-or-nothing parse failure.
- Bolting tools onto a batch does not deliver focused investigation.

Rejected — it does not address the root cause.

---

#### Option 2C — Per-issue agentic run, tightly bounded (chosen)

Each issue gets its own agentic run with bash/read/grep, bounded by a low `maxTurns`, a small
`maxBudgetUsd`, and a small bash call cap so it performs a *focused, targeted* check rather than open-ended
exploration. Runs execute concurrently (bounded by `processConcurrently`,
`src/shared/utils/concurrency.ts` — the same utility the fix stage already uses). Each returns a full
verdict `{is_false_positive, confidence, severity, reasoning, evidence}`.

**Pros:**
- Maximum focus and depth per finding; the agent actually inspects the checked-out repository to confirm or
  refute the finding.
- Failures are isolated to a single finding (and fail open — see Decision).
- Clean per-finding evidence trail recorded on the kept issue.

**Cons:**
- N agentic runs cost more time and tokens than one batched call. Mitigated by tight per-issue bounds,
  bounded concurrency, and a `maxIssues` guard that falls back to the batched call for pathologically large
  lists.

**Decision 2 → Option 2C.**

---

### Comparison

| Criterion                | 2A — Batched, no tools | 2B — Single run + tools | 2C — Per-issue + tools |
|--------------------------|------------------------|-------------------------|------------------------|
| Investigates the code    | ❌                     | ✅                      | ✅                     |
| Focus per finding        | ❌ divided             | ❌ divided              | ✅ dedicated           |
| Failure isolation        | ❌ batch-wide          | ❌ batch-wide           | ✅ per-finding         |
| Evidence trail           | reasoning only         | shared transcript       | ✅ per-finding         |
| Cost                     | ✅ lowest              | ⚠️ medium               | ⚠️ highest (bounded)   |
| Reuses agentic infra     | n/a                    | ✅                      | ✅                     |

## Decision

Replace the batched `validateWithAI()` AI step with **per-issue, tightly-bounded agentic verification**
(Option 1A + Option 2C).

For each issue that clears the confidence pre-filter, run one bounded agentic call with sandboxed
bash/read/grep tools that investigates the finding in the checked-out repository and returns a structured
verdict. Drop issues judged false-positive; keep the rest with possibly-revised confidence/severity plus the
recorded evidence. Runs are concurrent and bounded. A failed or unparseable verdict **fails open** (the
finding is kept) and is isolated to that single issue, so verification can never silently delete a real
finding the way the batch can today.

For pathologically large finding lists (above a configurable `maxIssues` threshold), verification falls back
to the existing batched call rather than launching an unbounded number of agentic runs.

## Consequences

- **Contributors:** false-positive removal now reads the code instead of guessing from a snippet; reports
  carry an `evidence` trail per kept finding. A new `verification` config block tunes concurrency and
  per-issue caps.
- **Consumers / operations:** review runs cost more time and tokens (N bounded agentic runs vs one call),
  controlled by `concurrency`, `maxTurns`, `maxBudgetUsd`, `bashMaxCalls`, and the `maxIssues` fallback
  guard. Verification requires the repository to be checked out at the reviewed commit (already a
  prerequisite for agentic mode) so bash can inspect it.
- **Reliability:** a malformed or failed verdict no longer drops the whole batch — only that one run, and it
  fails open. The Anthropic adapter gains a configurable output schema; this is additive and the existing
  review path is unchanged.
- **Reversibility:** the batched path is retained as the `maxIssues`-exceeded fallback and can be restored
  by configuration, so the decision is low-risk to roll back.

## Implementation notes

Key touch points (full step list lives with the implementation plan):

- `src/stages/review/processors/validation-resolver.ts` — replace the `validateWithAI()` internals; keep
  `validate()` and the confidence pre-filter unchanged.
- `src/stages/review/processors/issue-verifier.ts` *(new)* — per-issue agentic verifier; reuses
  `createAgentAdapter`, `PromptLoader.load`, and `ConfigService.getResolvedStageConfig('review')`.
- `src/ai/shared/schemas/verification-verdict.ts` *(new)* — single-object verdict schema, reusing the field
  descriptions from `ValidationResultItemSchema` (`src/ai/shared/schemas/validation-result.ts`).
- `src/stages/review/agentic/adapters/agent-adapter.ts` and `anthropic-adapter.ts` — add an optional,
  configurable structured-output schema so an agentic run can return a verdict instead of review issues
  (the adapter currently hardcodes the review-issues schema).
- `src/shared/types/index.ts` — optional `evidence` field on `ReviewIssue` for the report.
- `src/config/config-schema.ts` and `qualops-config.schema.json` — a `verification` config block.
- Concurrency reuses `processConcurrently` (`src/shared/utils/concurrency.ts`).
