# 03 — Architecture Specification

**Status:** Draft spec for human review · Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Evidence: appendix A §3 (defect inventory), structural scan (71% cross-module import edges, 2 cycles, 47 classes, 8 singletons), appendix D (spike patterns adopted per D8).

## 1. Layering (normative)

```
contracts ← kernel ← platform ← llm ← domains/forges ← app
```

- **`contracts`** imports nothing internal (only `zod`). **`kernel`** imports nothing internal at all.
- Domains never import other domains' internals, `forges`, or `app`; cross-domain data flows through `contracts` types, wired by `app/run`.
- Four exclusivity rules: only `llm/backend` imports a model SDK (`ai`/`@ai-sdk/*`); only `llm/boundary` parses model output; only `platform/env` reads `process.env`; only `platform/session-store` writes run artifacts. Domains import port *interfaces* from `contracts/ports`, never an SDK.
- Enforced in CI (dependency-cruiser / ESLint restricted paths / `.sentrux/rules.toml`); violations fail the build.

## 2. Target tree

```
src/
├── contracts/        # single source of truth: finding/, config/, run/, report/, ports/, shared/
│                     # ports/ = CompletionPort, AgentRunPort, ToolDefinition — the domain-facing
│                     # seams (§4a); strictObject + readonly, inferred types, colocated drift tests
├── kernel/           # pure stateless utilities, stdlib only:
│                     # result, error (StructuredError + exit-code table), redaction, retry,
│                     # concurrency, hash/fingerprint, text (line numbering, escapeHtml),
│                     # markdown (frontmatter), template, path-safety, location, glob
├── platform/         # process adapters: env, config loading/merging, logger (redaction-safe
│                     # by construction), git, session-store, observability (OTel + Langfuse)
├── llm/              # the ONLY layer that talks to a model SDK
│   ├── model/        # config model-slug → AI SDK LanguageModel; capabilities catalog
│   │                 # (dialect routing, litellm snapshot); pricing catalog; token/cost accounting
│   ├── boundary/     # THE model-output wall: extract-json, Model*Schemas, normalize,
│   │                 # dialects (structured|prose as one seam), token estimation
│   ├── prompts/      # prompt loading, template binding, prompt/config hashing (provenance)
│   ├── tools/        # QualOps-OWNED tool implementations: read/grep/glob/usages/git +
│   │                 # bash sandbox (moves as-is) — backend-agnostic, ToolDefinition shape
│   └── backend/      # port IMPLEMENTATIONS. ai-sdk/ implements CompletionPort (generateObject/
│                     # generateText) + AgentRunPort (tool loop via stopWhen); owns the
│                     # compaction + USD-budget wrappers (08 §4.2). Sole shipped backend;
│                     # the port keeps it swappable (eve/ at GA; others only if a need appears)
├── domains/          # business logic; no cross-domain imports
│   ├── intake/       # change detection, diff hygiene, tiering, import-graph clustering
│   ├── review/       # candidate generation: reviewer execution, ONE traversal
│   │                 # parameterized by dialect (kills the prose/structured twin trees)
│   ├── verification/ # verifier, evidence collection
│   ├── admission/    # deterministic filters + gate inputs: scope, fingerprint dedup,
│   │                 # category excludes, thresholds, baseline, RejectReason
│   ├── fix/          # fix proposal generation/validation; local apply + rollback
│   ├── reporting/    # markdown/html/json/sarif renderers, root-cause extraction (optional)
│   ├── gate/         # deterministic CI verdict from admitted findings (was "judge")
│   └── memory/       # feedback embeddings, learned-rules lifecycle
├── forges/
│   ├── core/         # shared: comment markdown, fingerprint markers, review state,
│   │                 # publishing protocol (kills the github/gitlab duplication)
│   ├── github/       # API client, checks, PR reviews, suggestion blocks
│   └── gitlab/       # API client, discussions, resolution
└── app/
    ├── run/          # Stage registry {name, deps, run(ctx)}, RunContext construction,
    │                 # orchestrator, error policy, single exit point (flush-then-exit)
    ├── cli/          # thin wiring → pure runCli(argv, {cwd, env, logSink}) → {exitCode}
    └── action/       # GitHub-Action entry
```

Tests are colocated (`foo.ts` + `foo.test.ts`) for new/moved code; the `tests/` tree shrinks to integration/e2e (incl. the recorded forge fixtures of [05-quality-spec.md](05-quality-spec.md) §5).

## 3. Code conventions (normative)

- Named exports only; functions by default — classes only for genuine live state (e.g. the bash sandbox session). Model clients are the AI SDK's concern, not ours. No new singletons; dependencies arrive via `RunContext` or parameters.
- Comments state policy decisions and constraints, not narration.
- Before writing any helper: it exists in `kernel/` or it is added there — never inline. New `utils/` folders are prohibited.
- A conventions file (`.agent/IMPLEMENTATION.md`-style) records these plus the anti-pattern list (no inline env reads, no parsing outside `llm/boundary`, …) for humans and coding agents alike.

## 4. The LLM boundary

Placement of [02-pipeline-spec.md](02-pipeline-spec.md) §4. One funnel: recovery ladder → loose `Model*Schema` (`z.preprocess`: alias maps, coercion, `.catch`, truncate-before-parse) → `normalize()` → strict contract. The two existing JSON ladders (`ai/shared/structured/` and the agentic `result-parser`) merge here, keeping the union of their recovery tricks. Prose is a dialect behind the same interface, not a parallel class tree. Port the spike's `agent-contracts.ts` normalization and verdict alias maps rather than rewriting them (D8).

## 4a. The two ports (business logic ⟂ model backend)

The model backend is the **Vercel AI SDK** ([08-harness-decision.md](08-harness-decision.md)). Domains never see it: they depend only on two port interfaces declared in `contracts/ports` and implemented in `llm/backend/ai-sdk`. This keeps the choice swappable (a reversal — Eve at GA, or a rejected own-harness option — stays cheap) and, more importantly, keeps everything that differentiates QualOps (tools, sandbox, parsing, verification) on our side of the seam rather than inside a vendor's loop.

- **`CompletionPort`** — single-shot, optionally schema-constrained calls (checklist reviewers, the verifier, LLM judges). Backed by the AI SDK's `generateObject`/`generateText`.
- **`AgentRunPort`** — tool-using multi-turn runs (agent reviewers). Backed by the AI SDK's tool loop (`stopWhen`/`stepCountIs`, `prepareStep`).
- **Model resolution and dialect routing live in `llm/model`**, not in the ports: a config model-slug resolves to an AI SDK `LanguageModel` plus its capabilities (structured vs. prose dialect, from the litellm snapshot) and pricing. The ports take a resolved `ModelRef`; domains never name a provider.
- No domain code imports a model SDK, a provider package, or an agent framework — enforced by the layer rules in §1.
- **`AgentRunPort` contract** (normative shape):

```ts
interface AgentRunPort {
  capabilities(): { subagents: boolean; structuredOutput: boolean; parallelTools: boolean }
  run(spec: AgentRunSpec): Promise<AgentRunResult>
}
interface AgentRunSpec {
  instructions: string; input: string; model: ModelRef
  tools: ToolDefinition[]                  // QualOps-owned implementations (llm/tools)
  outputSchema?: JsonSchema
  budget: { maxTurns: number; maxUsd?: number; maxTokens?: number }
  subagents?: SubagentSpec[]
}
interface AgentRunResult {
  output: unknown                          // still normalized at the LLM boundary afterward
  trajectory: TrajectoryEvent[]            // every tool call: name, args, result digest, ts
  usage: TokenUsage & { costUsd?: number }
  termination: 'completed' | 'max-turns' | 'budget-exhausted' | 'error'
  error?: StructuredError
}
```

- **Tools are QualOps-owned, always.** Adapters only dispatch to `llm/tools`; no backend's built-in tools are ever enabled (this is already how the current Claude-Agent-SDK adapter works — the rule becomes architectural). This keeps sandboxing, skip-pattern enforcement, secret redaction, and audit logging identical across backends — the property that matters in regulated environments.
- **The trajectory is part of the contract**, not an optional nicety: the component/trajectory evals ([05-quality-spec.md](05-quality-spec.md) §4) and the context ledger consume it, so any adapter that cannot report its tool calls fails the port's conformance tests.
- **Port conformance suite**: one shared test suite (fixture tools + scripted runs) that every adapter must pass — budget enforcement, tool-error propagation, termination reasons, trajectory completeness. Swapping backends means passing the suite, not re-testing domains.
- Adapter results feed the same LLM boundary (§4) — a harness is a transport, never a parser.

## 5. Centralization map (every duplicate → its one home)

| Today (copies — appendix A / audit) | Target home |
|---|---|
| 4× `escapeHtml`, 2× line numbering | `kernel/text` |
| 4× location parsing (incl. the buggy `normalizeLocation`, F-14) | `kernel/location` (port the robust `parseLocation`) |
| 3× retry + inconsistent SDK `maxRetries` (F-24) | `kernel/retry`; SDK retries configured consistently on top |
| 2× JSON recovery ladders | `llm/boundary/extract-json` |
| 2× `estimateTokens` (÷3.5 vs ÷4) | `llm/boundary/tokens` |
| 2× frontmatter parsers (one silently failing) | `kernel/markdown` (real YAML, schema-validated, loud errors) |
| 6 prose/structured twin classes + mirror methods | one traversal in `domains/review` + `llm/boundary/dialects` |
| 4 Finding shapes, 2 severity vocabularies; 2× FixSuggestion/FileDiff/ReportSummary/ExtractLog/RootCauseTaxonomy/QualOpsResult | `contracts/` (delete `issue.model.ts`, `pattern.model.ts`, `session.model.ts`) |
| forge comment formatting duplicated | `forges/core` |
| scattered `process.env` | `platform/env` |
| 2 unrelated `withErrorHandling` | `kernel/error` + one policy in `app/run` |
| 3× minimatch wrappers | `kernel/glob` |
| `diff` npm package (single call site) + in-house diff | `domains/fix` in-house; drop the dependency |
| static classes (`TemplateEngine`, `FilterMatcher`, `DocDiscovery`, `PromptLoader`, `IssueValidator`, `AgentLoader`) | plain function modules |
| 8 singletons, 16+ `getInstance()` sites | `RunContext` |

**Provider-layer collapse (a deletion, not a dedup).** The AI SDK decision (08) removes most of today's hand-rolled `src/ai/providers/` — `base.ts`, `anthropic.ts`, `bedrock.ts`, `openai-compatible-provider.ts`, `openai.ts`, `github.ts`, `factory.ts`, and the `token-stats` global — all replaced by `@ai-sdk/*`. Only the genuinely QualOps-specific parts survive, into `llm/model`: the capabilities catalog (dialect routing), the pricing catalog, and the token/cost accounting policy. The two provider singletons (global provider, global token stats) die with the rest. This is the single largest code reduction in the refactor and removes ~7 bespoke files from the critical path.

## 6. Runtime model

- **Stage registry**: stages implement `{ name, deps, run(ctx): Promise<Result> }`; the orchestrator resolves order from `deps` (replaces the hand-written switch + parallel dependency map + `getStageResults`).
- **Artifacts**: written once by the runner via `session-store`, carrying `schemaVersion`; `--resume <session>` is the only reuse path (F-6/F-7).
- **Error policy**: stage failure → `StructuredError` artifact; continue if recoverable, abort if not; telemetry flushed before the single exit point; gate result drives the exit code (F-1/F-2/F-3).

## 7. Dependency policy

Keep: `zod`, OTel + `@langfuse/otel`, `commander`, `minimatch`, `glob`, one YAML parser (D4). **Model backbone:** `ai` + the `@ai-sdk/*` providers actually used (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/amazon-bedrock`, `@ai-sdk/openai-compatible`), each wired per-provider as an **optional peerDependency** with a `provider_adapter_missing` error (the packaging flip ships after P3; composite-action install matrix tested first). **Drop:** `diff`, `@openai/agents`, `@eggai/configurable-agent`, and — leaving the default install — `@anthropic-ai/claude-agent-sdk` (08). Net ≈ 450 fewer mandatory production packages. Hand-rolled stays hand-rolled (template, retry, concurrency, frontmatter): small, tested, dependency-free.

**Transition (per the refactor-first sequencing):** the two ports are introduced *wrapping the current provider code* during the structure refactor, so no behavior changes then; the implementation behind the ports swaps to the AI SDK adapter in Phase 2 ([06-roadmap.md](06-roadmap.md)). The port boundary is exactly what bounds that later swap's blast radius.

## 8. Structural budget (CI-tracked)

Cross-module import ratio < 40% (from 71%) · import cycles = 0 (from 2) · max dependency depth ≤ 6 (from 12) · classes only where stateful (~8–10, from 47 — the provider-client classes go to the AI SDK) · singletons = 0. Regressions flag in CI alongside the eval gates.
