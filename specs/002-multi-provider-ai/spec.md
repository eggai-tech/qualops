# Feature Specification: Multi-Provider AI Support

**Feature Branch**: `002-multi-provider-ai`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Allow using any AI provider for all stages/agentic. Agentic mode requires Anthropic models, due to the implementation using the @anthropic-ai/claude-agent-sdk. We want to enable any model choice for all LLM usage, initially prioritising Anthropic, Azure/OpenAI, Amazon Bedrock, and future local models (LMStudio/OpenAI-compatible)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use Any Provider for Agentic Reviews (Priority: P1)

As a QualOps user, I want to run agentic code reviews using any supported AI provider (not just Anthropic), so that I am not locked into a single vendor and can choose the provider that best fits my cost, compliance, or performance requirements.

**Why this priority**: Agentic mode is the most advanced review capability, but it is currently the only mode locked to Anthropic. Unlocking provider choice here removes the primary vendor lock-in and is the core ask of this feature.

**Independent Test**: Can be fully tested by configuring an OpenAI or Bedrock model for the review stage's agentic mode, running an agentic review pipeline, and verifying that subagents execute, tools are invoked, and review issues are produced with the same structure as the Anthropic-based output.

**Acceptance Scenarios**:

1. **Given** a QualOps configuration with the review stage set to `mode: "agentic"` and provider set to `openai`, **When** I run a review pipeline, **Then** the agentic review completes successfully using the OpenAI model, subagents execute their analysis, and structured review issues are produced.
2. **Given** a QualOps configuration with the review stage set to `mode: "agentic"` and provider set to `bedrock`, **When** I run a review pipeline, **Then** the agentic review completes successfully using the Bedrock model with the same output format.
3. **Given** a QualOps configuration with an agentic review using a non-Anthropic provider, **When** custom subagents are loaded from `.qualops/agents/`, **Then** those subagents execute correctly with the chosen provider.

---

### User Story 2 - Consistent Provider Configuration Across All Stages (Priority: P2)

As a QualOps user, I want a unified configuration experience for choosing AI providers across all AI-powered stages (review, fix), so that I can set my preferred provider once or per-stage without dealing with inconsistent configuration patterns.

**Why this priority**: Users already configure providers for non-agentic stages; this story ensures the agentic mode respects the same configuration, giving users a seamless experience when switching providers.

**Independent Test**: Can be tested by configuring different providers for the review and fix stages, running the full pipeline, and verifying each stage uses its configured provider.

**Acceptance Scenarios**:

1. **Given** a QualOps configuration with `reviewStage.provider` set to `openai` and `fixStage.provider` set to `anthropic`, **When** I run the full pipeline, **Then** the review stage (including agentic mode) uses OpenAI and the fix stage uses Anthropic.
2. **Given** a QualOps configuration where only the review stage specifies a provider, **When** I run the pipeline, **Then** the fix stage falls back to the default provider without errors.

---

### User Story 3 - Use OpenAI-Compatible Local Models (Priority: P3)

As a QualOps user in a restricted environment, I want to use locally hosted models (e.g., LMStudio) that expose an OpenAI-compatible API, so that I can run code reviews without sending data to external services.

**Why this priority**: Local model support expands QualOps to privacy-sensitive or air-gapped environments. It builds on the OpenAI provider path, making it a natural extension once multi-provider support is in place.

**Independent Test**: Can be tested by starting a local LMStudio instance, configuring QualOps to use a custom OpenAI-compatible endpoint, running a file-by-file review, and verifying issues are returned.

**Acceptance Scenarios**:

1. **Given** a QualOps configuration with the provider set to `openai` and a custom base URL pointing to a local LMStudio instance, **When** I run a review, **Then** the review completes using the local model.
2. **Given** a local model endpoint that is unreachable, **When** I run a review, **Then** QualOps reports a clear connection error indicating the local endpoint could not be reached.

---

### Edge Cases

- What happens when a configured provider does not support tool use (required for agentic subagents)? The system should detect this and report an actionable error before attempting the review.
- What happens when a provider's model produces output that does not conform to the expected structured response format? The system should apply validation and retry or degrade gracefully.
- What happens when switching providers mid-pipeline (e.g., review uses OpenAI, fix uses Anthropic) and token tracking needs to reconcile different cost models? Token stats should be tracked and reported per-provider accurately.
- What happens when a local model endpoint is slow or times out? The system should respect configurable timeout settings and report meaningful errors.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support running agentic reviews with any configured AI provider, not only Anthropic.
- **FR-002**: System MUST support Anthropic, OpenAI, Amazon Bedrock, and GitHub Models as agentic-capable providers at launch.
- **FR-003**: System MUST allow configuring a custom base URL for OpenAI-compatible providers to enable local model usage (e.g., LMStudio).
- **FR-004**: System MUST use the same configuration pattern for provider selection in agentic mode as it does for file-by-file mode (via `reviewStage.provider` and `reviewStage.model`).
- **FR-005**: System MUST validate that a chosen provider/model supports tool use before starting an agentic review, and report a clear error if it does not.
- **FR-006**: System MUST preserve all existing agentic capabilities (subagents, custom agents, MCP tools) regardless of which provider is selected.
- **FR-007**: System MUST track token usage and costs per-provider accurately, even when different providers are used across stages.
- **FR-008**: System MUST support custom agent definitions (from `.qualops/agents/` markdown files) with any provider, not just Anthropic model references.
- **FR-009**: System MUST provide clear error messages when a provider is misconfigured, credentials are missing, or the provider endpoint is unreachable.

### Key Entities

- **AI Provider**: A service that provides LLM completions (Anthropic, OpenAI, Bedrock, GitHub Models, or OpenAI-compatible local). Each provider has credentials, endpoint configuration, model selection, and cost rates.
- **Agentic Executor**: The orchestrator that runs multi-agent code reviews. Currently tightly coupled to the Anthropic agent SDK; must be abstracted to work with any provider.
- **Subagent**: A specialized analysis agent (e.g., security-analyzer, dependency-tracer) that operates within the agentic review. Must function identically regardless of underlying provider.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can run agentic reviews with Anthropic, OpenAI, Bedrock, and GitHub Models providers, producing structurally identical output across all providers.
- **SC-002**: Users can configure a local OpenAI-compatible endpoint and successfully complete code reviews without any data leaving their network.
- **SC-003**: Switching providers requires only configuration changes (no code changes or custom setup by the user).
- **SC-004**: All existing agentic review tests pass when run against each supported provider.
- **SC-005**: Provider-specific errors (auth failures, unsupported features, timeouts) are reported with actionable messages that guide the user to resolution.

## Assumptions

- All target providers (OpenAI, Bedrock, GitHub Models) support tool/function calling, which is necessary for agentic subagent operation. If a specific model does not support tool use, the system will detect this and report an error rather than attempting degraded execution.
- The Vercel AI SDK (referenced in the feature description as "AI SDK") or an equivalent provider-agnostic SDK will be evaluated as the abstraction layer, but the choice of SDK is an implementation decision outside the scope of this specification.
- Local model quality may vary significantly; QualOps makes no guarantees about review quality when using local models, only that the pipeline executes correctly.
- Existing Anthropic-based agentic behavior is the reference baseline; other providers should produce structurally equivalent (not necessarily identical) review output.
