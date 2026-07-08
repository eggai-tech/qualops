# QualOps Concept — Reviewer Redesign

**Status:** Concept stage — for review and refinement, not yet agreed. **Nothing here is implemented.**
**Goal:** QualOps reviews a pull request and delivers the most reliable feedback possible **without polluting the review**.

> **Where this sits in the flow.** `concept/` is the staging ground: ideas collected, shared, and reviewed *before* they are agreed. The pipeline is **concept → spec → implementation → documentation**. When a concept here is approved, it is rewritten into a gap-free, aligned `spec` (in `specs/`), which is then implemented, and only shipped behavior is described in end-user `docs/`. So the documents below are proposals written in spec-like form for clarity — treat them as concepts under review, not as binding specs, until they graduate.

## The thesis

QualOps has a solid multi-provider foundation and measures recall well — but "reliable and non-polluting" is a **precision** problem, and precision is where the current system is weakest: noise control relies on LLM self-judgment, findings have no stable identity, false positives aren't measured, and the CI gate doesn't actually gate. The industry has converged on the answer:

> **Generate wide → verify adversarially → filter hard → publish little.**

This spec realigns QualOps to that shape while keeping its genuine strengths (provider abstraction and dialect handling, sandboxed agentic tooling, fix stage, forge publishing, eval harness), rebuilds the codebase on a contracts-first layered structure, and replaces the config with a "review team is a folder" model.

## How to read

**Proposed spec** (concept stage — defines the target; terminology from 01 is used consistently across the set):

| Doc | Contents |
|---|---|
| [01-goals-and-glossary.md](01-goals-and-glossary.md) | Product goal, non-goals, design principles, **glossary**, decision log D1–D11 |
| [02-pipeline-spec.md](02-pipeline-spec.md) | Finding contract & fingerprint, stages (Intake→Generate→Filter→Verify→Admit→Publish→Learn), LLM boundary, publishing protocol, fixes, gate, auditability |
| [03-architecture-spec.md](03-architecture-spec.md) | Layered code structure, centralization map, conventions, runtime model, structural budget |
| [04-configuration-spec.md](04-configuration-spec.md) | Config UX: `config.yaml` + `reviewers/*.md` + `REVIEW.md` + `rules/`, tooling commands, settled decisions |
| [05-quality-spec.md](05-quality-spec.md) | Metrics, datasets, three-layer evaluation, cadence, statistical rules, improvement loop (integrates [PR #149](https://github.com/eggai-tech/qualops/pull/149)) |
| [06-roadmap.md](06-roadmap.md) | Unified phases P0–P4 with migration steps, config track, eval track, exit criteria |
| [07-backlog.md](07-backlog.md) | Deliberately deferred ideas with promotion triggers |
| [08-harness-decision.md](08-harness-decision.md) | **ADR (decided → Vercel AI SDK):** agent-loop backend — measured fact sheet (AI SDK, @purista/harness, Eve, Claude Agent SDK, @openai/agents, configurable-agent, custom loop), pro/cons, decision + rationale (no own harness) |
| [09-issue-triage.md](09-issue-triage.md) | **Triage (proposed):** every open GitHub issue vs. concept & code — adopt (MCP context sources), already-covered, superseded, reject (chaining, marketplace), and stale-close list |
| [10-eval-operations.md](10-eval-operations.md) | **Eval ops (proposed):** committed result scoreboard + optional Langfuse (gap), dataset growth incl. per-language negatives (concept 05 §3), offline `eval:quick` loop; spike ports |

**Appendix** (evidence and analysis; terminology may predate the glossary):

| Doc | Contents |
|---|---|
| [appendix/A-current-state.md](appendix/A-current-state.md) | Code audit: architecture as-is, strengths, defect inventory **F-1…F-30** (referenced throughout the spec) |
| [appendix/B-industry-research.md](appendix/B-industry-research.md) | State-of-the-art research: product techniques, literature 2024–2026, metrics — with sources |
| [appendix/C-gap-analysis.md](appendix/C-gap-analysis.md) | QualOps vs. state of the art, root causes, prioritization logic |
| [appendix/D-spike-analysis.md](appendix/D-spike-analysis.md) | Analysis of the author's `codereviewer` spike; what was adopted (now folded into the specs) vs. kept from QualOps |

Additional evidence not duplicated here: the config UX audit (summarized in 04 §6 and appendix C) and the agent-evaluation research in [PR #149](https://github.com/eggai-tech/qualops/pull/149) (distilled into 05, conflicts resolved in 05 §8).

## The five structural problems being solved

1. **No deterministic noise guardrails** — scope, dedup, and citation checks are prose instructions or absent; every control is an LLM opinion. → Filter stage + verification (02 §3.3–3.4).
2. **No stable finding identity** (`Date.now()` IDs) — blocks dedup, update-in-place, auto-resolution, baselines, addressed-rate. → Fingerprints (02 §2).
3. **No independent verification** — the same model re-judges its own findings (measured near-random industry-wide). → Verifier with verdict + evidence + calibrated confidence (02 §3.4, D1).
4. **The CI gate doesn't gate** — exit 0 on failure, env-only thresholds, prose runs rubber-stamped, telemetry lost on crash. → Gate + error/exit contract (02 §6, §10).
5. **Recall-only measurement** — no FP metric, broken precision proxy, posting behavior unevaluated. → Noise scorecard + verifier-as-classifier + posting fixtures (05).

Plus two cross-cutting rebuilds: the **code structure** (71% cross-module imports, ~16 duplicated utilities, 8 singletons, 4 incompatible Finding shapes → contracts-first layers, 03) and the **configuration** (38 deprecated fields, hand-typed pricing, contradicting docs, 11 concepts for one common task → the folder model, 04).

## Sequence at a glance

```
P0 Correctness & trust      days     exit codes, thresholds, prompt drift, scorer fixes  + M1 contracts/kernel
P1 Identity & filters       1–2 wk   fingerprints, scope/dedup filters, fast eval gate   + M2 platform/RunContext
P2 Verification             2–3 wk   verifier+admission, config rework C1 (reviewers/*.md) + M3/M4 boundary+domains
P3 Publishing               2–3 wk   incremental re-review, auto-resolve, baseline, init  + M5 forges
P4 Learning & tiering       ongoing  memory, learned rules, tiering, cleanup M6
```

Every phase ships with paired before/after eval results (05 §7); if exit criteria fail, the release ships without the phase.
