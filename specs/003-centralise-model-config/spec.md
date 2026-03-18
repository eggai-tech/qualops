# Feature Specification: Provider/Model Configuration Centralisation

**Feature Branch**: `003-centralise-model-config`
**Created**: 2026-03-18
**Status**: Draft
**Input**: User description: "Rework the configuration so that provider & model config is defined centrally, and workflows/agents refer to the config. Reduce duplication and risk of conflicting information (e.g., wrong token costs being logged)."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Define models once, reference everywhere (Priority: P1)

As a QualOps user, I want to define my provider and model configurations in a single central place so that every stage (review, fix, judge) and every pipeline job references the same definition by name, eliminating duplication and the risk of inconsistent cost or temperature settings.

**Why this priority**: This is the core value of the feature. Today, the same provider/model/cost block is copy-pasted across `reviewStage`, `fixStage`, and `judgeStage`. A typo in one stage (e.g., wrong `inputPerMillion`) silently produces incorrect cost reports. Centralising removes this entire class of error.

**Independent Test**: Can be fully tested by creating a configuration with a named model definition and verifying that all stages resolve to the correct provider, model, and cost settings when referenced by name.

**Acceptance Scenarios**:

1. **Given** a configuration with a named model entry (e.g., `"claude-sonnet"`) that specifies provider, model ID, and token costs, **When** `reviewStage`, `fixStage`, and `judgeStage` each reference `"claude-sonnet"` by name, **Then** every stage uses the same provider, model, and cost values without any duplication in the config file.
2. **Given** a user updates the token cost on a named model entry, **When** any stage that references that model runs, **Then** it picks up the updated cost automatically without the user needing to change any stage config.
3. **Given** a named model entry with a temperature setting, **When** a stage references that model and also specifies its own temperature override, **Then** the stage-level override takes precedence over the model-level default.

---

### User Story 2 - Pre-defined model cost defaults (Priority: P2)

As a QualOps user, I want the system to ship with sensible default cost data for well-known models so that I only need to specify the provider and model name, and the correct token pricing is filled in automatically.

**Why this priority**: Most users use well-known models (Claude Sonnet, GPT-4o, etc.) whose pricing is publicly available. Requiring users to look up and manually enter `inputPerMillion` and `outputPerMillion` is tedious, error-prone, and a common source of mistakes. Defaults remove this burden for the majority of use cases.

**Independent Test**: Can be tested by creating a config that references a well-known model without specifying costs, and verifying that the system applies correct default pricing.

**Acceptance Scenarios**:

1. **Given** a named model entry that specifies a provider and a well-known model identifier but omits cost fields, **When** the configuration is loaded, **Then** the system applies the known default costs for that model.
2. **Given** a named model entry that specifies a known model but explicitly overrides `inputPerMillion`, **When** the configuration is loaded, **Then** the user-provided cost takes precedence over the default.
3. **Given** a named model entry that specifies an unknown or custom model without cost fields, **When** the configuration is loaded, **Then** the system warns the user that costs are missing and cost tracking will be inaccurate.

---

### User Story 3 - Backward-compatible configuration loading (Priority: P2)

As an existing QualOps user, I want my current inline stage configurations to continue working so that I can migrate to the centralised format at my own pace.

**Why this priority**: Breaking existing configurations on upgrade would create friction and block adoption. Supporting both the old inline format and the new reference-by-name format ensures a smooth migration path.

**Independent Test**: Can be tested by loading an existing `.qualopsrc.json` with inline `AIStageConfig` blocks and verifying the system behaves identically to before.

**Acceptance Scenarios**:

1. **Given** a configuration using the current inline format (provider, model, costs directly on each stage), **When** the system loads the config, **Then** it works exactly as before with no errors or warnings.
2. **Given** a configuration that mixes inline configs on some stages and model references on others, **When** the system loads the config, **Then** both formats resolve correctly within the same config file.

---

### User Story 4 - Agentic subagent model references (Priority: P3)

As a QualOps user configuring agentic reviews, I want custom agent definitions and built-in subagents to reference named model configurations so that I manage model choices centrally rather than scattering model tier names across agent definitions.

**Why this priority**: This extends centralisation to the agentic subsystem, which currently uses its own model tier references independently. While less critical than the stage-level duplication (fewer repetitions), it completes the centralisation story.

**Independent Test**: Can be tested by defining a custom agent that references a named model and verifying that the agent uses the correct provider and model settings.

**Acceptance Scenarios**:

1. **Given** a custom agent definition that references a named model entry instead of a model tier, **When** the agentic executor initialises the agent, **Then** it uses the provider and settings from the named model entry.
2. **Given** a custom agent definition that still uses the existing model tier format (`sonnet`, `opus`, `haiku`), **When** the agentic executor initialises the agent, **Then** it continues to work as before (backward compatibility).

---

### Edge Cases

- What happens when a stage references a model name that does not exist in the central definitions? The system must produce a clear validation error at config load time, not at runtime during a review.
- What happens when a named model entry has an unrecognised provider? The system must validate provider names against supported providers and produce a clear error.
- What happens when cost defaults are outdated (provider changed pricing)? Users can override defaults explicitly; the system should document when defaults were last updated.
- What happens when the same model name is defined more than once? The system must reject the config with a clear duplicate-name error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST support a top-level `models` section in the configuration where users define named model entries, each specifying at minimum a provider and model identifier.
- **FR-002**: Each named model entry MUST support the following optional fields: `inputPerMillion`, `outputPerMillion`, `temperature`, `maxTokens`.
- **FR-003**: Stage configurations (`reviewStage`, `fixStage`, `judgeStage`) MUST accept a string value that references a named model entry by name, as an alternative to the current inline object format.
- **FR-004**: When a stage references a named model, the system MUST resolve all model properties from the central definition, with stage-level overrides taking precedence for any fields specified at both levels.
- **FR-005**: System MUST ship with a built-in registry of default token costs for well-known models across all supported providers (Anthropic, OpenAI, AWS Bedrock, GitHub Models).
- **FR-006**: When a named model entry matches a known model but omits cost fields, the system MUST apply the built-in default costs automatically.
- **FR-007**: When a model is not recognised and costs are not provided, the system MUST log a warning indicating that cost tracking will be inaccurate for that model.
- **FR-008**: System MUST validate the complete resolved configuration at load time, producing clear error messages for: missing model references, duplicate model names, unsupported provider values, and missing required fields.
- **FR-009**: System MUST continue to accept the existing inline `AIStageConfig` format on all stages for full backward compatibility.
- **FR-010**: Custom agent definitions MUST support referencing named model entries as an alternative to the current model tier format.

### Key Entities

- **Named Model Entry**: A reusable model configuration identified by a user-chosen name. Contains provider, model identifier, and optional cost/parameter overrides. Referenced by stages and agents.
- **Model Defaults Registry**: A built-in lookup of known models and their default token costs. Used to auto-populate cost fields when users omit them.
- **Stage Model Reference**: A string value on a stage config that resolves to a named model entry, replacing the current inline object.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A configuration using centralised model references contains zero duplicated provider/model/cost blocks across stages, compared to the current format which requires one copy per stage.
- **SC-002**: Changing a model's cost configuration requires editing exactly one location in the config file, regardless of how many stages or agents use that model.
- **SC-003**: Users configuring well-known models can omit token cost fields entirely and still see accurate cost reporting in review output.
- **SC-004**: Existing configurations using the inline format continue to work without modification after the update.
- **SC-005**: Configuration validation catches 100% of invalid model references and produces actionable error messages before any AI operations begin.

## Assumptions

- The set of well-known model defaults will be maintained as a static registry within the codebase, updated with new releases. This is acceptable because model pricing changes are infrequent relative to release cycles.
- The `models` section uses a flat name-to-config mapping (not nested/hierarchical), keeping the configuration simple and predictable.
- Stage-level overrides (e.g., temperature) are uncommon but must be supported for flexibility.
- The existing model tier references in agentic subagent definitions (`sonnet`, `opus`, `haiku`) will remain supported as shorthand alongside the new named model references.
