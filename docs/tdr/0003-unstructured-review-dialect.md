# TDR 0003 — Unstructured review dialect

**Status:** Accepted — 2026-06-09

## Context

QualOps reviews code by asking a language model to produce a structured list of issues. Each
issue carries a file path, line numbers, severity, and a description — enough to drive
downstream stages (fix generation, quality gating, inline PR comments) without any ambiguity
about what was found and where.

This works because structured output constraints (`response_format: json_schema`) let the model
produce machine-readable JSON regardless of how it would otherwise phrase its response. The
model still does the reasoning; it just has to express the result in the expected shape.

The constraint is not universally available.

**Reasoning models** — OpenAI's o-series and similar models from other providers — restructure
their internal compute budget and often reject `json_schema` mode or produce malformed JSON
inside it. These models are architecturally different: they spend tokens on internal chain-of-
thought before replying, and the structured output constraint interferes with that process.
They are also, by many benchmarks, better at reasoning about code than the models they replace.

**Open-weights and locally-hosted models** — models served through Ollama, LM Studio, Groq, or
any other OpenAI-compatible endpoint — may not implement the `json_schema` response format at
all. Their operators implement the Chat Completions API surface but stop short of the
structured output extension, which requires model-side training to be useful.

In both cases, QualOps previously fell back to `json_object` mode: a looser hint that tells the
model to produce some JSON, with instructions in the prompt about the expected fields. In
practice this does not work for the models that matter here. A reasoning model given a JSON
prompt produces JSON that is structurally plausible but semantically incorrect; a local model
given the same prompt produces readable English inside a JSON string, or refuses the format
entirely, or silently drops fields. The result is either a parse failure or, worse, a review
that appears to succeed but contains no real findings.

Beyond mode support, the capability check that selected the mode was itself a fragile hard-coded
list of model name patterns. Every new model required a manual update. There was no authoritative
signal for whether a given model supported structured output — only pattern matching on a name.

The net effect was that QualOps was practically locked to a short list of approved frontier
models. Running it against a reasoning model or a locally-hosted model produced silent
failures or crashes. That was an unacceptable constraint as the model landscape has diversified.

## Decision

QualOps adds a second review pipeline that works without structured output: a prose pipeline.
When the configured model is detected as unable to produce JSON schema–constrained output,
QualOps routes the entire review through the prose pipeline instead. The output is a Markdown
report, not a `ReviewIssue[]` array.

The two pipelines are parallel and independent. They share the same job/pass configuration,
the same file filtering, the same concurrency model, and the same observability instrumentation.
What differs is the output contract: structured issues on one side, human-readable prose on the
other.

### Capability detection

The mode-selection question — "does this model support json_schema?" — cannot be answered
reliably by pattern matching on model names. Names change, new models appear frequently, and the
same name may resolve to different model weights depending on the provider. The answer needs to
come from a data source that tracks model capabilities systematically.

The [litellm project](https://github.com/BerriAI/litellm) maintains a machine-readable catalog
of LLM capabilities, including a `supports_response_schema` field for each chat model. This
catalog is updated regularly as new models are released and tested.

QualOps bundles a filtered snapshot of that catalog — reduced to the two booleans that matter:
whether a model supports response schema and whether it supports tool use. The snapshot is
committed to the repository so capability detection works offline and deterministically across
all environments. A maintenance script fetches the upstream catalog, diffs it against the
committed snapshot, and writes the update on `--write`; this is run before releases rather than
at runtime.

Model lookup uses three resolution strategies in order: exact name match, bare name match
(stripping a `provider/` prefix that some endpoints add), and suffix match (finding a catalog
entry whose key ends with the bare name). If the model is not found in the catalog, it is
treated as unstructured. This is the safe default: a model that actually supports JSON schema
will be miscategorised as prose and produce a less machine-processable result, but it will
produce a result. A model that does not support JSON schema and is miscategorised as structured
will produce broken output that silently fails review. Failing visibly is worse than degrading
gracefully.

The previous `openai-json-object` fallback is retired. Models that previously fell through to
that path now fall through to unstructured.

### Dialect as a model property, not a provider property

The unstructured capability is a property of the model, not of the provider. The same OpenAI
API endpoint can serve a structured model (`gpt-4o`) and an unstructured one (`o1-mini`)
depending on the `model` parameter. Routing decisions based on the provider type would be wrong.

The resolution is a single boolean query — `isUnstructured()` — on the AI provider object.
Internally this checks whether the detected dialect for the configured model is `unstructured`.
All routing in the pipeline asks this question and nothing more. There are no provider-type
checks or model-name checks in routing code.

### The prose pipeline

When the model is unstructured, the review runs in three sequential phases:

**Review.** Each file is reviewed independently. The model is given the file content with line
numbers and a diff of what changed. The system prompt is the same as in structured mode; a
brief format instruction is appended asking the model to describe each issue it finds (what,
where, why, how to fix) or state clearly that it found none. There is no attempt to parse the
output into fields — the entire response is the unit of work for this file.

**Validation.** Each file's response is sent back to the model for a second pass. The model is
asked to remove false positives and rewrite only the valid findings. If nothing valid remains,
it is told to reply with a fixed sentinel string. This mirrors the validation stage in the
structured pipeline but operates on prose rather than typed objects.

**Deduplication.** All non-empty file responses are sent together to the model in a single
call. The model is asked to consolidate any cross-file duplicate findings into one mention per
issue. The response is expected to preserve a per-file heading structure so the result can be
split back into per-file entries. If the model returns an undivided block, it is treated as a
whole-PR finding. This is a best-effort step; the cost of a missed deduplication is a repeated
finding in the report, not a broken pipeline.

The sentinel string used to signal "no issues" is shared across all three phases. This is
important: if validation and deduplication use different strings to check for empty results,
reviews that are genuinely empty will pass through as non-empty content, inflating the report.

The report written at the end of the run is a Markdown document. It records the model name,
pipeline mode, and timestamp in a header, then lists each file's findings under a heading. If
all findings are empty or sentinel, the report says "No issues found."

### Evals require structured output

The eval harness scores recall by comparing detected issues against expected findings using a
structured match: file path, line range, and semantic similarity of the description. This
comparison requires `ReviewIssue[]` objects. Prose output cannot be scored by the existing
scorer.

Rather than silently producing a zero-recall run when an unstructured model is configured for
evals — which would be indistinguishable from the model genuinely finding nothing — the harness
now detects the condition before the review starts and raises an error with the model name and
a suggestion of alternatives. A misconfigured eval that fails immediately is better than a
misconfigured eval that silently records zero recall and poisons the historical dataset.

## Alternatives considered

### Retain `json_object` mode as the fallback

Keep the existing `json_object` path and improve the prompt engineering to make it more
reliable. **Rejected.** The problem is not prompt engineering — it is that weaker models and
local models do not reliably produce structured output regardless of how the prompt is written.
The only difference between `json_schema` strict mode and prompt-based JSON instructions is
that the former is enforced by the model's constrained decoding layer. Without that enforcement,
the model can and does deviate. Improving the prompt buys marginal reliability at the cost of
complexity and fragility; it does not change the fundamental capability gap.

### Parse prose into `ReviewIssue[]`

Add a second model call after the prose review to extract structured issues from the prose
response. This would let the prose pipeline produce the same output type as the structured
pipeline and re-enable downstream stages. **Rejected.** The parsing step introduces a second
point of structured-output failure in the model that is least capable of producing structured
output. It also adds latency and cost to every file review. The right trade-off for the models
in this category is to accept a different (less machine-processable) output format rather than
forcing a structured extraction that may fail for the same reasons the original structured
review did.

### Runtime capability fetch

Query the litellm catalog or a provider capability endpoint at startup rather than bundling a
snapshot. **Rejected.** Adding a network dependency to the startup path makes QualOps fragile
in offline and air-gapped environments (CI runners without internet access, enterprise networks
with restricted egress). It also makes capability resolution non-deterministic: the same
configuration can behave differently if the upstream catalog changes between runs. A committed
snapshot that is refreshed intentionally before releases is the right trade-off for a tool that
runs in CI.

### Separate provider type for prose models

Introduce a distinct provider name (e.g. `prose` or `local`) that users configure explicitly
to opt into the prose pipeline. **Rejected.** This pushes a technical implementation detail
into the user-facing configuration surface. A user who installs Ollama and configures
`OPENAI_BASE_URL` should not have to know that Ollama models are "prose providers" — they just
want to point QualOps at their model. The capability should be detected automatically, the same
way a browser does not ask a user to configure their network speed before adapting video quality.

## Consequences

### For model coverage

Any model that speaks the OpenAI Chat Completions protocol and produces readable prose can now
be used with QualOps. The review output is less machine-processable — no severity scores in a
typed field, no structured line ranges — but the human-readable content is preserved and
delivered. For operators who want to use a local model for cost reasons, or a reasoning model
for quality reasons, this opens a path that was previously blocked.

### For downstream stages

The fix stage, judge stage, and inline PR comment stages all operate on structured issues.
When the prose pipeline runs, those stages receive an empty issue list and exit cleanly. Quality
gating on prose output is not implemented. This is a known limitation: the prose pipeline is
currently a one-way door from review to report, without the downstream automation that the
structured pipeline enables. Whether to add prose-aware versions of those stages is a separate
decision.

### For eval authors

Eval configurations that specify an unstructured model now fail immediately with an informative
error. Any eval that was previously silently producing zero recall because of structured parse
failures was already broken; the new behaviour makes the breakage visible.

### For model catalog maintenance

The bundled catalog snapshot drifts from the upstream source over time. A new model that
supports JSON schema will be treated as unstructured until the snapshot is refreshed. The
consequence is degraded (prose instead of structured) output for that model — not a failure.
The snapshot should be refreshed before releases; the maintenance script makes this a one-command
operation.
