---
description: Analyze a task in context — its parent epic, sibling tasks, and child subtasks — for consistency, completeness, and alignment.
handoffs:
  - label: Refine Task
    agent: bd-refine-task
    prompt: Refine the task based on the analysis findings
  - label: Create Subtasks
    agent: bd-create-subtask
    prompt: Create subtasks to fill gaps identified in the analysis
  - label: Analyze Parent Epic
    agent: bd-analyze-epic
    prompt: Analyze the parent epic for full-hierarchy consistency
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Perform a **read-only** contextual analysis of a task — examining it in relation to its parent epic, sibling tasks, and child subtasks. Identify misalignment, coverage gaps, quality issues, and structural problems. Output a structured report with actionable recommendations.

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any issues. Output a structured analysis report. Offer remediation suggestions that the user must approve.

## Execution Steps

### 1. Load Task Context

Determine the task ID from `$ARGUMENTS`. If not provided:
- Run `bd list --type=task --status=open` and present options
- Wait for user selection

Load the full context:
```bash
bd show [task-id]                    # Target task
bd show [parent-epic-id]             # Parent epic
bd children [parent-epic-id]         # Sibling tasks
bd children [task-id]                # Child subtasks
```

For each sibling task, load summary:
```bash
bd show [sibling-id]
```

For each subtask:
```bash
bd show [subtask-id]
```

Build internal model:
- **Target task**: full details, acceptance criteria, dependencies
- **Parent epic**: goals, scope, success criteria
- **Siblings**: titles, descriptions, acceptance criteria, priorities, dependencies
- **Subtasks**: titles, descriptions, done criteria, dependencies

### 2. Detection Passes

Run analysis in three scopes: **upward** (epic alignment), **lateral** (sibling consistency), and **downward** (subtask coverage). Limit to **40 findings total**.

#### Scope 1: Upward — Epic Alignment

| Check | What to Detect |
|-------|---------------|
| **Goal mapping** | Which epic goal(s) does this task serve? Is the mapping clear? |
| **Scope compliance** | Does the task stay within epic's in-scope boundaries? |
| **Priority coherence** | Is task priority consistent with epic priority? |
| **Success contribution** | Does completing this task contribute to measurable epic success criteria? |
| **Description alignment** | Do task actions align with epic goals, or has scope drifted? |

#### Scope 2: Lateral — Sibling Consistency

| Check | What to Detect |
|-------|---------------|
| **Granularity match** | Is this task similar in size/scope to sibling tasks? |
| **Overlap detection** | Does this task duplicate work in a sibling? |
| **Gap detection** | With siblings, is the epic's scope fully covered? |
| **Dependency completeness** | Are task-to-task dependencies correctly captured? |
| **Priority consistency** | Are priorities across siblings logically ordered? |
| **Terminology alignment** | Do siblings use consistent language for the same concepts? |
| **Parallel opportunities** | Could this task run in parallel with siblings that it currently depends on? |

#### Scope 3: Downward — Subtask Coverage

| Check | What to Detect |
|-------|---------------|
| **Criteria coverage** | Does every acceptance criterion have at least one subtask? |
| **Orphan subtasks** | Are there subtasks that don't map to any acceptance criterion? |
| **Subtask completeness** | Do subtasks have done criteria? Are they verifiable? |
| **Subtask sizing** | Are subtasks appropriately atomic (hours, not days)? |
| **Internal dependencies** | Are subtask dependencies correctly ordered? |
| **Subtask sufficiency** | If all subtasks completed, would ALL acceptance criteria be met? |

### 3. Description Quality Analysis

Evaluate the target task's content quality:

| Check | Criteria |
|-------|----------|
| **Action clarity** | Can a developer start immediately from the description? |
| **Acceptance criteria** | All criteria present, testable, and unambiguous? |
| **Technical context** | File paths, APIs, components referenced where relevant? |
| **Edge cases** | Failure modes and boundary conditions addressed? |
| **Vague language** | Any "should", "appropriate", "as needed" without definition? |
| **Completeness** | All sections filled, no TODO/TBD/??? markers? |

### 4. Severity Assignment

- **CRITICAL**: Task contradicts epic scope, circular dependency, acceptance criteria impossible to verify
- **HIGH**: Missing acceptance criteria, duplicate work with sibling, uncovered acceptance criterion (no subtask), missing key dependency
- **MEDIUM**: Granularity mismatch with siblings, vague language, missing technical context, over-serialized dependencies
- **LOW**: Terminology drift, minor description improvements, parallel optimization opportunities

### 5. Produce Analysis Report

```markdown
## Task Analysis Report: [task-id] — [title]

**Analyzed**: [date]
**Parent Epic**: [epic-id] — [epic-title]
**Siblings**: [count] tasks
**Subtasks**: [count] subtasks

### Context Map

```
[epic-id] (Epic) — [epic-title]
├── [sibling-1] — [title] [status]
├── ★ [task-id] — [title] ← ANALYZING
│   ├── [subtask-1] — [title] [status]
│   ├── [subtask-2] — [title] [status]
│   └── [subtask-3] — [title] [status]
└── [sibling-2] — [title] [status]
```

### Findings

| ID | Scope | Category | Severity | Summary | Recommendation |
|----|-------|----------|----------|---------|----------------|
| U1 | ↑ Epic | Alignment | [sev] | [summary] | [action] |
| L1 | ↔ Sibling | Overlap | [sev] | [summary] | [action] |
| D1 | ↓ Subtask | Coverage | [sev] | [summary] | [action] |
| Q1 | ● Self | Quality | [sev] | [summary] | [action] |

### Acceptance Criteria Coverage

| # | Criterion | Subtask(s) | Status |
|---|-----------|-----------|--------|
| 1 | [criterion text] | [subtask-ids] | ✅ Covered |
| 2 | [criterion text] | — | ❌ Uncovered |
| 3 | [criterion text] | [subtask-id] | ⚠️ Partial |

### Sibling Comparison

| Task | Scope Size | Subtasks | Has AC? | Priority | Overlap? |
|------|-----------|----------|---------|----------|----------|
| ★ [task-id] | [size] | [n] | [Y/N] | P[n] | — |
| [sibling-id] | [size] | [n] | [Y/N] | P[n] | [Y/N + detail] |

### Quality Scorecard

| Metric | Value |
|--------|-------|
| Acceptance Criteria Count | [n] |
| Criteria with Subtasks | [n] ([%]) |
| Subtasks with Done Criteria | [n] ([%]) |
| Epic Goals Served | [n]/[total] |
| Sibling Overlap Issues | [n] |
| Critical Findings | [n] |
| High Findings | [n] |
| Medium Findings | [n] |
| Low Findings | [n] |

### Health Grade: **[A/B/C/D/F]**

[one-line summary]
```

### 6. Next Actions

```markdown
### Recommended Next Actions

| # | Action | Command | Addresses |
|---|--------|---------|-----------|
| 1 | [action] | [command] | [finding IDs] |
| 2 | [action] | [command] | [finding IDs] |
```

### 7. Offer Remediation

```markdown
Would you like me to help address specific findings?

- Say **"fix [ID]"** to address a specific finding
- Say **"fix high"** to address all high-severity findings
- Say **"analyze epic"** to run full epic analysis (`/bd-analyze-epic`)
- Say **"done"** to end
```

## Analysis Guidelines

- **NEVER modify issues** during analysis — read-only until user requests fixes
- **Context is king** — a task can only be evaluated in relation to its hierarchy
- **The three scopes matter equally** — don't skip upward or lateral checks
- **Be specific** — cite issue IDs, quote descriptions, show the gap clearly
- **Actionable over exhaustive** — every finding needs a recommendation, not just a complaint
