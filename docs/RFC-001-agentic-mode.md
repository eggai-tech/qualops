# RFC-001: QualOps Agentic Review Mode

**Status:** Draft
**Author:** Stefano Tucci
**Date:** 2026-03-16
**Version:** 0.3.0 target

---

## 1. Executive Summary

QualOps agentic mode replaces the file-by-file review model with an AI agent that **explores the codebase autonomously** — tracing dependencies, detecting breaking changes, validating patterns, and finding security vulnerabilities across file boundaries.

The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is the execution engine. It already provides multi-agent orchestration, subagent lifecycle management, MCP tool servers, structured output, cost tracking, and abort control — out of the box. QualOps doesn't need to build an agent framework. It needs to **properly leverage the one it already depends on**.

This RFC documents the current state (v0.2.0), the SDK capabilities we're not using, and the concrete plan to ship production-grade agentic review in v0.3.0.

---

## 2. SDK Viability Analysis

### 2.1 What the Claude Agent SDK Provides

After a deep audit of `@anthropic-ai/claude-agent-sdk@0.2.75`, here's what the SDK gives us and what QualOps currently uses:

| SDK Capability | Available | QualOps Uses It |
|---------------|-----------|-----------------|
| `query()` — agent execution loop | ✅ | ✅ Basic usage |
| `agents` — named subagent definitions | ✅ | ⚠️ Passed but never invoked |
| `agent` — run main thread as a named agent | ✅ | ❌ Not used |
| `AgentDefinition` with `tools`, `disallowedTools`, `model`, `maxTurns` | ✅ | ⚠️ Partial (missing `disallowedTools`, `maxTurns`) |
| `outputFormat: { type: 'json_schema', schema }` — structured output | ✅ | ❌ Using regex parsing instead |
| `SDKResultSuccess.total_cost_usd` — total cost tracking | ✅ | ❌ Not read |
| `SDKResultSuccess.modelUsage` — per-model token breakdown | ✅ | ❌ Not read |
| `SDKTaskNotificationMessage` — subagent completion with usage | ✅ | ❌ Not read |
| `SDKTaskProgressMessage` — subagent progress with tokens | ✅ | ❌ Not read |
| `SDKAssistantMessage.message.usage` — per-turn token usage | ✅ | ❌ Not read |
| `abortController` — cancel execution mid-run | ✅ | ❌ Not used |
| `allowDangerouslySkipPermissions` — required for `bypassPermissions` | ✅ | ❌ Missing (current code may silently fail) |
| `createSdkMcpServer()` — in-process MCP tools | ✅ | ✅ 6 tools defined |
| `tool()` with Zod schemas — typed tool definitions | ✅ | ✅ |
| `mcpServers` — register MCP servers | ✅ | ✅ |
| Per-agent `mcpServers` — agent-specific MCP servers | ✅ | ❌ Not used |
| `Query.interrupt()` — graceful stop | ✅ | ❌ Not used |

### 2.2 Verdict: Highly Viable

The SDK is not just viable — it's **the right choice** and we already depend on it. The problem isn't the SDK. The problem is that 70% of its capabilities are unused. Specifically:

1. **Multi-agent delegation works out of the box.** When you pass `agents` to `query()`, the SDK exposes an `Agent` tool to the main conversation. The coordinator invokes subagents by name, each runs in its own context with its own prompt/tools/model, and results flow back. We just need to tell the coordinator to use them.

2. **Cost tracking is already computed.** `SDKResultSuccess` includes `total_cost_usd` and `modelUsage` broken down by model. We're ignoring both.

3. **Structured output eliminates regex parsing.** The SDK supports `outputFormat: { type: 'json_schema', schema }` which forces JSON output and returns it in `structured_output`. No more regex extraction.

4. **Budget enforcement = `abortController` + cost monitoring.** Read `total_cost_usd` from progress messages, abort when threshold is crossed.

**Alternatives considered and rejected:**

| Alternative | Why Not |
|-------------|---------|
| Raw Anthropic API + manual tool loop | Reimplements what the SDK does. 10x more code, same result. |
| LangChain/LangGraph | Python-centric, massive dependency tree, over-engineered for this. |
| Custom agent framework | Reinventing the wheel when the SDK already handles lifecycle, tools, subagents. |
| OpenAI Agents SDK | Different ecosystem, would require abstracting away Claude-specific features. |

### 2.3 SDK Message Stream — What We Get for Free

The `query()` async generator yields typed messages. Here's how they map to QualOps needs:

```typescript
for await (const message of result) {
  switch (message.type) {
    case 'assistant':
      // message.message: BetaMessage — includes usage.input_tokens, output_tokens
      // → Accumulate for budget tracking
      break;

    case 'system':
      if (message.subtype === 'task_started') {
        // → Subagent launched (log which agent, track start time)
      }
      if (message.subtype === 'task_progress') {
        // message.usage: { total_tokens, tool_uses, duration_ms }
        // → Live progress reporting
      }
      if (message.subtype === 'task_notification') {
        // message.status: 'completed' | 'failed' | 'stopped'
        // message.summary: string — subagent's final output
        // message.usage: { total_tokens, tool_uses, duration_ms }
        // → Parse subagent results, track per-agent metrics
      }
      break;

    case 'result':
      if (message.subtype === 'success') {
        // message.total_cost_usd: number — THE source of truth for cost
        // message.modelUsage: Record<string, ModelUsage> — per-model breakdown
        // message.structured_output: unknown — parsed JSON if outputFormat was set
        // message.num_turns: number
        // message.duration_ms: number
        // → Final results + comprehensive metrics
      }
      break;
  }
}
```

### 2.4 SDK Type Definitions (Key Types)

```typescript
// What we get back per model
type ModelUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
  costUSD: number;
  contextWindow: number;
  maxOutputTokens: number;
};

// Final result
type SDKResultSuccess = {
  type: 'result';
  subtype: 'success';
  duration_ms: number;
  num_turns: number;
  result: string;
  total_cost_usd: number;
  usage: NonNullableUsage;        // aggregate
  modelUsage: Record<string, ModelUsage>; // per-model
  structured_output?: unknown;    // if outputFormat was set
};

// Subagent definition — what we pass in
type AgentDefinition = {
  description: string;
  prompt: string;
  tools?: string[];
  disallowedTools?: string[];
  model?: string;
  mcpServers?: AgentMcpServerSpec[];
  maxTurns?: number;
};
```

---

## 3. Current State (v0.2.0)

### 3.1 What Works

| Component | Status | Location |
|-----------|--------|----------|
| `AgenticExecutor` orchestrator | Implemented | `src/stages/review/agentic/agentic-executor.ts` |
| 4 built-in subagents | Defined | `src/stages/review/agentic/subagents/definitions.ts` |
| 6 MCP tools | Implemented | `src/stages/review/agentic/tools/index.ts` |
| Custom agent loader (markdown) | Implemented | `src/stages/review/agentic/loaders/agent-loader.ts` |
| Context preloading (diff/full/auto) | Implemented | `agentic-executor.ts:171-231` |
| Pipeline integration | Wired | `pipeline-executor.ts` branches on `mode: 'agentic'` |
| Validation/dedup post-processing | Shared | Same path as file-by-file |
| Config schema (`AgenticConfig`) | Defined | `src/shared/types/config.ts:17-27` |
| 2 example custom agents | Provided | `examples/agents/{rxjs-migration,angular-signals}.md` |

### 3.2 Architecture (Current)

```
┌──────────────────────────────────────────────────────┐
│                    PipelineExecutor                   │
│                                                      │
│  ┌─────────────────┐      ┌────────────────────────┐ │
│  │  File-by-File   │      │   AgenticExecutor      │ │
│  │  (FileReviewer) │      │                        │ │
│  │                 │      │  ┌──────────────────┐  │ │
│  │  Per-file       │      │  │  query() loop    │  │ │
│  │  concurrent     │      │  │  Claude Agent SDK│  │ │
│  │  rate-limited   │      │  └────────┬─────────┘  │ │
│  │                 │      │           │            │ │
│  │                 │      │  ┌────────▼─────────┐  │ │
│  │                 │      │  │  MCP Tools (6)   │  │ │
│  │                 │      │  │  Subagents (4)   │  │ │
│  │                 │      │  │  Custom agents   │  │ │
│  │                 │      │  └──────────────────┘  │ │
│  └────────┬────────┘      └────────────┬───────────┘ │
│           │                            │             │
│           └────────────┬───────────────┘             │
│                        ▼                             │
│              ReviewIssue[] output                     │
│                        │                             │
│           ┌────────────▼───────────────┐             │
│           │  Validation → Dedup        │             │
│           └────────────────────────────┘             │
└──────────────────────────────────────────────────────┘
```

### 3.3 Built-in Subagents

| Agent | Model | Purpose | Tools |
|-------|-------|---------|-------|
| `dependency-tracer` | sonnet | Cross-file coupling, circular deps, import chains | trace_imports, find_usages |
| `breaking-change-detector` | sonnet | API changes, export removals, signature modifications | git_diff_analysis, analyze_exports, find_interface_changes |
| `security-analyzer` | sonnet | Injections, auth, secrets, crypto, path traversal | find_usages, trace_imports |
| `pattern-validator` | haiku | Codebase pattern consistency, code smells | Read, Grep, Glob only |

### 3.4 MCP Tools

| Tool | Purpose |
|------|---------|
| `find_usages` | ripgrep word-match symbol search |
| `trace_imports` | Extract import/export graph for a file |
| `git_diff_analysis` | Detailed git diff between refs |
| `analyze_exports` | Compare public exports across versions |
| `find_interface_changes` | TypeScript interface/type diff |
| `list_changed_files` | Changed files with A/M/D status |

---

## 4. Gap Analysis

### 4.1 Critical Issues

#### G1: Flat orchestration — no actual multi-agent delegation

The system prompt says "You are a code reviewer" and instructs the agent to output JSON. The `agents` object is passed to `query()` but the prompt never tells the coordinator to delegate work to subagents. The SDK automatically exposes an `Agent` tool when `agents` are defined, but the coordinator prompt doesn't mention it.

**Impact:** The 4 specialized agents never actually execute. The main agent does everything itself.

**Fix:** Rewrite the coordinator system prompt to instruct triage → delegate → synthesize. The SDK handles everything else.

#### G2: Budget enforcement is a no-op

`maxBudgetUsd` is configured (default $10) but never checked. No `abortController` is created. No cost is read from the message stream.

**Impact:** A stuck agent loop could burn unlimited tokens.

**Fix:** Create an `AbortController`, monitor `SDKAssistantMessage.message.usage` and `SDKTaskProgressMessage.usage` in the stream, call `abort()` when `total_cost_usd` approaches limit.

#### G3: Token tracking disconnected

The agentic executor doesn't report token usage back to `SessionContext`. The `SDKResultSuccess` contains `total_cost_usd`, `usage`, and `modelUsage` but none of it is captured. Agentic runs show as $0.00 in reports.

**Impact:** No cost visibility. No comparison between file-by-file and agentic costs.

**Fix:** Read `SDKResultSuccess.total_cost_usd` and `modelUsage`, feed into `SessionContext.addStageTokenStats()`.

#### G4: 3 of 6 MCP tools missing from `allowedTools`

`allowedTools` includes `find_usages`, `git_diff_analysis`, `list_changed_files`. Missing: `trace_imports`, `analyze_exports`, `find_interface_changes`.

**Impact:** The dependency-tracer and breaking-change-detector subagents reference tools they can't call.

**Fix:** Add the 3 missing tool names. One line.

#### G5: `allowDangerouslySkipPermissions` not set

The code passes `permissionMode: 'bypassPermissions'` but doesn't set `allowDangerouslySkipPermissions: true`. The SDK requires both — without the flag, permission bypass may silently fail or throw.

**Fix:** Add `allowDangerouslySkipPermissions: true` to the options.

#### G6: Structured output not used

Issues are extracted via regex (`/```json...```/`). The SDK supports `outputFormat: { type: 'json_schema', schema }` which forces JSON and returns parsed output in `structured_output`.

**Fix:** Define a JSON schema for the issues array, pass as `outputFormat`, read from `structured_output`.

### 4.2 Robustness Issues

| ID | Issue | Impact |
|----|-------|--------|
| G7 | No tests — zero coverage for agentic module | Can't refactor safely |
| G8 | No error recovery — failure at turn 80 loses all findings | Wasted budget |
| G9 | No progress feedback — just debug logs | Blind CI runs |

### 4.3 Missing Features

| ID | Feature | Value |
|----|---------|-------|
| G10 | No per-subagent metrics (all attributed to job) | Can't optimize cost per agent |
| G11 | No smart agent activation (all agents run always) | Wasted budget on irrelevant agents |
| G12 | No agent chaining (subagents can't feed each other) | Misses compound insights |

---

## 5. Proposed Architecture (v0.3.0)

### 5.1 Coordinator-Delegates Pattern (SDK-Native)

The SDK already implements multi-agent orchestration. When you pass `agents` to `query()`, the SDK:

1. Exposes an `Agent` tool to the main conversation
2. When the coordinator calls `Agent(name="security-analyzer", prompt="Review these files...")`, the SDK spawns a new Claude conversation with that agent's system prompt, tools, and model
3. The subagent runs autonomously — making tool calls, reading files, exploring
4. The subagent's final output flows back to the coordinator as the tool result
5. The coordinator synthesizes all subagent outputs into the final answer

**We don't need to build any of this.** We need to write the right coordinator prompt.

```
                         ┌───────────────────┐
                         │    Coordinator     │
                         │    (sonnet/opus)   │
                         │                    │
                         │  1. Read diffs     │
                         │  2. Triage files   │
                         │  3. Delegate       │──── SDK Agent tool
                         │  4. Synthesize     │
                         └────────┬──────────┘
                                  │
              ┌───────────────────┼───────────────────┐
              │                   │                   │
    ┌─────────▼────────┐ ┌───────▼────────┐ ┌────────▼───────┐
    │ dependency-tracer │ │ security-      │ │ pattern-       │
    │ (sonnet)          │ │ analyzer       │ │ validator      │
    │                   │ │ (sonnet)       │ │ (haiku)        │
    │ Tools:            │ │ Tools:         │ │ Tools:         │
    │ · trace_imports   │ │ · find_usages  │ │ · Read         │
    │ · find_usages     │ │ · trace_imports│ │ · Grep         │
    │ · Read, Grep      │ │ · Read, Grep   │ │ · Glob         │
    └─────────┬─────────┘ └───────┬────────┘ └────────┬───────┘
              │                   │                   │
              └───────────────────┼───────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  Coordinator synthesizes:  │
                    │  · Merge findings          │
                    │  · Resolve overlaps        │
                    │  · Rank by severity        │
                    │  · Output structured JSON  │
                    └───────────────────────────┘
                                  │
                    ┌─────────────▼─────────────┐
                    │  QualOps post-processing:  │
                    │  · Validation pass         │
                    │  · Deduplication pass       │
                    │  · Report generation       │
                    └───────────────────────────┘
```

### 5.2 The Coordinator Prompt

This is the most important change. The current prompt is a generic "review code, output JSON." The new prompt makes the agent an **orchestrator**:

```markdown
You are a code review coordinator. Your job is to analyze changed files and
delegate specialized analysis to subagents.

## Available Subagents

You have access to specialized agents via the Agent tool. Each agent has
deep expertise in a specific domain:

{dynamically list enabled subagents with descriptions}

## Process

1. **Analyze the diffs** — understand what changed and categorize the changes
2. **Decide which agents are relevant** — don't invoke agents that have nothing
   to review (e.g., skip security-analyzer for pure CSS changes)
3. **Delegate** — invoke each relevant agent via the Agent tool. Include:
   - The specific files they should focus on
   - The diffs/context for those files
   - Any cross-cutting concerns they should watch for
4. **Synthesize** — collect all agent findings, remove duplicates, resolve
   conflicts (if agents disagree), and rank by severity/impact

## Rules

- Only invoke agents that are relevant to the changes
- Each agent returns issues as JSON — pass their output through as-is
- If agents find conflicting issues, keep the higher-confidence one
- Your final output must be a JSON array of all issues
- Do NOT add your own issues — only report what subagents found
- If no agents are relevant (trivial change), return []
```

### 5.3 Budget Enforcement via AbortController

```typescript
const abortController = new AbortController();
let accumulatedCost = 0;

const result = query({
  prompt: userPrompt,
  options: {
    abortController,
    // ...
  },
});

for await (const message of result) {
  // Track cost from assistant messages
  if (message.type === 'assistant' && message.message?.usage) {
    const usage = message.message.usage;
    accumulatedCost += estimateCostFromUsage(usage);
  }

  // Track cost from subagent progress
  if (message.type === 'system' && message.subtype === 'task_progress') {
    // SDK provides running totals
  }

  // Budget gate
  if (accumulatedCost >= this.config.maxBudgetUsd) {
    logger.warn(`[Agentic] Budget exhausted ($${accumulatedCost.toFixed(2)}/${this.config.maxBudgetUsd})`);
    abortController.abort();
    break; // Keep partial results
  }

  // ... process messages
}

// Final cost from SDK (source of truth)
if (message.type === 'result' && message.subtype === 'success') {
  accumulatedCost = message.total_cost_usd; // overwrite estimate with real
}
```

### 5.4 Structured Output (No More Regex)

```typescript
const issueSchema = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['security', 'bug', 'performance', 'maintainability'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          description: { type: 'string' },
          location: { type: 'string' },
          reasoning: { type: 'string' },
          suggestion: { type: 'string' },
          confidence: { type: 'number', minimum: 1, maximum: 10 },
        },
        required: ['type', 'severity', 'description', 'location', 'confidence'],
      },
    },
  },
  required: ['issues'],
};

const result = query({
  prompt: userPrompt,
  options: {
    outputFormat: { type: 'json_schema', schema: issueSchema },
    // ...
  },
});

// In result handler:
if (message.type === 'result' && message.subtype === 'success') {
  const output = message.structured_output as { issues: RawIssue[] };
  // No regex. No parsing. Guaranteed valid JSON.
}
```

### 5.5 Per-Subagent Metrics via Task Messages

```typescript
const subagentMetrics: Record<string, SubagentMetric> = {};

for await (const message of result) {
  if (message.type === 'system' && message.subtype === 'task_started') {
    subagentMetrics[message.task_id] = { startTime: Date.now() };
  }

  if (message.type === 'system' && message.subtype === 'task_notification') {
    const metric = subagentMetrics[message.task_id];
    if (metric) {
      metric.status = message.status;          // 'completed' | 'failed'
      metric.summary = message.summary;         // subagent's output
      metric.totalTokens = message.usage?.total_tokens;
      metric.toolUses = message.usage?.tool_uses;
      metric.durationMs = message.usage?.duration_ms;
    }
  }
}
```

### 5.6 Token Tracking → SessionContext

```typescript
// After query completes
if (resultMessage.subtype === 'success') {
  const { total_cost_usd, modelUsage, num_turns, duration_ms } = resultMessage;

  // Aggregate into SessionContext
  let totalInput = 0, totalOutput = 0, totalCached = 0;
  for (const [model, usage] of Object.entries(modelUsage)) {
    totalInput += usage.inputTokens;
    totalOutput += usage.outputTokens;
    totalCached += usage.cacheReadInputTokens;
  }

  SessionContext.getInstance().addStageTokenStats(
    'review-agentic',
    num_turns,
    totalInput,
    totalOutput,
    totalCached,
    total_cost_usd,
  );
}
```

---

## 6. Implementation Plan

### Phase 1: Make It Actually Work (v0.3.0-alpha)

Everything in Phase 1 is about properly using SDK capabilities that already exist.

| # | Task | What Changes | Effort |
|---|------|-------------|--------|
| 1.1 | Add 3 missing MCP tools to `allowedTools` | 1 line in `agentic-executor.ts` | 5 min |
| 1.2 | Add `allowDangerouslySkipPermissions: true` | 1 line in `agentic-executor.ts` | 5 min |
| 1.3 | Rewrite coordinator system prompt | `buildSystemPrompt()` method | 2 hrs |
| 1.4 | Add `outputFormat` with JSON schema | Options + result reading | 1 hr |
| 1.5 | Read `SDKResultSuccess` metrics into `SessionContext` | Message stream handler | 2 hrs |
| 1.6 | Implement `AbortController` budget enforcement | Message stream + abort logic | 2 hrs |
| 1.7 | Capture `SDKTaskNotificationMessage` for per-subagent results | Message stream handler | 2 hrs |
| 1.8 | Preserve partial results on abort/failure | Collect issues incrementally | 1 hr |

**Total: ~10 hours of work. No new dependencies. No new abstractions.**

### Phase 2: Robustness (v0.3.0-beta)

| # | Task | Effort |
|---|------|--------|
| 2.1 | Unit tests for `AgenticExecutor` (mock `query()` stream) | 4 hrs |
| 2.2 | Unit tests for MCP tools | 3 hrs |
| 2.3 | Unit tests for `AgentLoader` | 2 hrs |
| 2.4 | Integration test: real agent run on fixture codebase | 4 hrs |
| 2.5 | Progress reporting via `SDKTaskProgressMessage` | 2 hrs |
| 2.6 | Per-subagent metrics in HTML/JSON reports | 3 hrs |
| 2.7 | Agent transcript saving to session dir | 2 hrs |

### Phase 3: Intelligence (v0.3.0)

| # | Task | Effort |
|---|------|--------|
| 3.1 | Smart triage in coordinator prompt (already free — it's just prompt engineering) | 1 hr |
| 3.2 | Per-subagent `maxTurns` enforcement (SDK supports it natively) | 30 min |
| 3.3 | Custom agent `mcpServers` support (SDK supports per-agent MCP) | 2 hrs |
| 3.4 | `disallowedTools` per subagent (SDK supports it natively) | 30 min |
| 3.5 | Agent result caching via extract log | 4 hrs |

### Phase 4: Ecosystem (v0.4.0+)

| # | Task | Effort |
|---|------|--------|
| 4.1 | `qualops agent init` CLI — scaffold custom agent markdown | 2 hrs |
| 4.2 | Agent chaining via coordinator prompt engineering | 4 hrs |
| 4.3 | User-defined MCP servers in config | 4 hrs |
| 4.4 | Agentic fix stage (agent generates fixes with full context) | Large |
| 4.5 | Agent sharing/marketplace (curated `.qualops/agents/` collections) | Large |

---

## 7. Configuration

### Current (v0.2.0)

```json
{
  "name": "security-audit",
  "mode": "agentic",
  "agentic": {
    "maxTurns": 20,
    "maxBudgetUsd": 5.0,
    "enabledSubagents": ["security-analyzer", "dependency-tracer"],
    "systemPrompt": "Focus on OWASP Top 10"
  }
}
```

### v0.3.0 (Minimal Config Changes)

The config shape stays mostly the same. The big changes are internal (how we use the SDK).

```json
{
  "name": "security-audit",
  "mode": "agentic",
  "agentic": {
    "maxTurns": 50,
    "maxBudgetUsd": 3.0,
    "model": "sonnet",
    "enabledSubagents": ["security-analyzer", "dependency-tracer"],
    "systemPrompt": "Focus on OWASP Top 10",
    "contextMode": "auto",
    "maxTokensPerFile": 8000,
    "maxTotalTokens": 50000
  }
}
```

New fields:
- `model` — coordinator model (subagent models come from their definitions)

### v0.4.0+ (Extended)

```json
{
  "name": "full-review",
  "mode": "agentic",
  "agentic": {
    "maxBudgetUsd": 5.0,
    "model": "sonnet",
    "enabledSubagents": ["security-analyzer", "dependency-tracer", "pattern-validator"],
    "customAgents": [
      {
        "name": "rxjs-migration",
        "agentFile": "rxjs-migration.md"
      }
    ],
    "customMcpServers": {
      "my-linter": { "command": "npx", "args": ["my-mcp-linter"] }
    }
  }
}
```

---

## 8. Cost Model

### Per-Review Estimates

| Scenario | Agents Active | Est. Cost | vs File-by-File |
|----------|--------------|-----------|-----------------|
| Small PR (5 files, diffs) | 1-2 | $0.10–0.25 | 2-5x more |
| Medium PR (20 files) | 2-3 | $0.30–0.80 | 5-10x more |
| Large PR (50+ files) | 3-4 | $1.00–2.50 | 10-20x more |
| Deep security audit | all | $1.50–3.00 | 15-30x more |

### Why It's Worth It

File-by-file reviews **cannot detect**:
- Circular dependency introduced by a new import
- Breaking change where a renamed export is used in 12 other files
- Security issue where user input flows through 3 files before hitting `eval()`
- Pattern violation only visible by comparing with 5 similar files

Agentic mode catches these because subagents can explore the codebase, trace dependencies, and cross-reference.

### Cost Controls

| Control | Mechanism | Savings |
|---------|-----------|---------|
| Budget cap | `AbortController` abort at threshold | Hard limit |
| Smart triage | Coordinator skips irrelevant agents | ~50-80% on small PRs |
| Haiku for pattern-validator | Cheap model for simple pattern matching | ~10x per agent |
| Diff-only context | `contextMode: "diff"` reduces prompt size | ~60% input tokens |
| Per-subagent `maxTurns` | Prevent individual agent loops | Bounds worst case |
| Extract log caching | Skip unchanged files across runs | Variable |

---

## 9. Success Criteria

### v0.3.0 Release Gate

- [ ] Coordinator delegates to subagents (verified: `task_started` + `task_notification` messages in logs)
- [ ] Budget enforcement aborts at configured limit (test: set $0.10 budget, verify abort)
- [ ] `total_cost_usd` and `modelUsage` appear in session reports
- [ ] All 6 MCP tools callable (verified: subagent tool call logs)
- [ ] Structured output — no regex JSON parsing
- [ ] Partial results preserved on abort/error
- [ ] Unit test coverage > 80% for agentic module
- [ ] 1+ integration test with real agent run

### Quality Metrics (ongoing)

- False positive rate < 15%
- Cross-file issue detection ≥ 1 per 20-file PR (when applicable)
- Cost per actionable issue < $0.50
- Agent completion rate > 95%

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Agent loops (repetitive tool calls) | Medium | High | Budget enforcement + per-agent `maxTurns` |
| SDK breaking changes (v0.2.x → v1.0) | Medium | Medium | Pin exact version, integration tests, watch changelog |
| Subagent prompt quality (false positives) | Medium | Medium | Validation pass + confidence thresholds + prompt iteration |
| Cost perception ("too expensive for CI") | High | Medium | Smart triage, diff-only, clear cost reporting, budget defaults |
| Coordinator doesn't delegate (ignores Agent tool) | Low | High | Explicit prompt engineering, integration test verification |
| Agent hallucinating file paths | Medium | Low | Post-validation checks (file exists, line in range) |

---

## 11. Open Questions

1. **Default budget?** Current: $10. Proposal: $3. Most PR reviews cost < $1.

2. **Coordinator model?** Sonnet is the sweet spot (smart enough to triage, cheap enough for CI). Opus for high-stakes audits.

3. **Should the coordinator add its own findings?** Current proposal says no — only relay subagent findings. But the coordinator sees the full picture. Maybe allow a "coordinator pass" for cross-cutting observations.

4. **Agentic fix stage?** An agent that generates fixes with full codebase context would be powerful. Defer to v0.4.0.

5. **Raw transcripts?** Save full agent conversation to session dir for debugging? Proposal: yes, opt-in via `reporting.includeTranscript`.

---

## Appendix A: File Map

```
src/stages/review/agentic/
├── agentic-executor.ts      # Main orchestrator (query() loop)
├── index.ts                 # Public exports
├── types.ts                 # AgenticReviewContext, SubagentResult, etc.
├── loaders/
│   ├── agent-loader.ts      # Custom agent loading (markdown + inline)
│   └── index.ts
├── subagents/
│   ├── definitions.ts       # 4 built-in subagent prompts + tools
│   └── index.ts
└── tools/
    └── index.ts             # MCP server with 6 code analysis tools

examples/agents/
├── rxjs-migration.md        # Example custom agent
└── angular-signals.md       # Example custom agent
```

## Appendix B: SDK Surface Used

```
@anthropic-ai/claude-agent-sdk@0.2.75

Imports:
  query()                  — Agent execution loop (async generator)
  tool()                   — Define typed MCP tool with Zod schema
  createSdkMcpServer()     — Create in-process MCP server

Types consumed from SDK:
  AgentDefinition          — Subagent definition shape
  SDKMessage               — Union of all message types
  SDKResultSuccess         — Final result with cost/usage/structured_output
  SDKAssistantMessage      — Per-turn message with BetaMessage.usage
  SDKTaskNotificationMessage — Subagent completion event
  SDKTaskProgressMessage   — Subagent progress event
  ModelUsage               — Per-model token/cost breakdown

Options used:
  agents                   — Named subagent definitions
  allowedTools             — Auto-approved tool list
  mcpServers               — MCP server registration
  maxTurns                 — Turn limit
  permissionMode           — 'bypassPermissions' for CI
  allowDangerouslySkipPermissions — Required for bypass
  abortController          — Budget enforcement / graceful stop
  outputFormat             — JSON schema for structured output
  cwd                      — Working directory
```

## Appendix C: What We Don't Need to Build

Things the SDK handles that we'd otherwise have to implement:

| Capability | SDK Provides | If We Built It |
|-----------|-------------|----------------|
| Agent tool-calling loop | `query()` async generator | 200+ lines of API calls + retry logic |
| Subagent spawning + lifecycle | `agents` option + Agent tool | Custom process management, context isolation |
| MCP tool serving | `createSdkMcpServer()` | Standalone MCP server process + stdio transport |
| Permission management | `permissionMode` + `canUseTool` | Custom permission system |
| Abort/cancel | `AbortController` support | Signal propagation through async chains |
| Structured output | `outputFormat` + `structured_output` | JSON parsing + validation + retry on malformed |
| Cost tracking | `total_cost_usd` + `modelUsage` | Manual token counting + pricing tables |
| Progress events | `SDKTaskProgressMessage` | Custom event system |
| Model routing per agent | `model` in `AgentDefinition` | Multi-provider routing logic |

**Estimated savings: 1000+ lines of framework code we don't have to write or maintain.**
