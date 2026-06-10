# TDR 0004 — OpenAI-Compatible Agentic Adapter

**Status:** Proposed — 2026-06-09

## Context

QualOps' agentic review mode is gated on two proprietary SDKs: `@anthropic-ai/claude-agent-sdk`
for Anthropic and `@openai/agents` for OpenAI. Both SDKs manage their own tool dispatch,
context handling, and multi-turn orchestration internally. This works well for the providers they
were designed for, but it prevents using any other model that speaks the OpenAI chat completions
wire format — Groq, Mistral, local models via Ollama or LM Studio, Gemini via OpenRouter,
DeepSeek on Fireworks, and others.

These providers all implement the same `/v1/chat/completions` endpoint with tool calling
(`tool_calls` in the assistant message, `tool` role in the next user turn). The only thing missing
is a client-side loop that drives the conversation, dispatches tool calls, and manages the context
window without relying on a provider-specific SDK.

This TDR evaluates whether to build that loop inside QualOps or delegate it to an external
library, and records the design decisions made in the chosen approach.

## Options Considered

### Option A — Hand-rolled harness (build internally)

A self-contained TypeScript module (~270 lines) driving a `while` loop directly against the
OpenAI chat completions wire format using `fetch`. No runtime dependency added.

**Pros:**
- Zero added dependencies; no version drift risk in a critical path
- Full control over context window management — proactive summarisation with hard-truncate
  fallback, tuned for the large tool outputs typical in code review workloads
- Sequential tool dispatch is explicit, auditable, and stateful-safe
- Deterministic error codes (`errorSubtype`) that callers match without parsing text
- Already implemented, tested, and passing

**Cons:**
- Maintenance burden sits entirely on the QualOps team
- Does not benefit from improvements in the wider ecosystem

---

### Option B — Vercel AI SDK (`ai` package, v6)

`generateText` with `maxSteps` drives the tool-calling loop internally. Provider-agnostic via
`@ai-sdk/openai-compatible` with configurable `baseURL`.

**Community:** 24,700 GitHub stars · active core team · last commit Jun 2026 · v6 stable.
**Size:** Modular packages; `ai` core ~67 kB gzipped.

**Pros:**
- Mature, well-maintained, large community
- Built-in loop (`maxSteps`), `prepareStep` hook between turns, `onStepFinish` callback
- OpenAI-compatible via `createOpenAICompatible({ baseURL, apiKey })`
- Tool errors in streaming surfaced as `tool-error` parts fed back to model

**Cons:**
- **Context window management not built-in.** `pruneMessages` utility exists but the caller
  decides strategy; no summarisation primitive. Replacing our context manager would require
  adding a second dependency (e.g. tokenlens) and re-implementing the logic anyway.
- Tool errors in `generateText` (non-streaming) are thrown, not fed back to the model — the
  error-as-tool-result pattern must be re-implemented on top.
- Web-first design bias (Next.js); CLI is supported but not the primary persona.

---

### Option C — puristajs/harness (v1.0.0)

TypeScript-native harness with typed agent loop, pluggable provider adapters (OpenAI, Anthropic,
Bedrock, Azure), and workflow primitives (approval gates, parallelisation).

**Community:** 1 GitHub star · single maintainer · released May 2026 (< 5 weeks old at time of
writing).

**Pros:**
- Designed precisely for embedded TypeScript harnesses
- Explicit workflow primitives (approval gates, parallel agents) useful for future multi-agent work
- Provider-agnostic with adapters for major providers

**Cons:**
- **Nascent community** — 1 star, single contributor, no visible production users.
- Context window management strategy undocumented.
- API stability unknown at v1.0, released < 5 weeks ago.
- Unacceptable maintenance risk for a single-maintainer project at this maturity level.

---

### Option D — configurable-agent (eggai-tech in-house harness)

A standalone TypeScript service (Node 22, ESM) built and maintained by the eggai-tech team,
already in production use for other agents in the organisation. It runs an agentic for-loop
(`runAgent()`) built on the **Vercel AI SDK (`ai` v5)** with:
- Streaming each step via `streamText()`
- `ToolSet` injection via `RunAgentOptions.tools` — QualOps passes its own tools without MCP
- Structured `AgentEvent` callbacks (`tool_call`, `tool_result`, `content_delta`, `final`, `error`)
- Context compaction (LLM-based summarisation at 100k tokens) and tool output summarisation (>4k tokens)
- OpenAI-compatible endpoints via `@ai-sdk/openai-compatible` (provider: `ollama` or `openai-compatible`, configurable `baseUrl`)

**Current state:** `runAgent()` exists and is tested, but is not yet exposed as a public library
entry point. A one-time extraction is needed before QualOps can depend on it.

**Pros:**
- Loop, context compaction, and tool output summarisation already built and tested in production
- Vercel AI SDK foundation — OpenAI-compatible endpoints supported natively
- `ToolSet` injection path already exists — no MCP server required
- `AgentEvent` emitter pattern is clean and observable
- Maintained by the same organisation — no external dependency risk, aligned direction
- Removes ~300 lines of hand-rolled loop from QualOps

**Cons:**
- `runAgent()` is not yet a public library API — requires a one-time library entry point extraction in the configurable-agent repo
- QualOps tools (Zod schema + execute function) must be adapted to Vercel AI SDK `ToolSet` shape
- `AgentConfig` is currently YAML/file-driven — QualOps must construct it programmatically
- Streaming-first design: QualOps must accumulate `content_delta` events until `final` to get output string
- Replaces our tested context manager with configurable-agent's compaction (different threshold: 100k tokens vs 60% proactive — needs validation)
- `provider` enum covers `anthropic | openai | google | ollama` — `openai-compatible` may need to be added or `ollama` repurposed as the generic path

---

### Comparison

| Criterion                  | A — Hand-rolled   | B — Vercel AI SDK  | C — puristajs      | D — configurable-agent |
|----------------------------|-------------------|--------------------|--------------------|-----------------------|
| TypeScript-native          | ✅                | ✅                 | ✅                 | ✅                    |
| Built-in agentic loop      | ✅                | ✅                 | ✅                 | ✅                    |
| OpenAI wire format         | ✅                | ✅                 | ✅                 | ✅ via Vercel AI SDK  |
| Context window management  | ✅ built-in       | ❌ caller-owned    | ❓ undocumented    | ✅ built-in           |
| Error-as-tool-result       | ✅                | ⚠️ streaming only  | ❓                 | ✅ via AgentEvent     |
| GitHub stars               | —                 | 24,700             | 1                  | — (internal)          |
| Zero added dependencies    | ✅                | ❌                 | ❌                 | ❌                    |
| Reusable outside QualOps   | ❌                | ✅                 | ✅                 | ✅ (by design)        |
| Same-org ownership         | ✅                | ❌                 | ❌                 | ✅                    |

## Decision: Option D — configurable-agent

Option D is the recommended approach. The configurable-agent harness is built by the same
eggai-tech team, already production-tested, and removes the maintenance burden of a hand-rolled
loop from QualOps. The `tools` injection path (`RunAgentOptions.tools`) means QualOps does not
need to run MCP servers — it constructs its own `ToolSet` at call time. The Vercel AI SDK
already handles OpenAI-compatible endpoints, satisfying the core requirement.

Beyond QualOps, standardising on configurable-agent's `AgentEvent` API creates shared
infrastructure for the wider eggai-tech agent portfolio: the structured event stream is the
natural integration point for external observability tools (Langfuse), and a config-driven
`AgentConfig` supports low-code deployment patterns that reduce the audit surface clients
must review before approving production use. These benefits compound as more agents in the
organisation adopt the same harness.

## Technical tasks

### Phase 1 — Prerequisite refactors

These changes should be made before any integration work begins. They make both repositories
cleaner independently of each other and remove the need for workarounds in the adapter.

#### configurable-agent

**1. Add `openai-compatible` as a named provider**

`model.ts` currently handles OpenAI-compatible endpoints only via the `ollama` case, which calls
`createOpenAICompatible({ name: 'ollama', baseURL })` without passing an API key. This silently
breaks any authenticated endpoint (Mistral, Groq, DeepSeek, etc.).

Add `openai-compatible` to the `ModelProvider` enum, add `apiKey?: string` to the `model` object
in `AgentConfigSchema`, and add a corresponding case in `buildModel`:

```typescript
case 'openai-compatible': {
  const baseURL = cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  const apiKey  = cfg.apiKey  ?? process.env.OPENAI_API_KEY  ?? '';
  const compat  = createOpenAICompatible({ name: 'openai-compatible', baseURL, apiKey });
  return compat(cfg.name);
}
```

**Why not reuse `ollama`?** Injecting a Mistral API key via `OLLAMA_BASE_URL` / `OLLAMA_API_KEY`
is misleading and fragile. A named provider is clearer and avoids confusion in logs and telemetry.

---

**2. Expose `runAgent` and types as a library entry point**

`runAgent`, `AgentConfig`, `AgentEmitter`, `AgentEvent`, and `RunAgentOptions` are defined and
tested but not reachable from outside the package. Add a library entry point:

```json
// package.json
"exports": {
  ".": "./dist/index.js",
  "./lib": "./dist/lib/index.js"
}
```

```typescript
// lib/index.ts
export { runAgent, prepareMessages } from './agent/loop.js';
export type { RunAgentOptions }      from './agent/loop.js';
export type { AgentConfig }          from './config/schema.js';
export type { AgentEmitter, AgentEvent, ToolResult } from './agent/events.js';
```

#### QualOps

**4. Remove `OpenAICompatAdapter` and `context-manager.ts`**

The hand-rolled agentic adapter (`src/stages/review/agentic/adapters/openai-compat-adapter.ts`)
and context manager (`src/stages/review/agentic/adapters/context-manager.ts`) are replaced by
the configurable-agent integration. Removing them before writing the new adapter avoids confusion
about which loop is active and eliminates dead code in the test suite.

---

### Phase 2 — Integration

Once the Phase 1 refactors are merged in both repos:

1. **Add dependency** on configurable-agent (local path dep initially, then published to npm).

2. **New adapter** `ConfigurableAgentAdapter` implementing `AgentAdapter`:
   - Constructs `AgentConfig` programmatically from `AgentAdapterParams`
     (systemPrompt, model, maxTurns → maxSteps, maxOutputTokens, baseUrl, apiKey)
   - Converts QualOps `ToolDefinition[]` to Vercel AI SDK `ToolSet` format
   - Calls `runAgent(config, [userMessage], emitter, undefined, { tools })`
   - Accumulates `content_delta` events into an output string; maps `error` event codes to
     `errorSubtype` values; extracts token usage from the `final` event

3. **Register adapter** — wire `ConfigurableAgentAdapter` in
   `src/stages/review/agentic/adapters/index.ts` for both `anthropic` and `openai-compatible`
   providers (replacing `AnthropicAdapter`, `OpenAIAdapter`, and `OpenAICompatibleAdapter`).

No existing code changes — purely additive.

---

## Architecture

```
  Caller (AgenticExecutor)
         │
         │  run(params)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  ConfigurableAgentAdapter (QualOps)                                 │
│                                                                 │
│  · Constructs AgentConfig from AgentAdapterParams               │
│  · Converts ToolDefinition[] → Vercel AI SDK ToolSet            │
│  · Accumulates AgentEvent stream into AgentAdapterResult        │
└──────────────────────────┬──────────────────────────────────────┘
                           │  runAgent(config, messages, emit, options)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  configurable-agent: runAgent()                                 │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Message history: CoreMessage[]                          │   │
│  │  [ system ] [ user ] [ assistant ] [ tool ] [ ... ]      │   │
│  └───────────────────────┬──────────────────────────────────┘   │
│                          │                                      │
│          ┌───── step loop (1..maxSteps) ──────────────┐         │
│          │                                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  Context Compaction     │               │         │
│          │  │  · trigger at 100k tok  │               │         │
│          │  │  · LLM-based summary    │               │         │
│          │  │  · tool output >4k tok  │               │         │
│          │  │    summarised inline    │               │         │
│          │  └────────────┬────────────┘               │         │
│          │               │ compacted history          │         │
│          │               ▼                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  streamText()           │               │         │
│          │  │  (Vercel AI SDK)        │◄──────────────┼────────►│ LLM endpoint
│          │  │  · @ai-sdk/openai-      │               │         │
│          │  │    compatible           │               │         │
│          │  └────────────┬────────────┘               │         │
│          │               │ StreamTextResult           │         │
│          │               ▼                            │         │
│          │       stopReason?                          │         │
│          │       ├─ stop ──── emit final ──────────── ┼── ✓     │
│          │       ├─ length ── emit error(code) ─────── ┼── ✗    │
│          │       └─ tool-calls                        │         │
│          │               │                            │         │
│          │               ▼                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  Tool Dispatch          │               │         │
│          │  │  (sequential)           │               │         │
│          │  │  · execute ToolSet fn   │               │         │
│          │  │  · emit tool_call       │               │         │
│          │  │  · emit tool_result     │               │         │
│          │  └─────────────────────────┘               │         │
│          │                                            │         │
│          └────────────────────────────────────────────┘         │
│                          │                                      │
│               maxSteps exceeded → emit error(max_steps)         │
└─────────────────────────────────────────────────────────────────┘
         │
         │  AgentAdapterResult { output, inputTokens, outputTokens, errorSubtype? }
         ▼
  Caller (AgenticExecutor)
```

The integration is composed of two layers:

### QualOps Adapter

The QualOps adapter (`ConfigurableAgentAdapter`) bridges `AgentAdapterParams` and
`configurable-agent`'s `runAgent()`. It is responsible for:

1. **Config construction** — building an `AgentConfig` programmatically from `AgentAdapterParams`
   (model name, endpoint URL, API key, maxSteps, maxOutputTokens) rather than loading a YAML file.

2. **Tool conversion** — mapping QualOps `ToolDefinition[]` (Zod schema + execute function) to
   Vercel AI SDK `ToolSet` format (`{ description, parameters: z.ZodType, execute }`). This is
   the same shape QualOps tools already have; the conversion is mechanical.

3. **Event accumulation** — subscribing to `AgentEmitter` callbacks and:
   - Concatenating `content_delta` events into an output string
   - Mapping `error` event codes to `errorSubtype` values that callers can match
   - Extracting token usage from the `final` event to populate `AgentAdapterResult`

The adapter is stateless between `run()` calls. All session state lives inside `runAgent()`.

### configurable-agent Loop

`runAgent()` implements an **imperative for-loop** over `streamText()` steps — the same pattern
used by the OpenAI Agents SDK and smolagents. The alternative (a declarative graph such as
LangGraph's `StateGraph`) is more expressive for multi-agent topologies but adds conceptual
overhead that is unnecessary for flat single-agent reasoning.

**Context compaction** triggers at 100k tokens (reactive, after receiving a response). When
the threshold is exceeded, older messages are summarised by an LLM call and replaced with a
`[COMPACTED CONTEXT]` system message; the 6 most recent messages are always kept verbatim.
Both thresholds are hardcoded in `ConfigurableAgentAdapter` and are not currently surfaced
as `.qualopsrc.json` configuration.

**Tool output truncation** fires before compaction: any tool result exceeding 4k tokens is
trimmed to head 500 + tail 500 characters inline, keeping history manageable before the
compaction threshold is ever reached.

**Tool exchange atomicity** is maintained: the Vercel AI SDK treats each step's tool calls and
results as a unit. Tool output summarisation (>4k tokens per result) reduces history bloat before
it reaches the compaction threshold.

**Tool dispatch is sequential**. This is not an arbitrary constraint — LangGraph, the OpenAI
Agents SDK, and smolagents all default to sequential execution for the same reason: stateful tools
cannot be safely interleaved. The bash session tool maintains shell state between calls (working
directory, environment variables, running processes). Parallel dispatch would produce
non-deterministic results.

## Configuration

The `openai-compatible` provider is configured inside the standard `ai.reviewStage` block:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai-compatible",
      "model": "mistral-small-latest",
      "baseURL": "https://api.mistral.ai/v1",
      "apiKeyEnvVar": "MISTRAL_API_KEY",
      "inputPerMillion": 0.1,
      "outputPerMillion": 0.3
    }
  }
}
```

`baseURL` identifies the chat completions base URL. It falls back to the `OPENAI_BASE_URL`
environment variable, then to the standard OpenAI endpoint. `apiKeyEnvVar` is the name of the
environment variable that holds the API key; it falls back to `OPENAI_API_KEY`, and if neither
is set the key is empty — valid for local endpoints like Ollama that require no authentication.

Structured output capability is derived automatically from the model name via the existing
litellm capability catalog. No manual configuration is required.

## What This Does Not Do (V1)

- **Subagent orchestration.** The model reasons flat using the tools it is given. Multi-agent
  delegation (e.g. a planner handing off to specialist agents) requires a graph-based
  orchestration layer such as LangGraph's `StateGraph` and is out of scope here.

- **Budget enforcement.** `maxBudgetUsd` is accepted and passed through but not enforced.

- **Streaming to the caller.** `runAgent()` streams internally (Vercel AI SDK `streamText`),
  but QualOps collects the full output via `AgentEvent` accumulation before returning
  `AgentAdapterResult`. Surfacing incremental output to the CLI is not yet implemented.

- **Parallel tool execution.** Tool calls are always sequential. LangGraph's `Send` API is the
  industry model for parallel dispatch, but it requires all tools to be stateless and idempotent.
  The bash session tool is stateful, so this prerequisite cannot be met without architectural
  changes to the tool layer.

- **Reactive overflow recovery.** If a single tool result exceeds the remaining context budget
  after proactive compression (e.g. a file read returning a megabyte of output), the endpoint
  returns an HTTP 400. The harness surfaces this as an unhandled error. Proactive compression
  reduces the probability but does not eliminate it; a per-tool result size limit would be the
  correct fix.

- **On-behalf-of (OBO) auth flows.** The harness passes a static API key per session.
  Delegated identity flows — where the agent acts on behalf of an authenticated end-user and
  token acquisition is tied to that user's session — are not yet supported by configurable-agent
  and are out of scope for V1.
