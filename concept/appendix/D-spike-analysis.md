> **Appendix — evidence/analysis record.** Kept as the factual basis for the spec; terminology and document references may predate the consolidation. Normative content lives in the spec documents (01–07); old references map as: 01→appendix A, 02→appendix B, 03→appendix C, 04/05/06→spec 02+06+07, 07→spec 05, 08→spec 03, 09→appendix D, 10→spec 04.

# 09 — Adopting Ideas from the `codereviewer` Spike

Analysis of [sebastianwessel/codereviewer](https://github.com/sebastianwessel/codereviewer) — the author's precision-first spike (~148 impl files + 113 colocated tests, ESM, Zod v4, 4 classes total, functional throughout) — and how it improves and extends this concept. Verdict up front: **the spike is a masterclass in boundaries; QualOps has the muscles (agentic tools, fix stage, Anthropic, publishing). The target is the spike's skeleton with QualOps' muscles.**

## 1. What the spike is

A local-first review engine: **holistic whole-file discovery → per-candidate refutation → deterministic admission**. Ten pipeline steps, only two model-backed; deterministic front (config → intake → deterministic signals → import-graph clustering → budgeted context assembly) and deterministic back (admission → baseline/quality gate → reporting). Domain-oriented structure (`shared/contracts`, `platform`, 14 `domains/`), radically thin dependencies (provider SDKs are optional peers; no commander, no dotenv, no glob lib), and it publishes nothing — it emits report artifacts and GitHub review-comment *drafts* only.

## 2. Adopted into the structure concept (already reflected in 08)

These spike patterns are load-bearing in spec [03-architecture-spec.md](../03-architecture-spec.md):

1. **`shared/contracts` as the single Zod source of truth** with shared primitives (`RepositoryRelativePathSchema`, `prefixedIdSchema`), strictObject/readonly, inferred types, and **contract drift tests** (`contract-id-drift.test.ts` pattern) → 08 §3 `contracts/` + §6.
2. **The two-schema LLM boundary** — loose `Model*Schema` (`z.preprocess` with enum alias maps `blocker→critical`, regex category rescue, stringified-number coercion, nested `location.path` unwrapping, snake_case fallbacks, `.catch(undefined)`, truncation-before-parse) normalizing into strict internal contracts. Nothing downstream sees un-normalized output. The spike's `agent-contracts.ts` (`normalizeModelEnumValue`, verdict alias maps `false-positive→refuted`, `inconclusive→needs-more-evidence`) can be ported almost verbatim → 08 §5.
3. **StructuredError discipline**: one `normalizeError` mapping anything → `{code, category, recoverable, exitCode, details}`, provider subcodes classified from HTTP status/message (`provider_rate_limited`, `provider_auth`, `provider_context_length`), a documented exit-code table, and **redaction applied to every error/log/artifact** → 08 `kernel/error.ts` + `kernel/redaction.ts`. Directly replaces QualOps' two conflicting `withErrorHandling`s and fixes F-1/F-2/F-3.
4. **Privacy-by-construction logging**: a log wrapper that drops any field whose key matches `/(body|content|prompt|response|token|secret|key|raw)/i` and truncates values — you *cannot* accidentally log a prompt or secret → `platform/logger`. (QualOps keeps its content-capturing Langfuse tracing as an explicit opt-in observability channel — better for prompt debugging than the spike's `NO_CONTENT` stance — but the *default log path* becomes safe.)
5. **Functional style, colocated tests, pure CLI entry** — `runCli(argv, {cwd, env, logSink}) → {stdout, stderr, exitCode}`, hand-rolled and unit-testable without process spawning → 08 §2, §3 `app/cli`.
6. **Optional-peer provider adapters** with `provider_adapter_missing` errors naming the exact install command → 08 §7 (structure now, packaging later).

## 3. Extensions to the pipeline concept (amends 04)

The spike sharpens three parts of the target architecture:

### 3.1 Refutation verdict contract (extends 04 §3 stage 3)

The verifier's output becomes a **three-way verdict**, not a boolean:

```
confirmed | refuted | needs-more-evidence
```

with a **promotion policy**: `confirmed` → eligible for posting; `refuted` → dropped (kept in artifacts for eval capture); `needs-more-evidence` → **artifact-only** — visible in the report artifact and eval data but never posted to the PR. This solves the posted-or-lost dilemma: weak findings stay auditable without polluting the review. Verdict aliases are normalized at the LLM boundary like every other enum.

### 3.2 Admission as a deterministic stage with a reject-reason taxonomy (extends 04 §3 stages 2+4)

Every dropped candidate records a machine-readable `RejectReason` (`out-of-scope`, `duplicate-fingerprint`, `category-excluded`, `refuted`, `below-confidence`, `below-severity-floor`, `volume-budget`, `feedback-suppressed`, `baseline-suppressed`). This powers:
- the **transparency panel** (06 feature 8) with exact counts per reason,
- the **noise funnel metric** (07 §5) for free,
- debugging "why didn't it flag X" without rerunning.

Severity floors can exempt trusted deterministic rules (a linter-confirmed critical passes even below the LLM floor).

### 3.3 Baseline suppression — fail on *new* findings only (new; extends 04 §6 and 05 P3)

The spike's baseline matcher classifies findings as `new | existing | resolved` against a stored fingerprint baseline. For QualOps this means: on repos with pre-existing debt, the gate fails CI only on findings **introduced by the PR** — the single most important adoption-blocker fix for teams onboarding an AI reviewer onto a legacy codebase. Fingerprints (04 §2) make this nearly free. Add `qualops baseline` to capture/update the baseline on the default branch.

### 3.4 Context ledger + provenance (new; extends 04 and 07)

Record, per run: every context item considered → `included | skipped | truncated` with reason and byte counts; per finding: `promptHash`, `instructionHashes`, `configHash`. Makes runs auditable ("what did the model actually see?"), makes eval regressions attributable (prompt change vs model change vs context change), and costs almost nothing to implement inside `llm/prompts`.

### 3.5 Deterministic pre-work (reinforces 06 feature 6)

The spike runs the TypeScript compiler (as a library) for JS/TS and `ast-grep` for five more languages as **deterministic signals** feeding import-graph task clustering and context assembly — not as detectors. Two adoptions:
- **Import-graph clustering** for the file-by-file mode: review clusters of related files together instead of isolated files — deterministic, free, and closes the "cross-file bug invisible in per-file review" gap for the non-agentic path.
- **Byte-budgeted context assembly** with the rule: drop optional context before source, and *record a provider issue instead of silently truncating*.

## 4. Feature adoptions (extends 06)

| Spike feature | Adopt as |
|---|---|
| **SARIF output** | New renderer in `domains/reporting` — makes QualOps findings consumable by GitHub code scanning and every SARIF-aware tool; cheap once contracts are unified |
| **Tiered eval metrics** (`productRecall`: runtime-critical/security/logic only, nits excluded) | Add to 07 §2 — headline recall should not punish correctly ignoring nits; complements the noise scorecard |
| **Boolean-only semantic judge** (explicitly bans numeric confidence in eval judging) | Adopt in the eval judge (07 §1) — aligns with the "self-rated scores are near-random" evidence |
| **Cost governance** (`maxCostUsd` budget + pricing snapshot + update script) | QualOps already has pricing config + a capabilities update script; add the hard budget with partial-result return (fixes F-17 properly) |
| **Benchmark hydration guard** (error on un-hydrated eval slices instead of silently scoring 0) | Mirrors QualOps' own TDR 0003 eval guard — extend it to CRB slice hydration |
| **`specs/` registry + `.agent/IMPLEMENTATION.md` anti-pattern list** | Adopt the conventions file (08 §6.4); the `concept/` folder plays the specs role — add a registry index if it grows |
| **Drift domain** (docs/spec/generated-artifact drift as gateable categories) | Backlog — interesting as a later specialist reviewer, not core |

## 5. Explicitly NOT adopted (QualOps is stronger here)

- **Single-shot, tool-less review agents.** The spike's discovery agents get no tools; its own docs concede recall is the weak axis (~33% ceiling, 53% precision). QualOps' agentic mode with the sandboxed toolset is the recall engine — keep it and put the spike-style refutation/admission behind it.
- **No Anthropic adapter.** The spike runs on `@purista/harness` without first-class Claude support; QualOps' Anthropic provider + Agent SDK integration is a core asset.
- **Draft-only output.** QualOps' end-to-end GitHub/GitLab publishing (and the P3 posting protocol) is the product; the spike deliberately stops at artifacts.
- **Fix stage.** The spike emits ≤5-edit manual-review proposals; QualOps has generation, application, rollback, and (per 06) suggestion-block delivery.
- **`NO_CONTENT` telemetry as the only mode.** Valid compliance stance, but content-capturing Langfuse tracing is too valuable for prompt iteration to give up; make content capture configurable instead.

## 6. Net effect on the roadmap

- 08's migration steps M1–M3 are where the spike patterns land (contracts, kernel error/redaction, LLM boundary).
- 04 §3 stage 3 gains the three-way verdict + promotion policy; stage 2/4 gain the RejectReason taxonomy; the posting protocol (04 §6) gains baseline suppression.
- 05 P2 verifier work should port the spike's `agent-contracts.ts` normalization and verdict handling rather than writing them fresh; P3 gains `qualops baseline`.
- 06 gains SARIF + cost budget; 07 gains `productRecall`, boolean judging, and hydration guards.
