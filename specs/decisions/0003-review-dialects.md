# Decision 0003 — Prose dialect for schema-less models

**Status:** Accepted — 2026-06-09 · **Normative spec:** [`../behavior/review-dialects.md`](../behavior/review-dialects.md)

## Context

Structured output (`response_format: json_schema`) is not universal: reasoning models often reject or corrupt it, and many locally-hosted/OpenAI-compatible endpoints do not implement it. The previous `json_object` fallback produced plausible-but-wrong or field-dropped output, effectively locking QualOps to a short list of frontier models. The capability check was also a fragile hard-coded model-name list.

## Decision

Add a second, parallel review pipeline that works without structured output (prose), routed by a single `isUnstructured()` query. Dialect is a property of the model, detected from a bundled litellm capability-catalog snapshot (not name matching). Unknown model → treated as unstructured (safe default). Full behavior: the normative spec.

## Alternatives considered

- **Keep the `json_object` fallback** — rejected: produced silent, semantically-wrong output for the models that matter.
- **Model-name pattern matching for capability** — rejected: names change and the same name can resolve to different weights; use a systematic catalog instead.
- **Route by provider type** — rejected: the same endpoint serves structured and unstructured models depending on the `model` parameter.

## Consequences

Two parallel pipelines sharing job config, filtering, concurrency, and observability; they differ only in output contract (typed issues vs. Markdown prose). Prose runs are not gateable and cannot be scored by the recall harness (which fails fast on an unstructured model rather than recording silent zero recall). The former `openai-json-object` path is retired.
