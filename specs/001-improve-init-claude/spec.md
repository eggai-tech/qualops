# Feature Specification: Improve init-claude Command

**Feature Branch**: `001-improve-init-claude`
**Created**: 2026-03-18
**Status**: Draft
**Input**: Improve the init-claude command to drive a consistent user experience for onboarding a new project with QualOps. Currently the command produces inconsistent configurations and often creates invalid config files because the schema is not used for validation.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent Guided Setup (Priority: P1)

A developer runs the init-claude command for the first time in their project. They are guided through a structured series of questions about their review needs — review focus area, language/framework, CI platform, and severity preferences. Regardless of how many times they run the command with the same answers, they receive the same configuration output.

**Why this priority**: This is the core problem — inconsistent outputs undermine trust in the tool and waste developer time fixing generated configs.

**Independent Test**: Can be fully tested by running the init command multiple times with identical answers and comparing the generated configuration files. Delivers a reliable, repeatable onboarding experience.

**Acceptance Scenarios**:

1. **Given** a project with no existing QualOps configuration, **When** a developer runs init-claude and selects "security" focus, "TypeScript" language, "GitHub Actions" CI, and "critical+high" severity, **Then** the generated configuration matches an expected baseline for that combination of choices.
2. **Given** the same project and same answers, **When** a developer runs init-claude a second time, **Then** the generated configuration is identical to the first run.
3. **Given** a project with no existing QualOps configuration, **When** a developer runs init-claude and selects "quality" focus and "Python" language, **Then** the generated configuration differs from the security/TypeScript configuration in the expected ways (different prompts, different review passes) but follows the same structural pattern.

---

### User Story 2 - Schema-Validated Configuration (Priority: P1)

After the setup process generates a configuration file, the system automatically validates it against the QualOps config schema. If the configuration is invalid, the user is told exactly what is wrong and the invalid file is not written to disk.

**Why this priority**: Invalid configs cause runtime failures that are harder to diagnose than a clear validation error at setup time. This is equally critical to consistency.

**Independent Test**: Can be tested by attempting to generate configs with known-invalid combinations and verifying that validation catches the errors before the file is saved.

**Acceptance Scenarios**:

1. **Given** the setup process has assembled a configuration, **When** the configuration is structurally valid per the schema, **Then** the file is written to `.qualops/.qualopsrc.json` and the user sees a success message.
2. **Given** the setup process has assembled a configuration, **When** the configuration violates the schema (e.g., missing required `ai.reviewStage`), **Then** the file is not written, and the user sees a clear error message identifying the specific validation failure.
3. **Given** a generated configuration, **When** it contains deprecated-only fields without the required non-deprecated equivalents, **Then** validation catches this and reports the issue.

---

### User Story 3 - Existing Configuration Detection (Priority: P2)

A developer runs the init-claude command in a project that already has a QualOps configuration. The system detects the existing configuration and asks whether to overwrite, merge, or abort.

**Why this priority**: Protects developers from accidentally losing a working configuration. Important but secondary to getting the core setup right.

**Independent Test**: Can be tested by running init-claude in a project with an existing `.qualopsrc.json` and verifying the user is prompted before any changes.

**Acceptance Scenarios**:

1. **Given** a project with an existing `.qualops/.qualopsrc.json`, **When** a developer runs init-claude, **Then** the system informs the user that a configuration already exists and asks how to proceed.
2. **Given** an existing configuration and the user chooses to abort, **When** the command exits, **Then** the original configuration file is unchanged.
3. **Given** an existing configuration and the user chooses to overwrite, **When** the setup completes, **Then** the new configuration replaces the old one and passes schema validation.

---

### User Story 4 - Prompt File Generation (Priority: P3)

After generating the main configuration, the system also creates the appropriate prompt files referenced by the configuration in `.qualops/prompts/`. The prompts are tailored to the selected review focus area.

**Why this priority**: Without matching prompt files, the generated configuration will fail at runtime. However, this can initially be handled by including default prompts and improving them later.

**Independent Test**: Can be tested by running init-claude, then verifying that every prompt file referenced in the generated `.qualopsrc.json` exists and contains non-empty content.

**Acceptance Scenarios**:

1. **Given** the setup process generates a configuration referencing prompt files, **When** the setup completes, **Then** every prompt file path referenced in the config exists under `.qualops/prompts/`.
2. **Given** a "security" focus selection, **When** prompt files are generated, **Then** the prompts contain security-relevant review instructions appropriate for the selected language/framework.

---

### Edge Cases

- What happens when the user cancels the setup partway through (e.g., Ctrl+C)? No partial config should be written.
- What happens when the `.qualops/` directory exists but is not writable? The command should report a clear permission error.
- What happens when the config schema file cannot be located in the installed package? The command should fail with a clear error rather than silently skipping validation.
- What happens when a user selects a combination that results in no review passes (e.g., no focus area selected)? The system should require at least one review focus.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The init-claude command MUST guide the user through a fixed, deterministic sequence of setup questions.
- **FR-002**: The system MUST produce identical configuration output for identical user inputs across multiple runs.
- **FR-003**: The system MUST validate all generated configuration files against the QualOps config schema before writing them to disk.
- **FR-004**: The system MUST NOT write an invalid configuration file; validation errors MUST be reported to the user with specific details about what failed.
- **FR-005**: The system MUST detect existing QualOps configuration files and prompt the user before overwriting.
- **FR-006**: The system MUST generate all prompt files referenced by the configuration so the setup is immediately runnable.
- **FR-007**: The system MUST only include non-deprecated configuration fields in generated configs.
- **FR-008**: The setup questions MUST cover: review focus area (security, performance, quality, migration), primary language/framework, CI platform preference (GitHub Actions, GitLab CI, none), and severity threshold.
- **FR-009**: The system MUST create the required directory structure (`.qualops/`, `.qualops/prompts/`) if it does not exist.
- **FR-010**: The system MUST NOT leave partial files on disk if the setup is interrupted or fails.

### Key Entities

- **Setup Profile**: A combination of user choices (review focus, language, CI platform, severity threshold) that deterministically maps to a configuration template.
- **Configuration Template**: A pre-defined configuration structure for a given setup profile, with variable slots filled by user inputs.
- **Prompt Template**: A review prompt file tailored to a specific review focus area and language/framework combination.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Running init-claude 10 times with identical inputs produces 10 identical configuration files (100% reproducibility).
- **SC-002**: 100% of generated configuration files pass schema validation without errors.
- **SC-003**: A new user can go from zero configuration to a working QualOps review in under 5 minutes using only the init-claude guided setup.
- **SC-004**: Every generated configuration is immediately runnable — all referenced prompt files exist and all required fields are populated.

## Assumptions

- The config schema (`qualops-config.schema.json`) is the source of truth for valid configuration structure and is bundled with the package.
- The current set of four setup questions (focus area, language, CI platform, severity) is sufficient for initial onboarding. Additional customization can be done by editing the generated files afterward.
- Deprecated fields in the schema should not appear in newly generated configurations; they exist only for backward compatibility with hand-edited configs.
- The command continues to operate within the Claude Code environment (creating a `/qualops-setup` command), but the generated command file must drive a deterministic setup flow rather than leaving question selection to the AI.
