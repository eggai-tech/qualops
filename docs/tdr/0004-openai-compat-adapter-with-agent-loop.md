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

### Option D — eggai-tech/EggAI

Async-first multi-agent meta framework using agent-to-agent message passing over Kafka channels.

**Community:** 47 GitHub stars · last commit Mar 2026.

**Pros:**
- Multi-language (Python, JS, Go, etc.) via shared Kafka transport.
- Vendor-agnostic via LiteLLM integration.

**Cons:**
- **Architectural mismatch.** Distributed Kafka message-passing model vs. an embedded
  synchronous CLI loop. Not designed as a single-agent conversation harness.
- No built-in conversation loop for tool calling.
- No context window management.
- Kafka client dependency is heavyweight for a CLI that does synchronous code review.

---

### Comparison

| Criterion                  | A — Hand-rolled   | B — Vercel AI SDK  | C — puristajs      | D — EggAI         |
|----------------------------|-------------------|--------------------|--------------------|-------------------|
| TypeScript-native          | ✅                | ✅                 | ✅                 | ⚠️ unclear        |
| Built-in agentic loop      | ✅                | ✅                 | ✅                 | ❌                |
| OpenAI wire format         | ✅                | ✅                 | ✅                 | ✅ via LiteLLM    |
| Context window management  | ✅ built-in       | ❌ caller-owned    | ❓ undocumented    | ❌                |
| Error-as-tool-result       | ✅                | ⚠️ streaming only  | ❓                 | ❌                |
| GitHub stars               | —                 | 24,700             | 1                  | 47                |
| Zero added dependencies    | ✅                | ❌                 | ❌                 | ❌                |

## Proposed decision: Option A — hand-rolled harness

The only credible external alternative is the Vercel AI SDK (Option B). It has strong community
health but lacks the one feature that makes this harness non-trivial: proactive context window
management with summarisation. Adopting it would require adding a second dependency for token
counting and re-implementing the context manager anyway — more moving parts, not fewer.

puristajs/harness (Option C) is the closest architectural match, but at 1 GitHub star and less
than five weeks old it carries unacceptable maintenance risk for a production tool. A dependency
on a single-maintainer library this early in its lifecycle is hard to justify.

eggai-tech/EggAI (Option D) is architecturally mismatched. Its distributed Kafka model is the
wrong abstraction for an embedded synchronous loop.

The hand-rolled approach keeps QualOps self-contained, avoids version drift in a critical path,
and allows the context manager to be tuned specifically for code review workloads where tool
output can be unusually large.

**This decision should be revisited if:**
- The Vercel AI SDK adds built-in context window management with summarisation support.
- A harness library with >1k stars, multiple contributors, and built-in context management
  reaches maturity.
- QualOps needs multi-agent orchestration (e.g. a planner agent delegating to specialist
  agents) that the current flat single-agent loop cannot serve.

## Architecture

```
  Caller (AgenticExecutor)
         │
         │  run(params)
         ▼
┌─────────────────────────────────────────────────────────────────┐
│  OpenAICompatAdapter                                            │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Session state: ChatMessage[]                            │   │
│  │  [ system ] [ user ] [ assistant ] [ tool ] [ ... ]      │   │
│  └───────────────────────┬──────────────────────────────────┘   │
│                          │                                      │
│          ┌───── turn loop (1..maxTurns) ──────────────┐         │
│          │                                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  ContextManager         │               │         │
│          │  │  maybeSummarize()       │               │         │
│          │  │  · estimate tokens      │               │         │
│          │  │  · if > 60% window:     │               │         │
│          │  │    summarise oldest     │               │         │
│          │  │    exchange → [summary] │               │         │
│          │  │    fallback: truncate   │               │         │
│          │  └────────────┬────────────┘               │         │
│          │               │ compressed history         │         │
│          │               ▼                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  fetchWithRetry()       │               │         │
│          │  │  POST /chat/completions │◄──────────────┼────────►│ LLM endpoint
│          │  │  · 429/5xx: backoff×3   │               │         │
│          │  │  · 401: immediate fail  │               │         │
│          │  └────────────┬────────────┘               │         │
│          │               │ ChatCompletionResponse     │         │
│          │               ▼                            │         │
│          │       finish_reason?                       │         │
│          │       ├─ stop ──────────────────► return output      │
│          │       ├─ length ────────────────► error_max_tokens   │
│          │       ├─ content_filter ────────► error_content_filter
│          │       └─ tool_calls                        │         │
│          │               │                            │         │
│          │               ▼                            │         │
│          │  ┌─────────────────────────┐               │         │
│          │  │  Tool Dispatch          │               │         │
│          │  │  (sequential)           │               │         │
│          │  │  · resolve by name      │               │         │
│          │  │  · parse JSON args      │               │         │
│          │  │  · execute handler      │               │         │
│          │  │  · append tool result   │               │         │
│          │  └─────────────────────────┘               │         │
│          │                                            │         │
│          └────────────────────────────────────────────┘         │
│                          │                                      │
│               maxTurns exceeded → error_max_turns               │
│                                                                 │
│  finally: toolSet.dispose()                                     │
└─────────────────────────────────────────────────────────────────┘
         │
         │  AgentAdapterResult { output, inputTokens, outputTokens, errorSubtype? }
         ▼
  Caller (AgenticExecutor)
```

The harness is composed of three layers:

### Adapter

The adapter (`OpenAICompatAdapter`) is the entry point and owns the session lifecycle. It
implements an **imperative while loop** — the same pattern used by the OpenAI Agents SDK and
smolagents. The alternative (a declarative graph such as LangGraph's `StateGraph`) is more
expressive for multi-agent topologies but adds conceptual overhead that is unnecessary for
flat single-agent reasoning.

The adapter receives a system prompt, a user prompt, a set of tool definitions, and configuration
— model name, endpoint URL, API key, and a turn budget. It builds an initial message history and
enters the loop.

On each turn it sends the current history to the endpoint and waits for a reply. If the model
signals it is done (`finish_reason: stop`) the loop exits and the assistant's final text is
returned. If the model requests tool calls, the adapter dispatches each one, appends the results,
and continues to the next turn.

The adapter handles HTTP-level errors with exponential backoff for rate limiting (429) and server
errors (5xx), and maps each terminal condition to a stable `errorSubtype` string that callers can
match without parsing error messages. This gives callers a machine-readable signal for every
failure mode.

Tool errors — unknown tool names, malformed arguments, execution failures — are handled using the
**error-as-tool-result pattern**: the error is formatted as a `tool` role message and appended to
history, letting the model observe what went wrong and recover in the next turn. This is the same
pattern used by the OpenAI Agents SDK's `ToolErrorFormatter`. The alternative (throwing the
error to the caller) would abort the session for what are often recoverable conditions.

The adapter is stateless between `run()` calls; all session state lives in the message history.
Subagent orchestration is not supported — the model reasons flat using the provided tools.

### Context Manager

The context manager (`maybeSummarize`) is called at the start of each turn, before the request
is sent. It estimates the token count of the current history and compares it against the known
context limit for the model.

**Why 60%, not 80%?** Letta/MemGPT triggers compression at 80% because it works *reactively*:
the response has already been received and is in hand. This harness compresses *proactively*,
before sending the next request. The remaining 40% of the window must budget for two things: the
summarisation call response and the model's next substantive reply. 60% is the correct trigger
for a proactive strategy; 80% would risk running out of context mid-summarisation.

When compression is needed, the context manager applies **tool exchange atomicity**: the assistant
message containing tool calls and all of its corresponding tool results are treated as an
indivisible unit. They are summarised or dropped together, never split. (smolagents enforces the
same principle via its `ActionStep` abstraction; Letta has a `group_id` field but enforces it
weakly.) Splitting a tool call from its result would leave the model with an inconsistent view of
what happened.

The **preservation contract** is explicit: the system message at index 0 and the original user
task at index 1 are architecturally protected and are never compressed or dropped, regardless of
context pressure. This mirrors Letta's pinned `in_context_messages[0]` and smolagents'
immutable `SystemPromptStep`.

Token counting uses an approximation (`estimateTokens` on `JSON.stringify(history)`) rather than
exact per-token counting (e.g. tiktoken). This is a deliberate performance trade-off. The
consequence of a false positive is an extra summarisation call; the consequence of a false
negative would be a context overflow. The approximation errs toward early compression.

If the summary call fails, the context manager falls back to hard truncation: dropping the oldest
tool exchange entirely. System and user messages are always preserved.

### Tool Dispatch

Tool definitions are Zod schemas. Before the first request, the adapter converts each schema to
JSON Schema (draft-7 target) using the existing `schemaToJsonSchema` utility. Draft-7 is chosen
over draft-2020-12 because some vendor endpoints have narrow JSON Schema parsers that reject the
newer `$schema` markers.

Tool calls are dispatched **sequentially**. This is not an arbitrary constraint — LangGraph,
the OpenAI Agents SDK, and smolagents all default to sequential execution for the same reason:
stateful tools cannot be safely interleaved. The bash session tool maintains shell state between
calls (working directory, environment variables, running processes). Parallel dispatch would
produce non-deterministic results. LangGraph's `Send` API enables parallel execution, but only
for tools that are stateless and idempotent — a prerequisite that does not hold here.

## Configuration

The `openai-compat` provider is configured inside the standard `ai.reviewStage` block:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai-compat",
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

- **Streaming.** Responses are collected in full before processing. Streaming would require
  assembling partial `tool_calls` deltas before dispatch and is a non-trivial addition.

- **Parallel tool execution.** Tool calls are always sequential. LangGraph's `Send` API is the
  industry model for parallel dispatch, but it requires all tools to be stateless and idempotent.
  The bash session tool is stateful, so this prerequisite cannot be met without architectural
  changes to the tool layer.

- **Reactive overflow recovery.** If a single tool result exceeds the remaining context budget
  after proactive compression (e.g. a file read returning a megabyte of output), the endpoint
  returns an HTTP 400. The harness surfaces this as an unhandled error. Proactive compression
  reduces the probability but does not eliminate it; a per-tool result size limit would be the
  correct fix.
