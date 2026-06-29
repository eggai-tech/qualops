# TDR 0006 — Structural Context Enrichment for Issue Verification

**Status:** Proposed — 2026-06-29

**Relationship to [0005](./0005-agentic-issue-verification-v2.md):** 0005 decides *where* false-positive
reduction lives and *what the unit of reasoning is* — a downstream filter (v1) vs. an intrinsic critique phase
over intent-decomposed review (v2). This TDR decides a **different, orthogonal** question: *what code does the
verifying step actually see?* The representation of the context handed to the verifier is independent of the
control-flow architecture 0005 settles. The enrichment proposed here is adoptable under **any** 0005 outcome —
it strengthens v1's per-issue verdict, v2's Phase-4 critique, and even today's status-quo validator equally.
The two TDRs share an eval harness and a sequencing note (see *Relationship to 0005, restated*).

## Context

QualOps reports code-quality and security findings on pull requests; the recurring complaint is **false
positives** (0005 enumerates the shapes: a guarded vulnerability, operator-controlled input flagged as
attacker-controlled, a finding already fixed by a later commit). The pipeline runs
**analyze → review → fix → report → judge**, where the LLM-as-judge false-positive filter today is
`ValidationResolver.validate()` inside the review stage (`src/stages/review/processors/validation-resolver.ts`).
(Note: the `judge` *stage* — `src/stages/judge/index.ts` — is a pass/fail **quality gate** over issue counts,
not a per-issue truth check; it is not the verifier discussed here.)

### What the verifier sees today

`ValidationResolver.validateWithAI()` (`validation-resolver.ts:80-158`) is the current false-positive filter,
and it sits in the **weakest possible context position**:

- It receives **only `issue.context`** — a `string` snapshot (`ReviewIssue.context`,
  `src/shared/types/index.ts:122`) captured by the review step at finding time — plus the finding's own
  `description`/`reasoning`/`location` (`validation-resolver.ts:88-102`). It has **no access to the file, the
  surrounding scope, the definitions of the symbols involved, or the call chain.**
- It is a **single batched LLM call** over all issues at once (one prompt, JSON-in/JSON-out,
  `validation-resolver.ts:104-120`), at `temperature: 0` with structured output. It has **no tools and cannot
  read code.**

This is, almost verbatim, the position 0005 calls out as structurally unable to see the disconfirming
evidence: *"a downstream judge that sees only a captured snippet certainly cannot"* see the validation two
files away or the guard up the call chain (0005, *Context*). The verifier cannot confirm "this input is
validated elsewhere" or "this sink is guarded" because the relevant code is simply not in its window.

### Why structure, specifically

External research on AST/structural representations for LLM code review converges on one mechanism:
**precise, structurally-sliced context beats whole-file or snapshot context for false-positive reduction**,
because it puts the warning-relevant code *and its data/control dependencies* in front of the model while
stripping noise. Representative empirical results (all author-reported, several peer-reviewed; see *Caveats*):

- **LLM4FPM** (CPG-based forward/backward slicing of warning-relevant lines): D2A label accuracy ~53% → 86%,
  >85% false-positive elimination on real OSS projects.
- **LLM4PFA** (static-analysis-derived path/reachability constraints fed to the LLM): 72–98% of false
  positives eliminated at ~0.93–0.94 accuracy, recall ~0.86–0.88.
- **LLMxCPG** (Code Property Graph slicing): input code shrunk 68–91% while *improving* detection; concise,
  dependency-aware context called "a key factor."
- **cAST** (AST-boundary chunking vs. line windows): Recall@5 +4.3 on retrieval, Pass@1 +2.67 on generation.

Two findings from that research are **load-bearing caveats** for this TDR and shape the design below:

1. **It is "structural context," not "feed the AST."** The gains come from *graph/slice-derived context*
   (definitions, references, data-flow, call-chain guards), extracted *using* AST tooling. The one study that
   fed a **serialized AST as model input** found it traded false-positive reduction for a **recall collapse**
   (0.95 → 0.72) and that AST fine-tuning alone failed. So the thesis is "enrich the verifier with
   structurally-relevant *code*," not "represent code as a tree to the model."
2. **Structure is not a free lunch — it trades against recall.** Tightening context can silence real bugs.
   This is why the eval below asserts on **recall, not only false-positive rate.**

### The narrow, concrete gap

`ReviewIssue` already carries `file` and `line` (`src/shared/types/index.ts:113-114`). The verifier therefore
*knows where the finding is* but is handed only a flat `context` string about it. The gap this TDR addresses is
exactly: **between knowing the location and judging the finding, gather the structurally-relevant code** — the
enclosing scope, the definitions of the symbols named in the finding, their references, and the guards on the
path to the flagged sink — and put *that* in front of the verifier instead of (or in addition to) the snapshot
string.

## Proposed direction

Add a **structural context enrichment** step that, given a finding's `file`/`line`/symbols, produces a focused
code slice for the verifier. Extraction is mechanical and language-aware via **tree-sitter** (multi-language,
JS/TS-native, already the practical primitive for this; ast-grep is a candidate for the pattern-match parts).
The enriched slice — not the flat `context` string — becomes the verifier's input.

Candidate enrichments, in rough order of value-to-effort (the root-cause check below decides which matter):

- **Enclosing scope + definitions of named symbols** — the function/block containing the finding, plus the
  definitions of identifiers the finding references. Cheapest; addresses "reasoned poorly about code it half-saw."
- **References / call sites** — where the flagged symbol is used, to surface a validating caller or a guard.
- **Call-chain / path guards toward the sink** — the strongest FP lever in the research (LLM4PFA-style
  reachability), and the most expensive to build. Likely a later increment, gated on the root-cause findings.

This step is **representation, not control flow**: it is a context-builder the verifier calls, wherever the
verifier ends up living per 0005.

## Options Considered

### Option 1 — Status quo (snapshot string only)

Keep `validateWithAI()` judging on `issue.context` with no code access.

**Pros:** Cheapest; no parsing, no checkout dependency, deterministic input.

**Cons:** Structurally cannot see cross-file disconfirming evidence — the exact blind spot driving the dominant
FP shapes. The research's weakest context position.

### Option 2 — Give the verifier read/grep tools (agentic, unslice)

Let the verifier read files and grep at its own discretion (as 0005 v2's Phase-4 critique envisions).

**Pros:** Maximum flexibility; the model fetches whatever it decides it needs; no parser to build/maintain.

**Cons:** Non-deterministic context (model-decided), higher cost/latency/turns per finding, and it re-derives
structure ad hoc per finding via text grep — precisely the "complete-but-noisy" context the research shows is
*worse* than a precise slice. Reintroduces prompt-injection surface (reading PR-authored code with tools).

### Option 3 — Deterministic structural enrichment (this proposal)

Mechanically build a focused, dependency-aware slice via tree-sitter and hand it to the verifier.

**Pros:** Matches the research's strongest, most consistent result (precise slice > snapshot and > noisy
whole-file). Deterministic and bounded (no model-decided fan-out). Cheaper per finding than open-ended tool use.
Adoptable under any 0005 outcome. Tree-sitter is multi-language and already the natural choice given prior
tooling discussion.

**Cons:** A parser/slicer to build and maintain; language coverage is per-grammar work. Slice quality bounds
the benefit (a bad slice can *omit* the disconfirming evidence — and the research's recall caveat means an
over-tight slice can silence real bugs). Adds a checkout/parse dependency to verification. Call-chain/path
slicing (the highest-value enrichment) is genuinely expensive.

### Option 4 — Hybrid: deterministic slice as the agent's starting context

Build the structural slice (Option 3) and *also* let the verifier widen with tools (Option 2) when the slice
is insufficient.

**Pros:** Best-of-both — precise default context, escape hatch for the cases a static slice misses; mitigates
Option 3's "bad slice omits evidence" con. Aligns with 0005 v2's tool-capable critique while keeping the
*default* context precise.

**Cons:** Most moving parts; combines both cost profiles; the escape hatch reintroduces non-determinism unless
bounded.

### Comparison

| Criterion | 1 — Snapshot | 2 — Tools only | 3 — Slice | 4 — Slice + tools |
|---|---|---|---|---|
| Sees cross-file disconfirming evidence | ❌ | ✅ (if model looks) | ⚠️ (if sliced in) | ✅ |
| Matches research "precise > noisy" | ❌ | ❌ noisy | ✅ | ✅ |
| Deterministic / bounded context | ✅ | ❌ | ✅ | ⚠️ bounded escape |
| Cost / latency per finding | ✅ lowest | ❌ highest | ⚠️ medium | ❌ high |
| Implementation cost | ✅ none | ⚠️ low (tool wiring) | ❌ parser/slicer | ❌ largest |
| Prompt-injection surface | ✅ minimal | ❌ reads PR code | ⚠️ reads PR code | ❌ reads PR code |

## Validation — does enrichment actually reduce FPs without costing recall?

This TDR rests on the claim that **QualOps's false positives are substantially caused by the verifier lacking
structurally-relevant code it could have been handed.** That is testable, and it shares 0005's harness.

- **Root-cause check (shared with 0005, decisive for *which* enrichment).** 0005's gate already proposes
  pulling 5–10 real FPs from `evals/datasets/crb/` and classifying whether the disconfirming evidence lived in
  unseen code. Extend that classification with *what structural relationship would have surfaced it* —
  enclosing scope? a definition? a reference/caller? a call-chain guard? The distribution directly orders the
  enrichments above and tells us whether the cheap ones (scope + definitions) suffice or the expensive
  call-chain slice is required.
- **Precision *and* recall on the CRB scorers.** Reuse `evals/src/scorers/crb-pairwise.ts`
  (`crb_precision = TP/(TP+FP)`, `crb_recall = TP/(TP+FN)`). Run enriched-verifier vs. the snapshot-string
  baseline as a Langfuse experiment. **Pass condition: precision up, recall flat-or-up.** The recall guard is
  not optional — the research shows tightening context can drop recall, so a precision win with a recall drop
  is a *failure*, not a trade.
- **Targeted FP regression set.** Seed `evals/datasets/inbox/<slug>/` (via `/new-eval-from-pr`) with the
  enumerated FP shapes whose disconfirming evidence is structural (guarded sink, validating caller). Target:
  every such `falsePositives[]` entry dropped, every `expected[]` entry kept.

## Relationship to 0005, restated

|  | 0005 — review architecture | 0006 — context representation |
|---|---|---|
| Question answered | *where* verification lives, *what unit* it reasons over | *what code* the verifier sees |
| Axis | control flow | input representation |
| Independence | — | adoptable under any 0005 outcome |
| Shared | CRB precision/recall harness, root-cause check, `falsePositives[]` regression set | same |

**Soft sequencing (not a hard block).** 0005's root-cause experiment is also this TDR's design input: its
classification of real FPs tells us which structural relationships to slice. So ideally run the shared
root-cause check first, then this TDR's design is partly determined by its output. But enrichment can be
prototyped on the cheap enrichments (scope + definitions) in parallel, since those help regardless.

## Decision

_TBD._

## Consequences

_TBD._

## Implementation notes

_TBD. The concrete plug-in site is the verifier's context-building: today `validateWithAI()`'s
`issues.map(... issue.context ...)` (`validation-resolver.ts:88-102`); under 0005 v2, the Phase-4 critique's
context builder. Extraction via tree-sitter against the checked-out PR source._
