# Spec — Contracts (types & validation)

**Status:** Approved — EggAI, 2026-07-08 · The single source of truth for shared data shapes. **Zod schemas are authoritative; TypeScript types are inferred** (`z.infer`) — never hand-written in parallel. Every shape below lives in `contracts/` and is imported by all layers; the four divergent `Finding` shapes, two severity vocabularies, and duplicate `FixSuggestion`/`FileDiff`/`ReportSummary`/`ExtractLog`/`RootCauseTaxonomy`/`QualOpsResult` in today's code collapse into these ([`architecture.md`](architecture.md) §6). Rule: **one definition per concept**; if a shape exists here, no module may redefine it.

## 1. Vocabularies (canonical, single)

- **Severity:** `critical | high | medium | low`. *(Replaces the second vocabulary `critical | error | warning | info` in the deleted `issue.model.ts`.)*
- **Category:** `bug | security | performance | maintainability`.
- **Confidence:** integer **1–10**. ⚠ Correction (F-18): one scale everywhere; the legacy 1–100 validation/clamp path is removed.

## 2. `Finding`

The unit of review feedback (today's `ReviewIssue`/`ReviewIssueItem`/`RawAgentIssue`, unified):

```
Finding {
  id: string
  file: string
  category: Category
  severity: Severity
  confidence: 1..10
  location: string            // "line:N" or "path:N"; parsed by kernel/location
  description: string
  suggestion?: string
  context?: string
  reasoning?: string
  // enrichment (single-pass; F-20 preserves the model's effort estimate)
  priority: number
  estimatedEffort?: string
  tags?: string[]
  fingerprint?: string        // RESERVED — a later functional phase populates and
                              // uses this for identity/dedup; this baseline does not
}
```

Parsing note: the model boundary (`llm/boundary`) accepts loose model output (enum aliases, coercions) and normalizes into this strict shape before any domain sees it. `location` is parsed by the single `kernel/location` helper (F-14: correct on paths containing digits).

## 3. Other shared shapes

- **`FixSuggestion`** — `{ issueId, filePath, originalCode, suggestedCode, confidence: high|medium|low, breaking: boolean }`. (Unifies the type + the report-local copy + `SearchReplaceFixSchema`.)
- **Stage metadata** — `AnalysisMetadata`, `ReviewMetadata`, `FixMetadata`, `ReportMetadata`, `JudgeMetadata` (shapes per [`behavior/pipeline/`](behavior/pipeline/README.md)), each carrying `schemaVersion`.
- **Config** — types inferred from the config schema (`contracts/config`); see [`behavior/configuration/`](behavior/configuration/config-file.md).
- **`RejectReason`, gate thresholds, token usage/stats, report summary** — one definition each.
- **Forge result** — one `PublishInput`/`QualOpsResult` in `contracts`, consumed by `forges/core` (kills the github/gitlab duplicate).

## 4. Ports (interfaces)

Declared in `contracts/ports`, implemented in `llm/backend` ([`architecture.md`](architecture.md) §3):

- **`CompletionPort`** — `complete(spec): Promise<Result>`; schema-constrained or text.
- **`AgentRunPort`** — `run(spec): Promise<AgentRunResult>`; `AgentRunResult` includes a `trajectory` (every tool call) and `usage`.
- **`ToolDefinition`** — the shape QualOps-owned tools are defined against.

## 5. Validation rules

- Validate at every boundary with these schemas: model output (only in `llm/boundary`), config load, tool I/O, forge payloads.
- Schemas use `strictObject` and `readonly` where applicable; a schema owns its own `.describe()`/`.meta()` documentation.
- **Drift tests** are colocated with the schemas: they pin enum values, ID formats, and any field the pipeline maps by position, so a schema change that breaks a downstream contract fails CI (prevents the class of prompt↔schema drift in F-21/F-22).
