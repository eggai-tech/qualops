# Decision 0004 — Agent-loop backbone

**Status:** **Superseded** — 2026-07-08 · **Current decision:** [`../../concept/08-harness-decision.md`](../../concept/08-harness-decision.md)

## History

The original ADR 0004 (Accepted 2026-06-09) evaluated ways to drive an OpenAI-compatible agent loop without a provider-specific SDK — a hand-rolled loop vs. the Vercel AI SDK vs. `@purista/harness` vs. `@eggai/configurable-agent` — and **chose `@eggai/configurable-agent`**.

## Supersession

The harness-backbone decision ([`concept/08-harness-decision.md`](../../concept/08-harness-decision.md), 2026-07-08) revisited this with measured dependency/license facts and decided:

- **Backbone = the Vercel AI SDK**, behind an `AgentRunPort` ([`../architecture.md`](../architecture.md) §3).
- **No own harness**: the hand-rolled loop and adopting/forking `@purista/harness` are both rejected (maintenance ownership, not technical merit).
- `@openai/agents` and `@eggai/configurable-agent` are **retired**.

The `AgentRunPort` keeps the backbone swappable, so this reversal does not touch business logic.

## Context & options (historical record)

The full original options analysis (context asymmetry of a hand-rolled loop, context-window compaction needs, sequential tool dispatch, deterministic error codes) remains valid as the *reason a loop is needed*; only the chosen implementation changed. The original text is preserved in git history at `docs/tdr/0004-openai-compat-adapter-with-agent-loop.md`.
