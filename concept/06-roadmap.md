# 06 — Roadmap

**Status:** Draft for human review · Unifies the pipeline phases (P0–P4), the structure migration (M1–M6), the configuration rework (C1–C3), and the eval build-out (E0–E3) into one sequence. F-nn references: appendix A. Ground rules: every phase ships green with before/after deep-run eval results under [05-quality-spec.md](05-quality-spec.md) §7's statistical rules; move and rewrite are separate commits; specs/docs/tests stay aligned per repo policy.

## Phase 0 — Correctness & trust (days)

Restore the tool's own contract before building anything. Rides migration step **M1** (create `contracts/` + `kernel/`; the fixes land in their target homes; old paths re-export temporarily).

- CI contract: gate failure → non-zero exit; single exit point with telemetry flush; wire the per-stage error policy (F-1, F-2, F-3). Gate thresholds into the config file (F-4). Prose runs report "not gateable" instead of hardcoded PASSED (F-5). Resume only via explicit `--resume`; single-writer artifacts (F-6, F-7, F-8).
- Review path: configured thresholds replace hardcoded `>= 7` (F-13); robust location parsing shared (F-14); dead GitLab injection filter removed (F-15); structured-output failure → one repair retry + visible notice (F-16); budget exhaustion returns partial results (F-17); confidence-scale cleanup, dead framework detection, single-pass enrichment (F-18/19/20).
- Prompts: validation + review prompts regenerated to match schemas (F-21/22/23) and the prompt↔schema CI guard added.
- AI layer: consistent retries (F-24); logger honors `--config` (F-26).
- Evals (**E0**): scorer fixes — consistent contingency table, clean-output-is-a-pass, null-not-zero (F-29).
- Hygiene: stale `plan.md`/`progress.md` removed; inert config flags wired or deleted; non-functional CLI flags fixed or removed; Bedrock+agentic errors clearly.

**Exit:** all tests green; baseline deep-run recorded — the "before" for every later claim.

## Phase 1 — Identity & deterministic filters (1–2 weeks)

Rides **M2** (platform: env, config loading, logger, session-store; singletons → `RunContext`).

- `Finding` contract with fingerprint + anchor ([02-pipeline-spec.md](02-pipeline-spec.md) §1–2); re-anchoring utility with drift/rename/duplicate-line tests.
- Filter stage: scope, citation check, fingerprint exact-dedup, category excludes (02 §3.3).
- GitLab dedup keyed by fingerprint marker incl. resolved discussions (F-27 partial).
- **E1**: fast deterministic per-PR eval gate (05 §7 tier 1) + duplicate-injection and scope fixtures.

**Exit:** same review posted twice → zero new comments; out-of-diff findings dropped in fixtures; recall unchanged (paired, n.s.).

## Phase 2 — Verification (2–3 weeks) — the quality jump

Rides **M3** (LLM boundary: merged JSON ladders, Model*Schemas, dialect seam — prose twins deleted) and **M4** (domains + stage registry).

- Verifier per 02 §3.4: context asymmetry, evidence requirement, three-way verdict + promotion policy, confidence 0–100; port the spike's normalization/verdict contracts (D8). Replaces the legacy self-validation pass and per-file dedup.
- **Harness port** (03 §4a, D12): `AgentRunPort` + conformance suite; adapters consolidated per [08-harness-decision.md](08-harness-decision.md) (pending that ADR's approval: @purista/harness as default — with its three conditions incl. the Node 24 bump — AI SDK as alternative, Claude Agent SDK opt-in, @openai/agents and configurable-agent retired). The backend decision can be taken — or deferred — without touching domains.
- Admission per 02 §3.5, all thresholds from config. Sampling+voting as opt-in.
- Cross-model verification option (D9).
- **C1 (config, can start earlier in parallel):** the `reviewers/*.md` format + `config.yaml` + `REVIEW.md` as a translation layer onto the existing executor — the highest user-visible win per effort in the whole plan; includes `qualops migrate`, `validate`, `config --pr`. One transition release with old-schema warnings (D10).
- **E2**: verifier-as-classifier suite (planted-FP set, calibration), judge bias controls, clean-PR negative set live.

**Exit:** precision up materially at ≤10% recall cost (paired, significant); clean-PR spurious ≈ 0; verifier calibration curve recorded and threshold set from it.

## Phase 3 — Publishing protocol (2–3 weeks)

Rides **M5** (`forges/core` extracted).

- Review state, incremental re-review, auto-resolution, human-resolution respect (02 §7); GitHub PR-review surface with suggestion blocks (F-28); GitLab auto-resolve (F-27 complete).
- Baseline suppression + `qualops baseline` (02 §10).
- Prompt-injection sanitization; transparency panel in the summary.
- **C2:** `qualops init` wizard / onboarding PR; docs+schema+llm.txt generated from contracts.
- **E3:** posting-behavior fixtures in CI; addressed-rate instrumentation begins (the north star starts accumulating).

**Exit:** fixture sequence — no drift duplicates, auto-resolve fires, no re-spam after human resolve; addressed-rate telemetry flowing.

## Phase 4 — Learning & tiering (ongoing)

- Effort tiering + sensitive-path forcing (02 §3.1); fix-proposal delivery as suggestion blocks (02 §8).
- Feedback memory → admission suppression; learned-rules lifecycle landing as PRs (02 §9); `@qualops remember`/`dismiss`.
- **C3:** presets/`extends` resolution incl. org presets; SchemaStore submission.
- Cleanup **M6**: temporary re-export aliases removed; `shared/`, `stages/`, old `ai/` deleted; colocated tests for migrated modules; optional-peer packaging decision executed; deprecated config fields die.
- Eval steady state: nightly deep runs, weekly drift tier, fix harness, error-analysis cadence (05 §9); Martian benchmark submission.

## Cross-cutting rules

- **Stage rename** lands with M4: `analyze/review/fix/report/judge` → Intake/Generate+Filter+Verify+Admit/Fix-proposals/Reporting/Gate; CLI accepts old stage names through the transition release with warnings.
- **Structural budget** (03 §8) and the fast eval gate run in CI from Phase 1 onward.
- **Dependency risk note:** the composite GitHub Action installs from the action repo — the optional-peer flip (03 §7) ships only after its install matrix is tested; it is deliberately last.
- **Rollback stance:** each phase is independently shippable; if a phase's exit criteria fail, the release ships without that phase rather than with a weakened version of it.
