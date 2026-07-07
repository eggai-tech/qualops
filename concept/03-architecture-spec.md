# 03 — Architecture Specification

**Status:** Draft spec for human review · Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Evidence: appendix A §3 (defect inventory), structural scan (71% cross-module import edges, 2 cycles, 47 classes, 8 singletons), appendix D (spike patterns adopted per D8).

## 1. Layering (normative)

```
contracts ← kernel ← platform ← llm ← domains/forges ← app
```

- **`contracts`** imports nothing internal (only `zod`). **`kernel`** imports nothing internal at all.
- Domains never import other domains' internals, `forges`, or `app`; cross-domain data flows through `contracts` types, wired by `app/run`.
- Three exclusivity rules: only `llm/boundary` parses model output; only `platform/env` reads `process.env`; only `platform/session-store` writes run artifacts.
- Enforced in CI (dependency-cruiser / ESLint restricted paths / `.sentrux/rules.toml`); violations fail the build.

## 2. Target tree

```
src/
├── contracts/        # single source of truth: finding/, config/, run/, report/, shared/ primitives
│                     # strictObject + readonly, inferred types, colocated drift tests
├── kernel/           # pure stateless utilities, stdlib only:
│                     # result, error (StructuredError + exit-code table), redaction, retry,
│                     # concurrency, hash/fingerprint, text (line numbering, escapeHtml),
│                     # markdown (frontmatter), template, path-safety, location, glob
├── platform/         # process adapters: env, config loading/merging, logger (redaction-safe
│                     # by construction), git, session-store, observability (OTel + Langfuse)
├── llm/
│   ├── providers/    # anthropic, bedrock, openai-compatible (+ openai, github-models),
│   │                 # capabilities catalog, pricing, token accounting
│   ├── boundary/     # THE model-I/O wall: extract-json, Model*Schemas, normalize,
│   │                 # dialects (structured|prose as one seam), token estimation
│   ├── prompts/      # prompt loading, template binding, prompt/config hashing (provenance)
│   ├── tools/        # QualOps-OWNED tool implementations: read/grep/glob/usages/git +
│   │                 # bash sandbox (moves as-is) — harness-agnostic, defined against
│   │                 # the port's ToolDefinition shape
│   └── harness/      # the agent-loop PORT (§4a) + one adapter per backend:
│                     # purista/ (recommended default), ai-sdk/ (alternative),
│                     # claude-agent-sdk/ (opt-in), eve/ (candidate at GA) — see 08
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

- Named exports only; functions by default — classes only for live state (provider clients, bash sessions). No new singletons; dependencies arrive via `RunContext` or parameters.
- Comments state policy decisions and constraints, not narration.
- Before writing any helper: it exists in `kernel/` or it is added there — never inline. New `utils/` folders are prohibited.
- A conventions file (`.agent/IMPLEMENTATION.md`-style) records these plus the anti-pattern list (no inline env reads, no parsing outside `llm/boundary`, …) for humans and coding agents alike.

## 4. The LLM boundary

Placement of [02-pipeline-spec.md](02-pipeline-spec.md) §4. One funnel: recovery ladder → loose `Model*Schema` (`z.preprocess`: alias maps, coercion, `.catch`, truncate-before-parse) → `normalize()` → strict contract. The two existing JSON ladders (`ai/shared/structured/` and the agentic `result-parser`) merge here, keeping the union of their recovery tricks. Prose is a dialect behind the same interface, not a parallel class tree. Port the spike's `agent-contracts.ts` normalization and verdict alias maps rather than rewriting them (D8).

## 4a. The harness port (business logic ⟂ agent loop)

The agent-loop backend is an **open decision** ([08-harness-decision.md](08-harness-decision.md)); the architecture makes it swappable so the decision never leaks into business logic:

- Domains consume exactly two ports from `contracts/`: **`CompletionPort`** (single-shot, schema-constrained calls — checklist reviewers, verifier, judges) and **`AgentRunPort`** (tool-using runs). No domain code imports a harness adapter, a provider SDK, or an agent framework — enforced by the layer rules in §1.
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

## 6. Runtime model

- **Stage registry**: stages implement `{ name, deps, run(ctx): Promise<Result> }`; the orchestrator resolves order from `deps` (replaces the hand-written switch + parallel dependency map + `getStageResults`).
- **Artifacts**: written once by the runner via `session-store`, carrying `schemaVersion`; `--resume <session>` is the only reuse path (F-6/F-7).
- **Error policy**: stage failure → `StructuredError` artifact; continue if recoverable, abort if not; telemetry flushed before the single exit point; gate result drives the exit code (F-1/F-2/F-3).

## 7. Dependency policy

Keep: `zod`, OTel + `@langfuse/otel`, `commander`, `minimatch`, `glob`, one YAML parser (D4). Drop: `diff`. Provider SDKs and harness adapters: single-site imports today, structured for **optional peerDependencies** with `provider_adapter_missing` errors; the packaging flip ships separately after P3 (composite-action install matrix must be tested first). Harness backend selection and its supply-chain consequences: [08-harness-decision.md](08-harness-decision.md). Hand-rolled stays hand-rolled (template, retry, concurrency, frontmatter): small, tested, dependency-free.

## 8. Structural budget (CI-tracked)

Cross-module import ratio < 40% (from 71%) · import cycles = 0 (from 2) · max dependency depth ≤ 6 (from 12) · classes only where stateful (~10–12, from 47) · singletons = 0. Regressions flag in CI alongside the eval gates.
