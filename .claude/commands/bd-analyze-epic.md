---
description: Analyze an epic and all its tasks/subtasks for consistency, completeness, and alignment with project goals.
handoffs:
  - label: Refine Epic
    agent: bd-refine-epic
    prompt: Refine the epic based on the analysis findings
  - label: Create Missing Tasks
    agent: bd-create-task
    prompt: Create tasks to fill the gaps identified in the analysis
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Perform a comprehensive, **read-only** analysis of an epic and its entire hierarchy (tasks, subtasks, dependencies). Identify inconsistencies, coverage gaps, scope drift, and quality issues. Output a structured report with severity-ranked findings and actionable recommendations — without modifying any issues.

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any issues. Output a structured analysis report. Offer remediation suggestions that the user must explicitly approve before any changes are made.

## Execution Steps

### 1. Load Epic Hierarchy

Determine the epic ID from `$ARGUMENTS`. If not provided:
- Run `bd list --type=epic --status=open` and present options
- Wait for user selection

Load the complete hierarchy:
```bash
bd show [epic-id]                    # Epic details
bd children [epic-id]                # Direct child tasks
```

For each child task:
```bash
bd show [task-id]                    # Task details + dependencies
bd children [task-id]                # Subtasks under each task
```

For each subtask:
```bash
bd show [subtask-id]                 # Subtask details + dependencies
```

Build a complete internal model:
- **Epic**: title, description (goals, scope, success criteria), priority, labels
- **Tasks**: title, description, acceptance criteria, priority, dependencies, status
- **Subtasks**: title, description, done criteria, priority, dependencies, status
- **Dependency graph**: full map of blocks/blocked-by relationships

### 2. Build Semantic Models

Create internal representations (do not output raw data):

- **Goal inventory**: Extract each goal/success criterion from the epic with a stable key
- **Scope inventory**: In-scope and out-of-scope items
- **Acceptance criteria inventory**: All testable criteria across all tasks
- **Done criteria inventory**: All verification steps across all subtasks
- **Dependency graph**: Full DAG of all issues and their relationships

### 3. Detection Passes

Run these analysis passes. Limit to **50 findings total**; aggregate overflow in a summary count.

#### A. Coverage Analysis

Map epic goals/success criteria → tasks → subtasks:

- **Uncovered goals**: Epic goals with no task addressing them
- **Uncovered acceptance criteria**: Task criteria with no subtask addressing them
- **Orphan tasks**: Tasks that don't map to any epic goal
- **Orphan subtasks**: Subtasks that don't map to any task acceptance criterion

#### B. Scope Consistency

- **Scope creep**: Tasks or subtasks that address items explicitly marked "out of scope" in the epic
- **Scope gaps**: In-scope items with no corresponding task
- **Goal drift**: Tasks whose descriptions suggest different goals than the epic states

#### C. Hierarchy Consistency

- **Granularity mismatch**: Tasks at wildly different sizes (e.g., one task is "Build entire auth system" while another is "Fix typo in error message")
- **Misplaced items**: Subtasks that should be tasks (too large), or tasks that should be subtasks (too small)
- **Depth inconsistency**: Some tasks have 5 subtasks while siblings have 0 — intentional or oversight?

#### D. Dependency Integrity

- **Missing dependencies**: Logical ordering violations (e.g., task B uses output of task A but doesn't depend on it)
- **Circular dependencies**: Any cycles in the dependency graph
- **Phantom dependencies**: Dependencies on issues that don't exist or are closed
- **Over-serialization**: Tasks marked as dependent that could actually run in parallel

#### E. Priority Alignment

- **Priority inversions**: Child tasks with higher priority than their parent epic
- **Inconsistent sibling priority**: Tasks at the same level with wildly different priorities without justification
- **Critical path misalignment**: The longest dependency chain doesn't contain the highest-priority items

#### F. Description Quality

- **Missing descriptions**: Issues with no or minimal description
- **Missing acceptance criteria**: Tasks without testable criteria
- **Missing done criteria**: Subtasks without verification steps
- **Vague language**: Ambiguous terms ("should work", "handle appropriately", "as needed") without measurable definition
- **Unresolved placeholders**: TODO, TBD, ???, FIXME markers

#### G. Terminology Consistency

- **Naming drift**: Same concept called different things across issues (e.g., "config" vs "configuration" vs "settings")
- **Conflicting definitions**: Different issues defining the same term differently

### 4. Severity Assignment

- **CRITICAL**: Uncovered epic goal, circular dependency, scope contradiction, blocking issue with no path forward
- **HIGH**: Missing acceptance criteria on task, orphan task/subtask, priority inversion, missing dependency
- **MEDIUM**: Granularity mismatch, terminology drift, vague language, depth inconsistency
- **LOW**: Minor description improvements, style inconsistencies, over-serialization opportunities

### 5. Produce Analysis Report

Output the report in this structure (do not write to files):

```markdown
## Epic Analysis Report: [epic-id] — [title]

**Analyzed**: [date]
**Hierarchy**: [epic-count] epic, [task-count] tasks, [subtask-count] subtasks
**Total Issues Scanned**: [total]

### Findings

| ID | Category | Severity | Issue(s) | Summary | Recommendation |
|----|----------|----------|----------|---------|----------------|
| C1 | Coverage | HIGH | [epic-id] | Goal "[goal]" has no associated task | Create task addressing this goal |
| D1 | Dependency | CRITICAL | [task-id] → [task-id] | Circular dependency detected | Break cycle by removing [dep] |
| H1 | Hierarchy | MEDIUM | [task-id] | Task scope is subtask-sized | Demote to subtask under [parent] |
| ... | ... | ... | ... | ... | ... |

### Coverage Matrix

| Epic Goal / Success Criterion | Covering Task(s) | Covering Subtask(s) | Status |
|------------------------------|-------------------|---------------------|--------|
| [goal 1] | [task-ids] | [subtask-ids] | ✅ Covered |
| [goal 2] | — | — | ❌ Uncovered |
| [goal 3] | [task-id] | — | ⚠️ Partial (no subtasks) |

### Dependency Graph Summary

| Task | Depends On | Blocked By | Blocks | Parallel? |
|------|-----------|------------|--------|-----------|
| [task-id] | [deps] | [blockers] | [blocking] | [Yes/No] |

### Quality Scorecard

| Metric | Value |
|--------|-------|
| Total Goals | [n] |
| Covered Goals | [n] ([%]) |
| Total Tasks | [n] |
| Tasks with Acceptance Criteria | [n] ([%]) |
| Total Subtasks | [n] |
| Subtasks with Done Criteria | [n] ([%]) |
| Dependency Issues | [n] |
| Critical Findings | [n] |
| High Findings | [n] |
| Medium Findings | [n] |
| Low Findings | [n] |

### Health Grade

**[A/B/C/D/F]** — [one-line summary of overall health]

Grading rubric:
- **A**: No critical/high findings, >90% coverage, all criteria testable
- **B**: No critical findings, <3 high findings, >75% coverage
- **C**: No critical findings, <5 high findings, >50% coverage
- **D**: 1+ critical findings OR >5 high findings OR <50% coverage
- **F**: Multiple critical findings, fundamental structural problems
```

### 6. Next Actions

Based on findings:

```markdown
### Recommended Next Actions

**Priority order** (address critical/high first):

| # | Action | Command | Addresses |
|---|--------|---------|-----------|
| 1 | [action] | `/bd-refine-epic [epic-id]` | [finding IDs] |
| 2 | [action] | `/bd-create-task [epic-id]` | [finding IDs] |
| 3 | [action] | `/bd-refine-task [task-id]` | [finding IDs] |
| ... | ... | ... | ... |
```

### 7. Offer Remediation

```markdown
Would you like me to help address the top findings?

- Say **"fix [ID]"** to address a specific finding
- Say **"fix critical"** to address all critical findings
- Say **"fix all"** to work through findings by priority
- Say **"done"** to end the analysis
```

If the user requests fixes, apply them using the appropriate `bd update` commands and re-verify.

## Analysis Guidelines

- **NEVER modify issues** during analysis — this is read-only until the user explicitly requests fixes
- **NEVER hallucinate issues** — if data is missing, report it accurately as "not found" or "empty"
- **Prioritize actionable findings** — every finding should have a clear recommendation
- **Be specific** — cite exact issue IDs, quote descriptions, reference specific gaps
- **Report zero issues gracefully** — if the epic is well-structured, say so with the quality scorecard
- **Keep the report scannable** — tables over paragraphs, IDs over names, severity colors over text
