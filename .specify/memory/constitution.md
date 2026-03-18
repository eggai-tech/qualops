<!--
  Sync Impact Report
  ==================
  Version change: 0.0.0 → 1.0.0 (initial ratification)
  Modified principles: N/A (initial version)
  Added sections:
    - Core Principles (5 principles)
    - Technology Constraints
    - Development Workflow
    - Governance
  Removed sections: N/A
  Templates requiring updates:
    - .specify/templates/plan-template.md — ✅ no updates needed (Constitution Check section is generic)
    - .specify/templates/spec-template.md — ✅ no updates needed (requirements/stories are principle-agnostic)
    - .specify/templates/tasks-template.md — ✅ no updates needed (phase structure is compatible)
  Follow-up TODOs: none
-->

# QualOps Constitution

## Core Principles

### I. Pipeline Architecture

All review functionality MUST be implemented as discrete, composable
pipeline stages (Analyze → Review → Fix → Report → Judge). Each stage:

- MUST accept well-defined input and produce well-defined output
- MUST be independently executable via CLI flags (`--stages`)
- MUST NOT depend on side effects from other stages at runtime
- MUST support both file-by-file and agentic execution modes
  where applicable

**Rationale**: Composable stages enable users to run partial pipelines,
swap individual stages, and reason about failures in isolation.

### II. Review Quality

AI-generated findings MUST be high-confidence and actionable. Every
review issue produced by the system:

- MUST include a confidence score; findings below the configured
  `minConfidence` threshold MUST be suppressed
- MUST reference specific file paths and line numbers
- MUST pass validation and deduplication resolvers before surfacing
- SHOULD include a concrete fix suggestion when confidence is
  sufficient

False positives erode trust. When in doubt, suppress the finding.

**Rationale**: A code review tool that produces noisy or vague output
trains users to ignore it, defeating its purpose entirely.

### III. CI/CD Integration

QualOps MUST operate as a first-class citizen in CI/CD pipelines.
This means:

- MUST exit with appropriate codes (0 = pass, non-zero = threshold
  breach) so CI gates can rely on it
- MUST support non-interactive, headless execution with all
  configuration via files and environment variables
- MUST post findings as GitHub/GitLab PR comments and check
  annotations when tokens are available
- MUST NOT require manual intervention during automated runs

**Rationale**: The primary deployment context is automated PR review
in CI. Any feature that breaks headless operation is a regression.

### IV. Extensibility

The system MUST be configurable without forking. Extension points:

- AI providers (Anthropic, AWS Bedrock, GitHub Models) MUST be
  swappable via configuration
- Review prompts MUST be overridable via user-supplied markdown files
- Agentic mode subagents MUST be selectively enabled/disabled
- Custom jobs with independent configurations MUST be supported
  via the `jobs` configuration key

New extension points SHOULD follow existing patterns (provider
interface, prompt loader, subagent registry).

**Rationale**: Different teams have different review needs. Forcing
a single review style or provider limits adoption.

### V. Security & Trust

A code review tool has privileged access to source code and CI
secrets. Therefore:

- MUST NOT log, persist, or transmit source code beyond what is
  sent to the configured AI provider for review
- MUST sanitize file paths and content before including in prompts
  to prevent prompt injection from reviewed code
- MUST handle API keys and tokens exclusively via environment
  variables; MUST NOT accept secrets as CLI arguments
- MUST NOT execute or eval reviewed code under any circumstances
- Security-related findings from the review MUST be surfaced with
  appropriate severity

**Rationale**: Users must trust that running QualOps on their code
does not introduce new attack surface.

## Technology Constraints

- **Language**: TypeScript (strict mode) targeting Node.js >= 18
- **Package manager**: npm with lockfile committed
- **Build**: TypeScript compiler (`tsc`); no additional bundler
  for the CLI/library output
- **AI SDK**: Anthropic SDK (`@anthropic-ai/sdk`) as primary;
  Claude Agent SDK for agentic mode
- **CI distribution**: GitHub Action (`action.yml`) and npm
  package (`@eggai/qualops`)
- **Configuration format**: JSON (`.qualopsrc.json`) with JSON
  Schema validation (`qualops-config-schema.json`)
- **License**: MIT — all dependencies MUST be MIT-compatible

## Development Workflow

- **Branching**: Feature branches off `main`; PRs required for
  all changes
- **Testing**: Tests MUST pass before merge. Integration tests
  that hit external APIs MUST be skippable via environment flags
  for offline development
- **Versioning**: Semantic versioning (MAJOR.MINOR.PATCH).
  Breaking config schema changes require a MAJOR bump.
  New stages, providers, or subagents require a MINOR bump
- **Releases**: Managed via release PRs with changelogs
- **Code style**: Enforced by project linting configuration;
  no manual style reviews needed

## Governance

This constitution supersedes ad-hoc practices. All PRs and design
decisions MUST be consistent with these principles. Specifically:

1. **Compliance verification**: Reviewers MUST check that new
   features respect Pipeline Architecture (Principle I) and do
   not introduce tight coupling between stages
2. **Complexity justification**: Any deviation from these
   principles MUST be documented in the PR description with
   rationale and a plan to converge back
3. **Amendment process**: Changes to this constitution require
   a dedicated PR with `constitution` label. The version MUST
   be incremented per semantic versioning:
   - MAJOR: Principle removal or incompatible redefinition
   - MINOR: New principle or materially expanded guidance
   - PATCH: Clarifications and wording fixes
4. **Review cadence**: Constitution SHOULD be reviewed quarterly
   to ensure it reflects actual project practices

**Version**: 1.0.0 | **Ratified**: 2026-03-18 | **Last Amended**: 2026-03-18
