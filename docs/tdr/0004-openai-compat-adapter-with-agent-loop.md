# TDR 0004 — OpenAI-Compatible Agentic Adapter

**Status:** Accepted — 2026-06-09

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

## Decision

Introduce an `openai-compat` provider that runs a self-contained agentic harness using raw HTTP
calls to any OpenAI-compatible chat completions endpoint. No agent SDK is involved. The harness
owns the reasoning loop, tool dispatch, and context window management, making it compatible with
any endpoint that speaks the standard wire format.

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

The adapter (`OpenAICompatAdapter`) is the entry point and owns the session lifecycle. It receives
a system prompt, a user prompt, a set of tool definitions, and configuration — model name, endpoint
URL, API key, and a turn budget. It builds an initial message history and enters a loop.

On each turn it sends the current history to the endpoint and waits for a reply. If the model
signals it is done (`finish_reason: stop`) the loop exits and the assistant's final text is
returned. If the model requests tool calls, the adapter executes each one in sequence, appends the
results to the history, and continues to the next turn. Execution is sequential rather than
parallel because some tools — specifically the bash session tool — are stateful and cannot be
interleaved safely.

The adapter handles HTTP-level errors with exponential backoff for rate limiting (429) and server
errors (5xx), and maps each terminal condition to a stable error subtype string that callers can
inspect without parsing error messages. Tool errors — unknown tool names, malformed arguments,
execution failures — are returned to the model as tool result messages rather than thrown. This
lets the model observe the error and recover without restarting the session.

The adapter is stateless between `run()` calls; all session state lives in the message history
that it builds up turn by turn. Subagent orchestration is not supported — the model reasons flat
using the provided tools.

### Context Manager

The context manager (`ContextManager`) is called at the start of each turn, before the request is
sent. It estimates the token count of the current history and compares it against the known context
limit for the model.

If the history exceeds 60% of the context window, the context manager compresses the oldest tool
exchange in the history. It does this by sending a one-shot request to the same endpoint, asking
it to summarise what was done and found in that exchange. The summary replaces the original
exchange in place — an assistant message with tool calls and the corresponding tool results become
a single system message prefixed `[summarized]`.

The 60% threshold is intentional. It ensures there is always room in the remaining window for both
the summary response itself and the model's next substantive reply. Triggering compression at a
higher threshold risks running out of context mid-summarisation.

If the summary call fails for any reason, the context manager falls back to hard truncation:
dropping the oldest tool exchange entirely rather than replacing it with a summary. The system and
user messages at the start of the history are always preserved.

### Tool Dispatch

Tool definitions are Zod schemas. Before the first request, the adapter converts each schema to
JSON Schema (draft-7 target) using the existing `schemaToJsonSchema` utility. Draft-7 is chosen
over draft-2020-12 because some vendor endpoints have narrow JSON Schema parsers that reject the
newer `$schema` markers.

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
environment variable that holds the API key; it falls back to `OPENAI_API_KEY`, and if neither is
set the key is empty — which is valid for local endpoints like Ollama that require no
authentication.

Structured output capability is derived automatically from the model name via the existing litellm
capability catalog. No manual configuration is required.

## What This Does Not Do (V1)

- **Subagent orchestration.** The model reasons flat using the tools it is given. Multi-agent
  handoff requires SDK-level orchestration that is out of scope here.
- **Budget enforcement.** `maxBudgetUsd` is accepted and passed through but not enforced.
- **Streaming.** Responses are collected in full before processing.
- **Parallel tool execution.** Tool calls are always sequential.
