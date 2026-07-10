# 11 — Configurable-Agent Backbone (Proposal)

**Status:** Concept-stage proposal (2026-07-10) — **exploratory, challenges parts of [08-harness-decision.md](08-harness-decision.md) (D12)**; nothing here is decided. Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Evidence: measured on 2026-07-10 against `@eggai/configurable-agent` branch `chore/deps-refactor-2026-07` (spec 014 of that repo) and the QualOps working tree; unverified items in §14.
**Conflict-of-interest note:** `@eggai/configurable-agent` is a same-org (EggAI) package, and this document was drafted from that repo's side. The measured facts stand on their own; the decision belongs to the human reviewers, exactly as in 08 §3.

## 1. Thesis

QualOps' differentiators are the deterministic pipeline (Intake destructuring, fingerprints, filters, Verifier orchestration, Admission, Gate, Publish) and its evals — not the LLM plumbing. Yet ~4–6 kLoC of `src/` is exactly that plumbing: five provider clients, three parallel agent-loop adapters, a hand-rolled template engine, a JSON-repair layer, cost math, and capability sniffing.

This proposal makes **`@eggai/configurable-agent` the single execution backend behind the ports** (`AgentRunPort`, and — with one new API, §6 CA-R3 — `CompletionPort`), and turns the LLM side of QualOps into **configuration compilation**: a reviewer folder (04's `config.yaml` + `reviewers/*.md` + `REVIEW.md`) compiles into an `AgentConfig` per run; the runtime executes it. QualOps stays the compiler, the pipeline, and the publisher; configurable-agent becomes the transport.

```
.qualops/ folder (04)            QualOps (owns)                    configurable-agent (runtime)
config.yaml ─┐                   Intake → change-units,            runAgent(agentConfig, messages,
reviewers/*.md ├─ compile ──►    context packs (02 §3.1)   ──►     emit, signal, { tools, model })
REVIEW.md ─┘                     Filter/Verify/Admit/Gate          — loop, provider, compaction,
rules/                           Publish, Learn, evals             structured output, trajectory
```

This is **not** "QualOps becomes a YAML file". Per D13/D14, most Generate calls are single-shot completions over deterministic context packs, and every deterministic stage stays QualOps code. The honest framing: *one backend replaces the planned thin AI SDK adapter (08 §4.1) plus the three existing agent adapters plus the five provider clients*, and the reviewer-folder config gains a 1:1 compiled runtime form.

## 2. What changed since 08's fact sheet — and what did not

08 measured configurable-agent on 2026-07-07 and retired it for four recorded reasons (08 §3). Re-measured 2026-07-10 on the current branch (release pending):

| 08's recorded blocker | Status 2026-07-10 | Evidence |
|---|---|---|
| "pinned to AI SDK v5 — two majors behind" | **Fixed.** AI SDK **v7.0.19**; the loop is now *one* `streamText` call using the SDK's own `stopWhen`/`prepareStep`/`Output.object`/`totalUsage` primitives — configurable-agent no longer hand-rolls the loop 08 worried about owning | configurable-agent spec 014; `src/agent/loop.ts` |
| "258 packages / 285 MB because the service ships with the library slice" | **Reduced, root-caused, fixable.** Now **162** unique prod packages (lockfile-measured; `gpt-tokenizer` −55 MB, `msw`/`shell-quote`/`vite` removed). Of the 162, **144 come from one service-only dep** (`@opentelemetry/auto-instrumentations-node`); a split lib package (§6 CA-R2) lands at **~20–40** — the AI SDK baseline plus pino/handlebars/yaml/ajv | measured via `pnpm ls --prod --depth Infinity`, per-dep transitive counts |
| "OTel emission through `/lib` unverified" | **Verified.** Telemetry via `@ai-sdk/otel` `registerTelemetry`; gen-ai spans per call; trace-correlated JSON logs (`trace_id`/`span_id` mixin); content recording opt-out (`OTEL_RECORD_CONTENT=0`) | configurable-agent spec 014 §Observability |
| "no declared license; no `repository` field — compliance blocker" | **Still true. Hard prerequisite** (§6 CA-R1). Trivial to fix, but 08's standard is *measured on the published artifact* — this proposal is void until a release ships with license + repository + provenance | `package.json` inspected 2026-07-10 |

Also new since 2026-07-07 (relevant capabilities): native structured output on the tool loop (no second formatting call; schema-validated), human-in-the-loop tool approval with a stateless resume contract (`run_paused`), PII-hardened error/log/span surfaces, compaction that actually fires on tool-loop histories, graceful shutdown, and a machine-readable one-shot CLI mode. Three Dependabot alerts against 0.2.1's OTel subtree (QualOps `REFACTOR-FINDINGS.md` F) are resolved by the OTel v2 upgrade — again, pending release.

**What did NOT change:** bus factor and maturity. Same-org package, few releases, no external adoption signal. 08's *actual* decider — "the team will not take on harness maintenance in a TypeScript codebase" — is a judgment call this document cannot measure away; §8 argues it, honestly, but does not pretend the argument is new facts.

## 3. Where this sits relative to the decided architecture

This proposal deliberately **keeps** the concept set's load-bearing decisions and must be read as *composing with* them, not replacing them:

| Decided | Kept? | How |
|---|---|---|
| Ports own the boundary; backends are swappable (03 §4a, D12) | ✅ | configurable-agent is *an adapter behind* `AgentRunPort`/`CompletionPort`, proven by the same port conformance suite the AI SDK adapter must pass. Swapping back remains cheap by construction. |
| "Tools are QualOps-owned, always" (D12) | ✅ | Tools are injected per run via `runAgent(…, { tools })` — the exact mechanism the existing `configurable-agent-adapter.ts` uses today. configurable-agent's *own* MCP-server config stays empty in QualOps runs; the sandboxed bash tool, skipPatterns, and tool policy remain QualOps code. (User-configured MCP context sources per 09 #83 can later map onto the runtime's MCP support — under the same D12 allowlist constraints — but that is not part of this proposal.) |
| "A harness is a transport, never a parser" (03 §4a) | ✅ with nuance | configurable-agent validates structured output against the run's JSON Schema (transport-level: "did the model produce the requested shape"). The **LLM boundary still owns semantic parsing**: Finding normalization, confidence filtering, RejectReason mapping. What QualOps deletes is the JSON *repair* layer (fence extraction, control-char re-escaping, array-root wrapping), not the boundary. |
| Trajectory is part of the contract (03 §4a) | ✅ | The `AgentEvent` stream (`tool_call`, `tool_result` envelopes with args/duration/status, `reasoning`, `content_delta`, `final` with usage, typed `error` codes) maps 1:1 onto the port's trajectory. §6 CA-R7 makes that mapping a versioned compatibility promise. |
| Single-shot Generate default; agent-mode = escalation tier (D13/D14) | ✅ | Checklist-mode reviewers → single structured completion (§6 CA-R3). Agent-mode reviewers → `runAgent` with the QualOps ToolSet. The pipeline shape is untouched. |
| No hosted infrastructure (01 §2) | ✅ | Execution shapes used: **library** (`/lib` `runAgent`, primary — in-process, in the user's CI) and optionally the **one-shot CLI** (`configurable-agent run`, stdin → JSON record, TRACEPARENT propagation) for process isolation. The K8s HTTP/SSE **service shape is explicitly out of scope** — it exists for other EggAI products and never enters a QualOps install path once the package split (CA-R2) lands. |

What it **changes**: 08 §4.4 ("retire `@eggai/configurable-agent`"), 03 §7's drop list, and 06 P2's retirement step. One backend adapter still lands in P2 — this proposal changes *which* one, not the port, the suite, or the schedule.

## 4. The config story: reviewer folder → compiled AgentConfig

04's UX ("your review team is a folder") stays exactly as specified — users never see configurable-agent YAML. What changes is what QualOps does with the folder: instead of feeding hand-built provider clients and prompt templating, it **compiles** each run:

| Reviewer folder (04) | Compiled `AgentConfig` |
|---|---|
| `reviewers/<name>.md` body + `REVIEW.md` + rules | `systemPrompt` (Handlebars — replaces QualOps' hand-rolled 120-line template engine; same `{{var}}` surface plus `{{#if}}`/`{{#each}}` for free) |
| context pack, tier, profile values | `promptVars` |
| frontmatter `model:` + `config.yaml` provider defaults | `model.{provider,name,baseUrl,temperature,maxOutputTokens}` |
| mode `agent` budgets (`maxTurns`) | `agent.maxSteps` |
| compaction/output-trim policy (today hardcoded in the adapter — TDR 0004) | `safety.compaction`, `safety.toolOutput` — **finally user-surfaceable** |
| Finding contract (02 §2) | `output.schema` (JSON Schema; validated at compile time) |
| — (QualOps-owned, injected at run time) | tools, model instance override, abort signal |

The compiler is small, deterministic, and testable: folder in → `AgentConfig` out → snapshot evals. Prompt governance (02 §5) applies to the folder, its compiled form is auditable in the context ledger (02 §11).

## 5. What QualOps deletes, what it keeps

Measured against the current working tree (`refactor/structure-cleanup`):

**Deleted / replaced (≈ 4.5–6 kLoC + 5 LLM deps):**
- `src/ai/providers/` (~2,080 LoC): five provider clients, dialect routing, the 2,101-model litellm capability snapshot + its update script (largely; see CA-R8 for the prose-dialect remainder), token/cost plumbing → provider abstraction moves to the runtime (AI SDK first-party providers).
- Two of three agent adapters + their SDKs: `@anthropic-ai/claude-agent-sdk` (proprietary, 281 MB binary — its optional-adapter question in 08 §4.5 becomes moot for the default path), `@openai/agents` (pre-1.0). Also `@anthropic-ai/sdk`, `openai`, `@aws-sdk/client-bedrock-runtime` as direct deps (Bedrock: CA-R9).
- `src/ai/shared/structured/` JSON-repair layer (fence extraction, control-char fallback, `$schema` stripping) — absorbed by schema-native structured output.
- `loaders/template-engine.ts` (hand-rolled Handlebars-lite).
- The duplicated ÷3.5 / ÷4 token estimators; loop-level context management.
- Most of `src/observability/`'s span-IO hand-wiring (the runtime emits gen-ai spans + a trajectory; Langfuse attribute mapping shrinks to an exporter concern).

**Kept (the actual product):** Intake destructuring, fingerprints, filters, Verifier orchestration, Admission, Gate, Publish (GitHub/GitLab integrations are already decoupled — they read `review-summary.json`), evals, the prompt/folder loader, and — emphatically — the **sandboxed bash tool + tool policy (~2,700 LoC)**, injected per run.

**Fewer moving parts, same contract:** today the *same* QualOps ToolSet is wrapped three different ways (SDK-MCP server / `@openai/agents` `tool()` / AI SDK ToolSet) for three loops with three error taxonomies. After: one wrapping, one loop, one event taxonomy — the one the `configurable-agent-adapter` already speaks in production.

## 6. Required configurable-agent features (prerequisites)

Per the ground rule of this proposal, changes to configurable-agent are in scope. Ordered blockers first; each is verifiable on a published release before QualOps commits:

| ID | Requirement | Status / note |
|---|---|---|
| **CA-R1** | **Declared license (Apache-2.0 or equivalent), `repository` field, LICENSE in tarball, provenance-verifiable publish** | Open. 08 called this a compliance blocker; it is. Trivial mechanically, needs an EggAI licensing decision. |
| **CA-R2** | **Package split**: `@eggai/configurable-agent` core = `/lib` (runAgent, config schema, events, providers) with *no* hono/`sdk-node`/`auto-instrumentations-node`; the K8s service becomes a separate package/artifact. Target: core ≤ ~40 transitive packages, zero native binaries | Open. Measured basis: 144 of 162 current prod packages come from `auto-instrumentations-node` alone; hono adds 2. OTel *emission* stays (via `@opentelemetry/api` + `@ai-sdk/otel`, both slim); only the SDK/exporter bootstrap is service-side. |
| **CA-R3** | **Single-shot structured completion API** (`complete(config, messages, {schema}) → {output, usage}`) sharing the model/provider/telemetry config with `runAgent` | Open. Needed so checklist-mode Generate, Verify, dedup, fix-gen, and root-cause calls (the D13 majority) go through the same backend instead of keeping `src/ai/providers/` alive. Thin: the runtime already holds everything but the entry point. |
| **CA-R4** | **Enforced budgets**: max tool calls per run; optional USD budget with caller-injected pricing (`$ /Mtok`), aborting the loop with a typed error when exceeded | Open. TDR 0004 accepted `maxBudgetUsd` but never enforced it; 08 §4.2 planned it as a port wrapper — enforcing it *inside* the loop (where the next step can be withheld) is strictly better. |
| **CA-R5** | **Config layering**: `AgentConfig` base + per-run partial override (deep-merge with validation) so the compiler emits a base per reviewer and a small per-change-unit delta | Open. Ergonomics; QualOps currently rebuilds the full config per run. |
| **CA-R6** | **Tool lifecycle**: a per-run `dispose()` hook for injected ToolSets (the bash session needs setup/teardown) and per-tool-call metadata in `tool_result` events (already carries `duration_ms`/`args`/`status`) | Partially open. Injection exists and is production-proven; dispose is caller-side `finally` today — acceptable, but a first-class hook removes a footgun. |
| **CA-R7** | **Versioned event/error contract**: the `AgentEvent` union and error codes (`tool_call_on_final_step`, `rate_limit_tokens`, `max_tokens_reached`, `structured_output_failed`, `stream_error`, `agent_failed`) + `partialContent` become a documented compatibility surface (semver-relevant), so the port trajectory mapping and hard/soft-fail classification cannot silently drift | Open. The codes exist and QualOps already pattern-matches them; what's missing is the *promise*. |
| **CA-R8** | **Dialect degradation** (TDR 0003): a defined behavior for models without reliable `json_schema` support — either a capability probe (the runtime already has an active model probe) with a typed `unstructured_dialect` outcome QualOps can route to its prose pipeline, or documented pass-through of provider errors | Open. Without this, QualOps keeps the litellm capability snapshot for routing only. |
| **CA-R9** | **Bedrock provider** (`@ai-sdk/amazon-bedrock`) — QualOps supports Bedrock today; the runtime does not | Open. First-party AI SDK provider; additive. |
| **CA-R10** | **Node floor reconciliation**: runtime engines are `>=22.12`; the QualOps action pins Node 20 (`action.yml`) | Open — but note 08 §6 recorded "no Node-24 constraint" as an AI-SDK-choice benefit; Node 22 LTS is a smaller ask than the purista harness' 24.15, and the action controls its own runtime. Decide: bump action to Node 22 (likely fine — GitHub-hosted runners ship it) or lower the runtime floor. |
| **CA-R11** | **Modular tool packs / stacked options**: batteries (e.g. a Playwright MCP pack) ship as separate opt-in packages, never in core — see §7 | Open. Design requirement, not just packaging: keeps CA-R2's slim core honest as the runtime grows batteries for other use cases. |
| **CA-R12** | **Configurable subagents**: named agent configs referenced as tools of a parent run (per-subagent model/tools/prompt; parent sees a `toModelOutput` summary) — the AI SDK v7 native subagent pattern, exposed as configuration | Open (~1 wk, generic). Only needed if per-reviewer subagent teams should be folder-defined rather than code-defined; QualOps currently flattens personas into the prompt on this path. |

## 7. Modularity: tool packs and stacked options (CA-R11 design)

There is a standing idea that configurable-agent should *ship with* useful MCP tools (Playwright browser automation, filesystem, git, …). Batteries-included and the slim core of CA-R2 are in direct tension — a bundled Playwright pack alone would re-add browser binaries and a large dependency subtree to every consumer, recreating exactly the footprint 08 penalized. The resolution is a **stacked, opt-in package architecture**:

- **`configurable-agent-core`** — `runAgent`/`complete`, config schema, events, safety policies. Providers become **optional peers** (`@ai-sdk/anthropic`, `@ai-sdk/openai`, …, installed per-provider — the pattern 08 praised in the purista adapters), putting the core near the AI SDK's own ~20-package baseline.
- **`configurable-agent-service`** — Hono server + OTel Node-SDK bootstrap + Docker. This split alone removes 144 of the 162 currently-measured packages from every library consumer.
- **`configurable-agent-tools-<name>` packs** — each exports a ready ToolSet/MCP wiring **plus** a declared security profile (network egress, fs write, subprocess spawn), **plus** default approval rules (e.g. Playwright navigation gated via `safety.approval` out of the box), **plus** a config-schema fragment. Core resolves `toolPacks: [playwright]` only when the package is installed; unknown pack names are hard errors (same philosophy as 04's unknown-key rule). Docker ships `slim` and `-full` variants.

Security consequence: supply-chain review happens per pack, not per monolith; the default install carries zero pack code. **QualOps installs zero packs** — its sandboxed bash tool and tool policy stay QualOps-owned and injected per D12 — which doubles as the proof that packs are genuinely optional.

## 8. Supply-chain math (projected, to be re-measured on release)

Today QualOps ships `@anthropic-ai/sdk` + `openai` + `@aws-sdk/client-bedrock-runtime` + `@anthropic-ai/claude-agent-sdk` (109 pkgs / 281 MB incl. the proprietary binary) + `@openai/agents` (102 pkgs) + `@eggai/configurable-agent@0.2.1` (258 pkgs as measured by 08). The 08 plan replaces all of that with `ai` + 4 providers (20 pkgs / 27 MB). This proposal replaces it with **configurable-agent-core** = the same `ai` + providers + {zod, pino, handlebars, yaml, ajv, `@opentelemetry/api`, `@ai-sdk/otel`, `@ai-sdk/mcp`} ≈ **~35–45 packages, zero native binaries, all permissive** (projected from the measured per-dep transitive counts; must be re-measured on the published core package per 08's standard). Delta vs the 08 plan: ~+20 packages; in exchange QualOps deletes the loop-adjacent code it would otherwise own (08 §4.2's wrappers, the template engine, the repair layer, provider clients) and stops carrying three SDKs.

## 9. The maintenance-ownership question, argued honestly

08's decider was not technical: *"the team will not take on harness maintenance in a TypeScript codebase that has little leverage for a primarily-Python organization."* Three things are genuinely different for configurable-agent vs. the rejected `@purista/harness`-as-company-package — and one thing is not:

1. **The loop is no longer owned.** Post-v7-refactor, configurable-agent's "harness" is ~1.9 kLoC total, of which the loop is a *single* `streamText` call on the SDK's own multi-step primitives (`stopWhen`, `prepareStep`, `Output.object`, `totalUsage`). The 15M-downloads/week community carries the loop, the provider matrix, and the churn — 08's central argument for the AI SDK **transfers through**, because configurable-agent now is what 08 §4.2 planned to write anyway (config + policy wrappers over the AI SDK), just maintained once for the org instead of once per product.
2. **It is not QualOps-only maintenance.** configurable-agent is a shipped EggAI product with its own deployments, specs (001–014), tests, and consumers; QualOps would be a consumer, not the sponsor. That is the "company leverage" the ADR found missing for a QualOps-embedded TS harness. (Counter-argument, stated plainly: shared ownership can also mean *diluted* ownership; an SLA/CODEOWNERS agreement between the teams should be a graduation condition.)
3. **The integration is already maintained.** QualOps carries a production `configurable-agent-adapter.ts` today. The marginal new maintenance is the compiler (§4) — code QualOps would write against *any* backend — minus the two adapters and five clients it deletes.
4. **Unchanged:** bus factor, release history, external adoption ≈ zero. If the org's answer to "will we staff this package across teams?" is no, 08's decision stands and this document should be rejected on the same grounds — a smaller better package does not by itself reopen a maintenance-ownership decision (08 is explicit about that).

## 10. Migration sketch (fits 06 P2 unchanged in shape)

1. **Gate zero:** configurable-agent release with CA-R1 (license/provenance) + CA-R2 (core split) shipped and re-measured. No release, no further steps.
2. **P2 step (replaces "AI SDK adapter" with "configurable-agent adapter"):** implement `AgentRunPort` over `runAgent`; pass the port conformance suite (trajectory, budgets, typed termination). Delete `anthropic-adapter`/`openai-adapter` + their SDKs once parity is shown on the eval scoreboard (05: paired before/after, McNemar).
3. **CA-R3 lands → `CompletionPort` over `complete()`;** migrate checklist Generate/Verify/dedup/fix calls; delete `src/ai/providers/` and the repair layer. Prose dialect routes per CA-R8.
4. **Config compiler** (§4): reviewer folder → AgentConfig; surface compaction/tool-trim policy in `config.yaml`; delete the template engine.
5. Each step independently shippable with paired eval results, per 06's rule; the port keeps the AI-SDK-direct adapter one conformance suite away as the standing fallback.

## 11. Accuracy & feature risk assessment

Most of the pipeline carries **zero regression risk by construction**: prompts, context packs, intake, filters, validation/dedup prompt content, the Finding contract, and the openai-compatible agentic path (already on configurable-agent in production) are unchanged. The risk is concentrated in exactly two migrations, both eval-measurable:

| Risk | What changes | Direction | Mitigation |
|---|---|---|---|
| **Anthropic agentic path** | Claude Agent SDK (Claude-Code-grade harness behavior) → plain AI-SDK loop via configurable-agent | Unknown; plausibly negative on Anthropic agentic reviews | Paired scoreboard evals (05 §7) gate the deletion; 08 §4.5's opt-in Claude-Agent-SDK adapter behind the port remains the documented fallback if parity fails |
| **Structured-output dialect** | Tolerant hand-rolled repair layer (recovers malformed JSON) → strict schema-native `Output.object` | Likely neutral-to-positive (the repair layer also masked garbage — QualOps CHANGELOG 0.2.7 documents silent-zero-findings bugs in that class), but tolerant→strict can shift recall on weaker models | Eval-gated; CA-R8 routes json_schema-less models to the prose pipeline instead of failing |

Feature direction is net-positive for the intended pipeline: compaction on long agentic runs and tool-output summarization for oversized grep/bash output are gains QualOps lacks today; the approval/`run_paused` flow maps onto future human-gated fix application; the typed event stream is the trajectory 05 §4 wants; the Verifier is naturally "one more compiled agent config with read-only tools." The generate-wide→verify→filter→publish shape is N configurable-agent invocations with different compiled configs — the backend fits the future behavior, not just the current one.

## 12. Effort estimate

Every configurable-agent item is a generic feature — nothing QualOps-specific enters the runtime; findings schemas, tools, prompts, pipeline stay QualOps-side. Estimates include specs, tests, docs (both repos run spec-first workflows).

**configurable-agent — ≈ 3–4 engineer-weeks:** CA-R1 0.5 d (+ licensing decision) · CA-R2 split 3–5 d · CA-R11 pack mechanism 3–5 d (+1–2 d per pack) · CA-R3 `complete()` 1–2 d · CA-R4 budgets 2–3 d · CA-R5 layering 1–2 d · CA-R6 lifecycle 1 d · CA-R7 contract versioning 1 d · CA-R8 dialect degradation 2–4 d · CA-R9 Bedrock 2–3 d · CA-R10 0.5 d.

**QualOps — ≈ 4–6 engineer-weeks (eval cycles dominate):** port formalization + conformance suite + adapter (extends the existing production adapter) 3–5 d · retire anthropic/openai adapters + parity evals 3–5 d · `CompletionPort` migration of file-review/validation/dedup/fix/root-cause call sites 5–8 d · delete providers/repair layer/template engine 3–5 d · config compiler + surfacing safety policy 3–5 d · observability rewiring (Langfuse over events/traces) 2–3 d · regression-triage buffer ~1 wk.

**Combined: ~2 months for one engineer; ~1 month with one engineer per repo** (independent until integration; the configurable-agent release is the hard gate and goes first).

## 13. Head-to-head: 08 baseline (AI SDK direct) vs. this proposal

Both options exit the Claude Agent SDK on the Anthropic agentic path and both move to strict schema-native structured output — **the accuracy risk profile of §11 is identical for A and B**; the same eval gate applies either way. They differ in glue ownership, features beyond the port, and timeline shape:

| Capability | A — AI SDK direct (08 §4) | B — configurable-agent backbone |
|---|---|---|
| Agent loop | SDK built-in; thin adapter **QualOps writes** | Same SDK loop; adapter **exists in production** |
| Providers (incl. Bedrock, openai-compatible) | `@ai-sdk/*` first-party — equal | Equal; Bedrock gated on CA-R9 |
| Structured output (repair layer deleted) | `Output.object` — equal | Equal (already wired) |
| Single-shot completions (D13 majority) | `generateText` direct | Gated on CA-R3 |
| Retry/backoff | SDK `maxRetries` — equal | Equal |
| Context compaction | **QualOps builds & owns** (08 §4.2 wrapper) | Built-in, config-surfaced |
| Tool-output summarization | **QualOps builds or loses it** | Built-in |
| USD/tool-call budgets | **QualOps builds & owns** (08 §4.2) | CA-R4 — enforced inside the loop (strictly better than a wrapper) |
| Prompt templating | Keep the hand-rolled engine | Handlebars built-in; engine deleted |
| Approval / pause-resume (future gated fixes) | Not planned | Built-in (`run_paused` contract) |
| Trajectory/event contract | QualOps defines from stream parts | Exists + CA-R7 versioning |
| OTel + trace-correlated logs | QualOps wires itself | Built-in; Langfuse = exporter config |
| Config artifact | Call params in code | Compiled `AgentConfig` — auditable, eval-replayable |
| Isolation shapes | In-process only | In-process or one-shot CLI subprocess |

| Dimension | A | B |
|---|---|---|
| Effort / timeline | **~4–5 wk, one repo, no external gate** | ~3–4 wk runtime + ~4–6 wk QualOps, release-gated; ~5–6 wk calendar with one engineer per repo |
| Dependencies | ~20 pkgs (floor) | ~35–45 pkgs core (projected); two-repo chain |
| Glue QualOps owns forever | ~600–900 LoC (adapter, compaction, budget, summarization, templating, telemetry) | ~200–300 LoC (the compiler); rest lives in the shared runtime |
| Blockers | none | CA-R1 (licensing decision), CA-R2, CA-R3, CA-R9 minimum |
| Org leverage | zero (QualOps-private glue) | shared runtime — **iff** the §9.4 ownership question gets a yes |
| Reversibility | baseline | one conformance-suite run back to A, by port design |

**Future-fit (the roadmap lens).** Split the intended additions by shape. *Pipeline-shaped* work — deterministic stages, filters, fan-out, orchestration — belongs in QualOps code under **both** options: TDR 0005's A/B showed orchestration-as-LLM-workflow loses (worse recall, ~4× cost), and the AI SDK's `WorkflowAgent` is bound to the Vercel Workflow runtime — wrong shape for a CI container whose file-mediated sessions already are a resumable workflow engine. Config-driven workflows in configurable-agent would be rebuilding Eve; explicitly out of scope. *Run-shaped* work — verifier runs, fix-proposal runs, escalation-tier runs, subagent teams — is where the options diverge: under A each new run kind is another call site (params, telemetry, budgets, error mapping); under B it is another compiled config on the same runtime, event contract, and eval harness. Concretely: the Verifier is "a config with read-only tools and a verdict schema"; human-gated fix application maps onto the shipped `run_paused`/stateless-resume contract (pause state serializes into messages → stash in the check run → a PR comment resumes it — under A this protocol is built by hand from `toolApproval` primitives); subagents are a native AI SDK pattern in both, but folder-defined subagent teams need CA-R12. The decision therefore compresses to: **will the run zoo grow?** If yes, run-definitions-as-data (B) compounds; if it stays at reviewer+verifier, A suffices and B remains one adapter away.

**Break-even, stated plainly:** B wins when a second product consumes configurable-agent or when approval/compaction/summarization become product requirements; A wins if QualOps stays the only consumer. Because both sit behind the same port, choosing A now re-prices B as "one adapter later" rather than killing it.

## 14. Unverified / open items (do not treat as facts)

Published-artifact numbers for the core package (all §8 figures are projections from the source tree) · configurable-agent under QualOps' concurrency profile (10s–100s of parallel runs in one process — the runtime is built for it in serve mode, but not measured from `/lib`) · prompt-caching control (Anthropic cache TTLs) through the runtime · whether the Handlebars surface covers all template-engine call sites (comparison operators in `{{#if}}`) · Bedrock parity (CA-R9) including auth modes QualOps users rely on · the eval-scoreboard parity claim in §10.2 (must be measured, not asserted) · GitHub Models endpoint behavior via `openai-compatible`.

## 15. Revisit / rejection triggers

Adopt only if: CA-R1+CA-R2 ship and re-measure clean · the port conformance suite passes · eval parity holds on the scoreboard · the cross-team ownership question (§9.4) gets an explicit yes. Reject/park if any fails — and note 08's own revisit list already contains the standing alternative (Eve at GA) and the fallback (AI SDK direct) that this proposal keeps one suite-run away.
