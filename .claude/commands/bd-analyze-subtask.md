---
description: Analyze a subtask in full context — parent task, parent epic, sibling subtasks, and cousin tasks — for consistency and actionability.
handoffs:
  - label: Refine Subtask
    agent: bd-refine-subtask
    prompt: Refine the subtask based on the analysis findings
  - label: Analyze Parent Task
    agent: bd-analyze-task
    prompt: Analyze the parent task for broader consistency
  - label: Analyze Parent Epic
    agent: bd-analyze-epic
    prompt: Analyze the grandparent epic for full-hierarchy consistency
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Perform a **read-only** deep-context analysis of a subtask — examining it in relation to its parent task, grandparent epic, sibling subtasks, and cousin tasks. Determine whether this subtask is actionable, correctly scoped, properly connected, and aligned with the full hierarchy. Output a structured report.

## Operating Constraints

**STRICTLY READ-ONLY**: Do **not** modify any issues. Output analysis only. User must approve any changes.

## Execution Steps

### 1. Load Full Hierarchy

Determine the subtask ID from `$ARGUMENTS`. If not provided:
- Show open subtasks and ask for selection
- Wait for response

Load the complete context — four levels of hierarchy:
```bash
bd show [subtask-id]                   # Target subtask
bd show [parent-task-id]               # Parent task
bd show [grandparent-epic-id]          # Grandparent epic
bd children [parent-task-id]           # Sibling subtasks
bd children [grandparent-epic-id]      # Cousin tasks (uncle/aunt tasks)
```

For each sibling subtask:
```bash
bd show [sibling-id]
```

For each cousin task (other tasks under the same epic):
```bash
bd show [cousin-task-id]
bd children [cousin-task-id]           # Cousin subtasks
```

Build internal model:
- **Target subtask**: title, description, done criteria, priority, dependencies
- **Parent task**: acceptance criteria, description, priority
- **Grandparent epic**: goals, scope, success criteria
- **Sibling subtasks**: titles, done criteria, dependencies, granularity
- **Cousin tasks**: titles, acceptance criteria (for cross-task alignment)
- **Full dependency graph**: across all loaded issues

### 2. Detection Passes

Run analysis across **four scopes**. Limit to **30 findings total**.

#### Scope 1: Self — Actionability

The most important scope for a subtask: can a developer pick this up and start immediately?

| Check | What to Detect |
|-------|---------------|
| **Title precision** | Does the title alone describe exactly what to do? |
| **Action specificity** | Is there one clear action, not multiple? |
| **File/location reference** | Are target files, modules, or components specified? |
| **Input/output definition** | Are expected inputs, outputs, or behavior changes clear? |
| **Done criteria** | Is there at least one concrete, verifiable completion signal? |
| **Size appropriateness** | Is this completable in hours? If it implies days of work, it's misscoped. |
| **Vague language** | Any "handle", "improve", "appropriate" without specific meaning? |
| **Unresolved markers** | Any TODO, TBD, ???, or placeholder text? |

#### Scope 2: Upward — Parent Task Alignment

| Check | What to Detect |
|-------|---------------|
| **Criteria mapping** | Which specific acceptance criterion of the parent task does this subtask serve? |
| **Contribution clarity** | Does completing this subtask visibly advance the parent task? |
| **Scope containment** | Does this subtask stay within the parent task's boundaries? |
| **Priority coherence** | Is subtask priority consistent with parent task? |

#### Scope 3: Lateral — Sibling Consistency

| Check | What to Detect |
|-------|---------------|
| **Duplicate work** | Does this subtask overlap with a sibling? |
| **Granularity match** | Is it the same size/scope as siblings? |
| **Dependency ordering** | Are deps on siblings correct? Any missing? Any unnecessary? |
| **Coverage completeness** | With all siblings combined, are all parent acceptance criteria covered? |
| **Gap identification** | Is there a parent criterion that NO sibling addresses? |

#### Scope 4: Upward Extended — Epic Alignment

| Check | What to Detect |
|-------|---------------|
| **Goal traceability** | Can you trace: subtask → parent task criterion → epic goal? |
| **Cross-task awareness** | Does this subtask's work need awareness of cousin tasks? (e.g., shared modules, conflicting changes) |
| **Scope creep detection** | Does this subtask address something explicitly out-of-scope in the epic? |

### 3. Severity Assignment

- **CRITICAL**: Subtask contradicts parent task/epic scope, no done criteria and no way to infer them, circular dependency
- **HIGH**: Missing done criteria, duplicates sibling work, doesn't map to any parent acceptance criterion, missing key dependency
- **MEDIUM**: Vague language, granularity mismatch with siblings, missing file paths, over-sized for a subtask
- **LOW**: Terminology drift, minor description improvements, parallel optimization, style issues

### 4. Produce Analysis Report

```markdown
## Subtask Analysis Report: [subtask-id] — [title]

**Analyzed**: [date]
**Parent Task**: [task-id] — [task-title]
**Parent Epic**: [epic-id] — [epic-title]
**Siblings**: [count] subtasks
**Cousins**: [count] tasks under same epic

### Hierarchy Context

```
[epic-id] (Epic) — [epic-title]
├── [cousin-task-1] — [title]
│   └── [cousin-subtasks...]
├── [parent-task-id] (Parent Task) — [task-title]
│   ├── [sibling-1] — [title] [status]
│   ├── ★ [subtask-id] — [title] ← ANALYZING
│   └── [sibling-2] — [title] [status]
└── [cousin-task-2] — [title]
    └── [cousin-subtasks...]
```

### Traceability Chain

```
Epic Goal: "[goal text]"
  └── Task Criterion: "[acceptance criterion text]"
      └── ★ Subtask: "[subtask title]"
          └── Done When: "[done criterion]"
```

[If traceability breaks at any level, mark it: **⚠️ BROKEN at [level]**]

### Findings

| ID | Scope | Category | Severity | Summary | Recommendation |
|----|-------|----------|----------|---------|----------------|
| S1 | ● Self | Actionability | [sev] | [summary] | [action] |
| U1 | ↑ Parent | Alignment | [sev] | [summary] | [action] |
| L1 | ↔ Sibling | Consistency | [sev] | [summary] | [action] |
| E1 | ↑↑ Epic | Traceability | [sev] | [summary] | [action] |

### Sibling Comparison

| Subtask | Size | Has Done Criteria? | Maps to AC# | Deps | Overlap? |
|---------|------|--------------------|-------------|------|----------|
| ★ [subtask-id] | [size] | [Y/N] | [#] | [deps] | — |
| [sibling-id] | [size] | [Y/N] | [#] | [deps] | [Y/N] |

### Parent Task Coverage

| # | Acceptance Criterion | Covered By | Status |
|---|---------------------|-----------|--------|
| 1 | [criterion] | [subtask-ids] | ✅/❌/⚠️ |
| 2 | [criterion] | [subtask-ids] | ✅/❌/⚠️ |

### Quality Scorecard

| Metric | Value |
|--------|-------|
| Actionability | [Strong/Partial/Missing] — [1-line detail] |
| Done Criteria | [Present/Missing] |
| Parent Criterion Served | AC #[n] |
| Traceability to Epic | [Complete/Broken at task/Broken at epic] |
| Sibling Consistency | [Consistent/Mismatch] |
| Critical Findings | [n] |
| High Findings | [n] |
| Medium Findings | [n] |
| Low Findings | [n] |

### Health Grade: **[A/B/C/D/F]**

[one-line summary]

Grading rubric:
- **A**: Fully actionable, traceable to epic, consistent with siblings, done criteria verifiable
- **B**: Minor gaps in context or done criteria, but developer can still start
- **C**: Needs refinement — missing key details that would cause questions during implementation
- **D**: Significant issues — missing done criteria, broken traceability, scope problems
- **F**: Not actionable — contradicts parent scope, duplicate of sibling, or fundamentally misscoped
```

### 5. Next Actions

```markdown
### Recommended Next Actions

| # | Action | Command | Addresses |
|---|--------|---------|-----------|
| 1 | [action] | [command] | [finding IDs] |
| 2 | [action] | [command] | [finding IDs] |
```

### 6. Offer Remediation

```markdown
Would you like me to help address specific findings?

- Say **"fix [ID]"** to address a specific finding
- Say **"refine"** to run `/bd-refine-subtask [subtask-id]`
- Say **"analyze task"** to analyze the parent task (`/bd-analyze-task [task-id]`)
- Say **"analyze epic"** to analyze the full epic (`/bd-analyze-epic [epic-id]`)
- Say **"done"** to end
```

## Analysis Guidelines

- **NEVER modify issues** — read-only until user requests fixes
- **Traceability is the key insight** — a subtask's value is proven by its chain to an epic goal
- **Actionability is the primary metric** — can a developer start coding from this subtask alone?
- **Context scales down** — at the subtask level, EVERY detail matters (file paths, function names, expected behavior)
- **Report zero issues gracefully** — if the subtask is well-structured, say so and show the clean traceability chain
- **Be precise** — cite IDs, quote text, show exact gaps. Vague findings at this level are useless.
