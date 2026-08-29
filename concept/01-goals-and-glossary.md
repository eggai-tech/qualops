# 01 — Goals, Principles, Glossary

**Status:** Draft spec for human review · **Normative** (defines terms used by all other spec documents)

## 1. Product goal

QualOps reviews a pull request and delivers the **most reliable feedback possible without polluting the review**. Operationally:

- **Reliable** = every published finding is anchored to real code, evidence-backed, and independently verified. Target: false-positive rate < 10% (the developer-trust threshold), addressed rate > 40%.
- **Non-polluting** = few, stable comments that update instead of repeating, resolve themselves when fixed, and are absent on clean PRs. Silence on a clean small PR is a correct and desirable outcome.
- **Trustworthy in CI** = the gate result is deterministic, configurable in the repo, and honestly reflected in the exit code.

## 2. Non-goals

- **IDE/editor integration** — the CLI + CI surface is the product.
- **Hosted infrastructure** (codebase-index services, dashboards, config UIs) — the repo is the only source of truth; everything runs in the user's CI or shell. Reconsider indexing only if addressed-rate data shows context misses as the dominant refutation cause.
- **Fine-tuning** — adaptation comes from feedback memory and learned rules, not training.
- **Online self-improvement in production** — versions are fixed; improvement happens offline between releases, driven by evals (per the PR #149 research scope).

## 3. Design principles

1. **Generate wide, verify adversarially, filter hard, publish little.** Recall comes from aggressive generation; precision comes from independent verification and deterministic filters — never from asking the generator to be careful (industry evidence: appendix B §3).
2. **Determinism before tokens.** Every check that can be a hash lookup, a glob match, or a diff comparison runs before (and instead of) an LLM call.
3. **Nothing model-generated is trusted un-normalized, un-verified, or un-anchored.** One LLM boundary parses all model output; one verifier confirms every finding; every finding cites the code it is about.
4. **Findings have identity.** Every capability that distinguishes a good reviewer from a spammy one — dedup, update-in-place, auto-resolution, baselines, addressed-rate, memory — derives from stable fingerprints.
5. **Config is prose where prose wins, structure where lifecycle wins, and absent where the tool already knows.** (Spec: [04-configuration-spec.md](04-configuration-spec.md).)
6. **Loud failure beats silent degradation.** Unknown config keys, unparseable model output, missing adapters, and skipped work are errors or visible notices — never silent fallbacks.
7. **Measured, not asserted.** Every quality claim in this spec has a metric in [05-quality-spec.md](05-quality-spec.md); every phase in [06-roadmap.md](06-roadmap.md) ships with a before/after eval run.

## 4. Glossary (normative)

These terms replace all earlier vocabulary. Legacy terms (jobs, passes, subagents, customAgents, judge stage, validation pass) appear only in appendix documents and migration notes.

| Term | Definition |
|---|---|
| **Reviewer** | A configured review step: a markdown file (frontmatter + instructions) with mode `checklist` (single structured pass) or `agent` (tool-using investigation). Built-in and custom reviewers share the format. Replaces: job, pass, subagent, customAgent, specialist. |
| **Finding** | The unit of feedback. Carries fingerprint, anchor, category, severity, description, optional fix proposal, evidence, and verification. Lifecycle: `candidate → (filtered | refuted | artifact-only) | admitted → published → (addressed | dismissed | suppressed)`. |
| **Fingerprint** | Stable content-derived identity: `sha256(file + category + normalized description + anchor snippet)[0..16]`. Line-drift tolerant (lines are not hashed), content-aware, cross-run stable. |
| **Anchor** | A finding's location: file, line range, and the snippet of anchored code. Re-anchoring = relocating the snippet after new pushes. |
| **Evidence** | Machine-checkable support attached to a finding: code citation, executed check (grep/ast-grep via sandbox), or cited data-flow trace. Required for admission. |
| **Verifier** | An independent agent that judges one candidate finding with fresh context (claim + retrieved code; never the generator's reasoning). Emits a verdict and confidence 0–100. The generator's self-rated confidence is diagnostic only and never gates. |
| **Verdict** | `confirmed` \| `refuted` \| `needs-more-evidence`. Promotion policy: confirmed → eligible for admission; refuted → dropped (retained in artifacts for eval capture); needs-more-evidence → **artifact-only** (visible in the report artifact, never published to the PR). |
| **Admission** | The deterministic decision that a verified finding may be published: confidence threshold, severity floor, volume budget, memory suppression, baseline. Every rejection records a **RejectReason** (`out-of-scope`, `citation-failed`, `duplicate-fingerprint`, `category-excluded`, `below-vote-threshold`, `linter-owned`, `refuted`, `needs-more-evidence`, `below-confidence`, `below-severity-floor`, `volume-budget`, `feedback-suppressed`, `baseline-suppressed`). |
| **Gate** | The CI pass/fail decision computed from admitted findings vs. configured thresholds, honestly reflected in the process exit code. Replaces the legacy "judge" stage. Deterministic; never an LLM. |
| **Baseline** | The fingerprint set of findings pre-existing on the base branch. With `gate.baseline: true`, only findings the PR introduces can fail the gate. Managed via `qualops baseline`. |
| **Publish** | Posting to an integration: one summary comment updated in place + fingerprint-marked resolvable inline threads, under the incremental re-review protocol. |
| **Review state** | Per-PR persisted record of published fingerprints, thread IDs, and resolution status; the substrate for incremental re-review, auto-resolution, and addressed-rate. |
| **Profile** | One-word preset (`chill` \| `balanced` \| `strict`) mapping to gate thresholds, severity floors, and volume budgets. |
| **Change-unit** | A deterministically grouped set of related hunks (connected components over def-use, import, and file-affinity edges; size-capped; ungroupable leftovers form one residual unit). The unit of tiering, reviewer selection, and context packing — **never** a generation plan (D14). v1 granularity: file-level. |
| **Impact set** | The deterministically computed set of symbols/files a change-unit touches beyond its own diff: dependencies (imports/callees) *and* callers/references of changed exported symbols, via language-native analysis. Input to context packing (02 §3.1e) and to the verifier's evidence slice (02 §3.4). |
| **Context pack** | The deterministic, byte-budgeted context assembled per change-unit: impact set (references *and* callers of changed symbols), relevance-ranked bounded digests of unchanged dependency files (labeled context-only), priority-ladder overflow handling, every decision ledger-recorded. |
| **Tier** | Effort level chosen per change-unit from changed LOC, change classes, and path sensitivity (`trivial` \| `normal` \| `full`); scales reviewer count and model class. Security-sensitive paths always force `full`. PR-level tier = max over its units. |
| **Dialect** | How a model's output is obtained: `structured` (schema-constrained) or `prose` (free text, normalized best-effort). A model property resolved via the capabilities catalog. |
| **LLM boundary** | The single module where raw model output is parsed: JSON recovery → loose Model\*Schema (alias maps, coercion) → strict contract. No other code parses model output. |
| **Contracts** | The single Zod-first source of truth for all shared shapes; TypeScript types are inferred from schemas, never written in parallel. |
| **RunContext** | The per-run object carrying config, session paths, logger, provider factory; passed explicitly. There are no singletons. |
| **Harness** | The agent-loop backend behind the `AgentRunPort` that drives multi-turn tool-using model runs. A transport, never a parser; tools are always QualOps-owned. **Decided: the Vercel AI SDK** ([08-harness-decision.md](08-harness-decision.md)); the port keeps it swappable. |
| **Integration** | A supported code-hosting platform QualOps posts reviews to (GitHub, GitLab), and the QualOps code that talks to it. Replaces the earlier "forge" term. |
| **Slice** | A self-contained captured eval case (minimal repo subset + expected findings), per TDR 0002. |

## 5. Decision log (settled questions)

Resolved during concept work; re-open only with new evidence.

| # | Decision | Rationale (evidence) |
|---|---|---|
| D1 | Verification is a separate stage with a three-way verdict and verifier-owned confidence; generator self-rating never gates | Self-rated severity measured near-random (Greptile); verification is the industry's #1 FP control (appendix B §3 #1, #5) |
| D2 | Fingerprints hash content + anchor snippet, not line numbers | Line-drift tolerance; unlocks dedup/resolution/baseline/addressed-rate (appendix C §3.1) |
| D3 | The gate is deterministic and configured in the repo file; "judge" as an LLM stage is dropped (the dead `ai.judgeStage` config dies) | CI gating must be reproducible; LLM judgment lives in the verifier, not the gate |
| D4 | Config: YAML core file + markdown reviewers + prose REVIEW.md; JSON accepted; no dashboard, no wiki config | Category convention + comments; split-brain avoidance (appendix docs, 04 §6) |
| D5 | Pricing is derived from the capabilities catalog; never hand-typed (optional override only) | #1 documented footgun; the data is already bundled |
| D6 | One noun — reviewer — replaces jobs/passes/subagents/customAgents | Five overlapping nouns was the top config-comprehension failure |
| D7 | Repo-only state; learned rules arrive as PRs to `.qualops/rules/learned/` | Greptile/Sourcery document the dashboard/file split-brain cost |
| D8 | Keep QualOps' agentic tool-using review, fix stage, Anthropic support, and integration publishing; adopt the spike's contracts/boundary/verdict machinery around them | Spike's own benchmarks show tool-less review caps recall; QualOps' publishing is the product (appendix D) |
| D9 | Multi-provider support is retained and exploited: cross-model verification is a first-class option | Decorrelated model families beat same-model sampling (appendix B: CodeX-Verify, Refute-or-Promote) |
| D10 | Breaking config change with `qualops migrate` + one transition release; the 38 deprecated fields are removed, not carried | The current surface's non-validating docs and contradicting init leave little continuity worth preserving |
| D11 | Content-capturing tracing (Langfuse) stays available but the default log path is redaction-safe by construction | Prompt iteration needs content; logs must never leak it accidentally |
| D12 | Business logic is separated from the agent-loop implementation by the `AgentRunPort`; tools, sandboxing, and parsing are always QualOps-owned. **Backbone decided: the Vercel AI SDK** — no own harness (custom loop and adopting `@purista/harness` both rejected). Evaluation and rationale: [08-harness-decision.md](08-harness-decision.md) | Regulated-sector constraints (control, audit, footprint) are met by a thin community-maintained SDK behind the port; a Python-centric org will not staff a TS harness, so ownership-heavy options were ruled out despite scoring well on control |
| D13 | **Default generation = single-shot holistic review per change-unit** over a deterministically assembled context pack; **agent-mode review is an escalation tier** (`full`-tier units, `sensitivePaths`, impact-analysis-unsupported language features), not the default. Refines D8: agentic is *kept* — as the recall reserve, no longer the shipped default. The flip ships only with paired before/after eval proof (05 §7) | Fixed retrieval-grounded pipelines beat agentic scaffolds on accuracy *and* cost (Agentless 32% @ $0.70/issue vs. agentic 19% @ $0.43; same pipeline +18.8pts from a model swap alone); deterministic slices beat exploration (LLM4FPM ablation) and "more retrieval hurts"; spike probes: holistic single pass out-recalled multi-step, second pass hurt precision (appendix E) |
| D14 | **PR destructuring is deterministic and scopes context/reviewer-selection only** — hunk classification + change-unit grouping never become an LLM planning stage driving generation | TDR 0005 A/B-rejected *LLM-planned* decomposition (worse recall at ~4× cost); the deterministic lane is untested by that result and consistent with principle #2; failure stays cheap by construction — a grouping error mis-scopes context, the residual unit guarantees nothing is unreviewed (appendix E) |
