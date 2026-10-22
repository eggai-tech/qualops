# Spec — AI providers, dialects & cost

**Status:** Approved — EggAI, 2026-07-08 · Domain: integrations · Overview: [README.md](README.md)

## Providers

Five provider kinds: `anthropic`, `bedrock`, `openai`, `github` (GitHub Models), `openai-compatible`. Selection is per stage from `ai.<stage>` config; provider instances are cached per `{provider}-{stage}`. Each requires `model`, `inputPerMillion`, `outputPerMillion`; SDK clients are constructed lazily. Custom/self-hosted endpoints are reached via `openai-compatible` with a `baseUrl` (key optional). Zero-config resolution and defaults: [`../configuration/config-file.md`](../configuration/config-file.md).

## Dialects (structured-output routing)

The **dialect** is a property of the *model* (not the provider), detected from a bundled capability catalog (a filtered litellm snapshot) plus provider rules. The full dialect contract — the four dialects, the selection flow, the prose pipeline, and the invariants — is specified in [`../pipeline/review-dialects.md`](../pipeline/review-dialects.md).

Array-rooted schemas are wrapped as `{ items: [...] }` and transparently unwrapped (providers require an object root). Model output always passes through the JSON-recovery + Zod-validation boundary; a failure throws a typed `StructuredOutputError`.
- ⚠ Post-refactor: the two JSON-recovery ladders merge into one `llm/boundary`, and loose→strict normalization is one path (`concept/03` §4). Behavior (what parses) is preserved; the code is unified.

## Cost & retries

Token usage is accumulated per run with per-provider cache-token semantics; cost is computed from the configured per-million prices and per-provider cache multipliers. Missing usage falls back to a character-based estimate.
- ⚠ Correction (F-24): transient-error retry is consistent across providers (today Anthropic retries 3×, OpenAI-compatible 0×, Bedrock relies on the AWS default). The shared retry policy lives in `kernel/retry` — [`../../quality/dependencies.md`](../../quality/dependencies.md) and [`../../architecture.md`](../../architecture.md) §6.
