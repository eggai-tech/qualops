# Spec — Structure & Cleanup Refactor

**Status:** Approved 2026-07-08 · **Owner:** TBD · Derived from `concept/03-architecture-spec.md`, `concept/06-roadmap.md` (Phase 0–1), evidence in `concept/appendix/A-current-state.md` (defects cited as F-nn).

The first implementation phase. It moves the codebase to the target structure, removes duplication and code smells, unifies types behind Zod schemas, and fixes the defect inventory — **without new features**. It is a prerequisite for every later phase; those (verifier, fingerprint identity, config folder-model, AI SDK swap, publishing protocol, memory) are explicitly out (§3).

## 1. Objectives

1. Establish the layered structure `contracts ← kernel ← platform ← llm ← domains/forges ← app` (`concept/03` §1–2).
2. One definition per concept: unify the 4 `Finding` shapes and 2 severity vocabularies, and the duplicated `FixSuggestion`/`FileDiff`/`ReportSummary`/`ExtractLog`/`RootCauseTaxonomy`/`QualOpsResult`, into Zod-first `contracts/` with inferred types (`concept/03` §5).
3. Centralize every duplicated utility to one home (`concept/03` §5), including the model-output parsing wall (`llm/boundary`) — the "JSON/non-JSON handling not centralized" problem.
4. Remove code smells: collapse the prose/structured twin trees, convert static-only classes to functions, retire the 8 singletons behind `RunContext`.
5. Fix the defect inventory (§4), bucketed by observable impact.

## 2. Invariants (the definition of "no breaking change")

- **CLI flags, config format, and output/comment format are unchanged.** (The config folder-model and the posting-protocol changes are later phases.)
- **The ~2,600-test suite stays green at every step.** A test that *must* change is a red flag to call out in its PR, not a routine edit.
- **Public API** (`src/index.ts` exports): changes only via a reconciled snapshot (§6). Unifying `Finding`/severity may touch exported types → keep deprecated re-export aliases for one release; document as an internal-types bump.
- **Behavior-affecting fixes are allowed but must be declared** (§4 buckets B and C) with changelog entries; bucket C additionally gets release-note prominence.

## 3. Scope

**In:** `contracts/` (unified types + validation schemas + drift tests); `kernel/` (all dedup'd utilities); `platform/` (env, current config loading relocated, logger, git, session-store); `llm/boundary` (merged parse/normalize), `llm/model` (capabilities/pricing/accounting extracted), `llm/prompts`, `llm/tools` (moved as-is), `llm/backend` (the two ports **wrapping the current provider code** — see §5); `domains/` (current stages relocated + twin-tree collapse); `forges/core` (shared comment formatting); `app/run` (stage registry, `RunContext`, single exit point).

**Out (later phases, `concept/06`):** the verifier and `domains/verification` · `domains/admission` and fingerprint-driven dedup/identity/baseline · the config folder-model (`reviewers/*.md`, `REVIEW.md`, profiles) · the **AI SDK swap** (ports wrap current providers now; the `ai-sdk` backend replaces them in Phase 2) · incremental re-review, auto-resolution, suggestion blocks, SARIF, transparency panel · feedback memory, learned rules, tiering.

Note on identity: the unified `Finding` contract **may carry a `fingerprint` field**, but this phase does **not** change how findings are identified, deduplicated, or posted — that behavior is Phase 1/3. Shape only.

## 4. Defect inventory, bucketed

**Bucket A — internal only, no observable change:** F-3 (dead error-handling: wire or delete), F-7 (double-writes → single-writer), F-8 (`getMostRecentSession` path), F-15 (dead injection filter removal), F-18 (confidence-scale cleanup), F-19 (dead framework detection), F-23 (vestigial prompt), F-26 (logger honors `--config`), and all duplication removals (`concept/03` §5).

**Bucket B — latent-bug fixes (output changes only in the previously-broken case; changelog entry):** F-14 (location parsing on digit-containing paths), F-16 (silent `[]` on parse failure → repair retry + visible notice), F-20 (enrichment overwrite; model effort estimate preserved), F-24 (retry consistency across providers), F-21/F-22 (prompt↔schema drift, incl. the `validation.md` `index` contract).

**Bucket C — intended behavior changes (changelog + release note):** F-1 (gate failure → non-zero exit), F-2 (telemetry flushed before exit), F-4 (gate thresholds expressible in the config file — additive), F-5 (prose runs report "not gateable" instead of PASSED), F-6 (stale resume gated behind explicit `--resume`), F-13 (hardcoded confidence `≥7` → configured threshold).

**Eval track (parallel, eval-only):** F-29 scorer fixes (`concept/05-quality-spec.md` §1).

## 5. Reviewability method (normative for this phase)

Every PR obeys these so a human can answer "does this change behavior?" without reading every line:

1. **Never mix a move with an edit.** `git mv` (rename, `R100`) in one PR; import re-points (mechanical) in another; logic change in a third. Move-PRs and edit-PRs get different scrutiny.
2. **Strangler shims.** New home created; old path re-exports from it; consumers migrate a few per PR; a final deletion-only PR removes the shims and old dirs (`src/ai`, `src/shared`, `src/stages`).
3. **Characterization tests before risky consolidations** (the twin-tree collapse, the `llm/boundary` ladder merge, `RunContext` replacing singletons): pin current behavior in a prior PR, then refactor under green tests.
4. **Label mechanical sweeps.** Codemod-style changes name the script + one example; the reviewer verifies intent, not N identical hunks.
5. **One singleton at a time.** `RunContext` gains a field, its call sites migrate, the singleton dies — repeat ×8. Never one 16-file PR.
6. **PR template:** *Type* (move / sweep / logic) · *Behavior change* (none — proof: tests+tsc / or bucket B/C ref) · *Public API* (snapshot passed / changed) · *Structural metric* (before → after).

### PR stack order

1. **Scaffolding + CI invariants** — empty `contracts/` + `kernel/`; dependency-cruiser layer rules; public-API snapshot test; structural-budget reporter. Pure addition.
2. **kernel extractions** — one PR per group (error+result, redaction, retry, concurrency, hash, text=escapeHtml+line-numbering, location, markdown=frontmatter, template, path-safety, glob): add → codemod call sites → delete old.
3. **contracts** — `Finding`(+severity) as its own sub-stack (add → migrate per module → delete the 4 old shapes + `issue.model`/`pattern.model`/`session.model`); then config schema relocation, run/report shapes, `ports` interfaces, shared primitives; drift tests.
4. **platform** — env centralization (codemod `process.env`), config loading relocated, logger (F-26 + redaction), git, session-store (F-7/F-8).
5. **llm/boundary** — merge the two JSON ladders into one; `Model*Schema` + `normalize`; dialect seam (kills prose/structured parse duplication). Characterization tests first.
6. **llm/model + ports + backend(current)** — extract capabilities/pricing/accounting; introduce `CompletionPort`/`AgentRunPort`; wrap current providers; add the port conformance suite. Behavior-neutral.
7. **llm/tools** — move tools + bash sandbox as-is; unify the two frontmatter parsers into `kernel/markdown`.
8. **domains** — relocate stages → domains; collapse the review twin trees (characterization tests first); static-classes→functions; `gate` domain (F-5). Per-domain PRs.
9. **forges/core** — extract shared comment formatting from the github/gitlab duplication.
10. **app/run** — stage registry replacing the switch; `RunContext` replacing singletons (one at a time); single exit point + error policy (F-1/F-2/F-3); `--resume` gating (F-6).
11. **Behavior-fix reconciliation** — land any remaining bucket B/C fixes (F-4/F-13 into config+gate; F-21/F-22 prompts) with changelog entries.
12. **Shim removal** — delete re-export aliases and the old `src/ai`, `src/shared`, `src/stages` trees. Deletion-only.

Bucket-A internal fixes and duplication removals fold into whichever stack PR touches that module. Steps are a stack (each green, merged in order); a stacked-PR tool helps but a plain ordered series suffices.

## 6. Exit criteria

- Structural budget (`concept/03` §8): cross-module import ratio < 40% (from 71%) · cycles = 0 (from 2) · max depth ≤ 6 (from 12) · singletons = 0 · one definition per concept.
- Four exclusivity rules enforced in CI (`concept/03` §1); `.sentrux`/dependency-cruiser green.
- Full test suite green; coverage not decreased; tests colocated for moved modules.
- Public-API snapshot reconciled; deprecated aliases documented.
- `CHANGELOG` updated for buckets B and C; release note drafted for bucket C.
- All Bucket A/B/C defects closed or explicitly deferred with reason.
- Old `src/ai`, `src/shared`, `src/stages` removed; no dead code, no orphaned files.

## 7. Explicit non-goals

No feature work, no config-format change, no posting-behavior change, no AI SDK swap, no verifier. Anything tempting that touches those belongs to a later phase — record it in `concept/` if newly discovered, do not smuggle it into this refactor.
