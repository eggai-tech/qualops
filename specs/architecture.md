# Spec — Architecture (post-refactor target)

**Status:** Approved — EggAI, 2026-07-08 · Derived from `concept/03-architecture-spec.md`. This spec is scoped to the **outcome of the structure & cleanup refactor** ([`plans/refactor.md`](plans/refactor.md)): the module layout, layering, and conventions the code must satisfy when the refactor is done. It describes **structure**, not functional behavior — behavior is in [`behavior/`](behavior/). Future functional domains (verification, admission, memory) sketched in `concept/` are **reserved, not created by this refactor** (§4).

## 1. Layering (normative)

```
contracts ← kernel ← platform ← llm ← domains/integrations ← app
```

Imports flow one direction only. Enforced in CI (dependency-cruiser / ESLint restricted paths / `.sentrux/rules.toml`); a violation fails the build.

- `contracts` imports nothing internal (only `zod`). `kernel` imports nothing internal at all.
- Domains never import another domain's internals, `integrations`, or `app`. Cross-domain data flows through `contracts` types, wired by `app/run`.
- **Four exclusivity rules:** only `llm/backend` imports a model SDK; only `llm/boundary` parses model output; only `platform/env` reads `process.env`; only `platform/session-store` writes run artifacts.

## 2. Module map

```
src/
├── contracts/    # Zod source of truth; TS types inferred. finding/, config/, run/,
│                 # report/, ports/ (CompletionPort, AgentRunPort, ToolDefinition),
│                 # shared/ primitives. Colocated drift tests. See contracts.md.
├── kernel/       # pure, stateless, stdlib-only: result, error (StructuredError +
│                 # exit-code table), redaction, retry, concurrency, hash, text
│                 # (line-numbering, escapeHtml), markdown (frontmatter), template,
│                 # path-safety, location, glob
├── platform/     # process adapters: env, config (load/merge/validate), logger
│                 # (redaction-safe by construction), git, session-store, observability
├── llm/          # the only layer that talks to a model SDK
│   ├── model/    # config model-slug → LanguageModel; capabilities catalog (dialect
│   │             # routing, litellm snapshot); pricing catalog; token/cost accounting
│   ├── boundary/ # THE model-output wall: extract-json → Model*Schema → normalize →
│   │             # strict contract; dialect (structured|prose) as one seam; tokens
│   ├── prompts/  # loading, template binding, prompt/config hashing (provenance)
│   ├── tools/    # QualOps-owned tools (read/grep/glob/usages/git) + bash sandbox
│   └── backend/  # port implementations (§3)
├── domains/      # business logic; no cross-domain imports (§4)
│   ├── intake/       # change detection, diff, file selection  (was: analyze)
│   ├── review/       # candidate generation, all dialects, validation + dedup  (was: review)
│   ├── fix/          # fix generation / application / rollback  (was: fix)
│   ├── reporting/    # report renderers + root-cause extraction  (was: report + root-cause-extract)
│   └── gate/         # deterministic quality-gate verdict → exit code  (was: judge)
├── integrations/
│   ├── core/     # shared comment markdown, markers, posting (kills github/gitlab dup)
│   ├── github/   # API client, checks, comments
│   └── gitlab/   # API client, discussions, comments
└── app/
    ├── run/      # stage registry {name, deps, run(ctx)}, RunContext, orchestrator,
    │             # error policy, single exit point (flush-then-exit)
    ├── cli/      # thin wiring → pure runCli(argv, {cwd, env}) → {exitCode}
    └── action/   # GitHub-Action entry
```

Tests are colocated (`foo.ts` + `foo.test.ts`); `tests/` holds integration/smoke only ([`quality/testing.md`](quality/testing.md)).

## 3. The two ports & the backend

Domains depend on two interfaces from `contracts/ports`, implemented in `llm/backend`:

- **`CompletionPort`** — single-shot, optionally schema-constrained calls (current review-per-file, validation, dedup, judge classification). 
- **`AgentRunPort`** — multi-turn tool-using runs (current agentic review). Reports a **trajectory** (every tool call) as part of its result contract.

Rules that hold under any backend: tools are **always QualOps-owned** (a backend's built-in tools are never enabled); adapter output always passes back through `llm/boundary` (a backend is a transport, never a parser); model resolution and dialect routing live in `llm/model`, so domains never name a provider.

**Refactor-phase state:** the ports are introduced **wrapping the current provider/agentic code** (behavior-preserving). The Vercel AI SDK adapter replaces the wrapped implementation in a later phase (`concept/08-harness-decision.md`); the port bounds that swap's blast radius. See [`behavior/integrations/providers.md`](behavior/integrations/providers.md) for the current provider behavior being wrapped.

## 4. Domains: current vs. reserved

This refactor relocates **today's five stages** into the five domains above (mapping shown inline). It does **not** add new behavior. The functional redesign in `concept/` introduces additional domains (`verification`, `admission`, `memory`) and reshapes `review`/`gate`; those are **later phases** and are not part of this spec. Do not create empty placeholder domains for them — they arrive with their functional spec.

## 5. Conventions (normative)

- Named exports only; **functions by default**; classes only for genuine live state (e.g. the bash sandbox session). No new singletons — dependencies arrive via `RunContext` or parameters.
- **Every file has one home.** No generic `utils/` folders; shared helpers go in `kernel/`. Files ≤ ~300 lines (treat > ~400 as a split smell); one responsibility per file.
- One definition per concept (see `contracts.md`); before adding a helper, check `kernel/`.
- Comments state policy/constraints, not narration.
- A `.agent/IMPLEMENTATION.md`-style conventions file records these plus the anti-pattern list for humans and coding agents; `CLAUDE.md`/`AGENTS.md` at the root are the entry points.

## 6. Centralization (one home per concept)

The refactor removes today's duplication (evidence: `concept/appendix/A-current-state.md`). Canonical homes: `escapeHtml`/line-numbering → `kernel/text`; location parsing → `kernel/location`; retry → `kernel/retry`; JSON recovery → `llm/boundary`; frontmatter → `kernel/markdown`; glob → `kernel/glob`; error handling → `kernel/error` + `app/run` policy; `process.env` → `platform/env`; integration comment formatting → `integrations/core`; the 4 `Finding` shapes + duplicate `FixSuggestion`/`FileDiff`/`ReportSummary`/etc. → `contracts/`; the hand-rolled provider layer collapses into `llm/model` + `llm/backend` (the SDK owns provider clients); the 8 singletons → `RunContext`.

## 7. Structural budget (CI-tracked exit criteria)

Cross-module import ratio < 40% (from 71%) · import cycles = 0 (from 2) · max dependency depth ≤ 6 (from 12) · classes only where stateful (~8–10, from 47) · singletons = 0 · one definition per concept. Tracked in CI; regressions flag alongside coverage.
