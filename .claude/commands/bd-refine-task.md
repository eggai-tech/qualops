---
description: Guide the user through refining an existing task — clarify scope, improve acceptance criteria, and align with parent epic.
handoffs:
  - label: Analyze Task
    agent: bd-analyze-task
    prompt: Analyze the refined task for consistency
  - label: Create Subtasks
    agent: bd-create-subtask
    prompt: Create subtasks for this task
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Improve an existing task through targeted clarification — ensuring it has clear acceptance criteria, appropriate scope, proper dependencies, and alignment with its parent epic and sibling tasks. Ask up to 5 questions, one at a time, to resolve ambiguities and strengthen the task.

## Operating Principles

- **Context-rich**: Load the task, its parent epic, siblings, and children before suggesting anything.
- **Implementation-aware**: Unlike epics, tasks CAN include technical details — file paths, function names, API endpoints.
- **Testability-focused**: Every refinement should make the task more verifiable.
- **Incremental writes**: Update after each accepted answer via `bd update`.
- **Beads-native**: All updates through `bd`. Never use TodoWrite or markdown files.

## Execution Steps

### 1. Load Full Context

Determine the task ID from `$ARGUMENTS`. If not provided:
- Run `bd list --type=task --status=open` and present options
- Wait for user selection

Load the full context hierarchy:
```bash
bd show [task-id]           # Task details
bd show [parent-epic-id]    # Parent epic for alignment
bd children [parent-epic-id] # Sibling tasks for consistency
bd children [task-id]       # Existing subtasks
```

Build an internal model of:
- Task: title, description, acceptance criteria, priority, dependencies
- Parent epic: goals, scope, success criteria
- Sibling tasks: titles, scope, granularity
- Child subtasks: what's already decomposed
- Dependency chain: what blocks/is blocked by this task

### 2. Structured Quality Scan

Evaluate the task against this taxonomy. Mark each: **Strong** / **Partial** / **Missing**.

| Category | What to Check |
|----------|--------------|
| **Clarity of Action** | Can a developer start working from just the title + description? |
| **Acceptance Criteria** | Are criteria testable, specific, and complete? Can QA verify them? |
| **Scope Sizing** | Is this 1-3 days of work? Too big → needs subtasks. Too small → merge with sibling. |
| **Epic Alignment** | Does this task directly serve the parent epic's goals? |
| **Sibling Consistency** | Is this task at the same granularity as its siblings? |
| **Dependencies** | Are all prerequisites identified? Any hidden blockers? |
| **Technical Context** | Are relevant file paths, APIs, or modules referenced? |
| **Edge Cases** | Are failure modes and boundary conditions addressed? |
| **Subtask Coverage** | If subtasks exist, do they fully cover the task's acceptance criteria? |
| **Done Signal** | Is there an unambiguous "this task is complete" definition? |

### 3. Generate Clarification Questions

From **Partial** or **Missing** categories, generate up to 5 prioritized questions:

**Prioritization**: Acceptance criteria gaps > scope issues > dependency gaps > technical context > edge cases

Each question must:
- Be answerable with multiple-choice (2-5 options) or short phrase (≤ 5 words)
- Materially improve the task's actionability or testability
- Not duplicate information already in the description

### 4. Interactive Questioning Loop

Present **one question at a time**:

**Multiple-choice format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote relevant part of task or identify the gap]

**Recommended:** Option [X] — [reasoning]

| Option | Description | Impact on Task |
|--------|-------------|----------------|
| A | [option] | [what changes in the task] |
| B | [option] | [what changes in the task] |
| C | [option] | [what changes in the task] |

Reply with the option letter, say **"yes"** for the recommendation, or provide your own answer.
```

**Short-answer format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote relevant part of task or identify the gap]

**Suggested:** [answer] — [reasoning]

Reply with your answer (≤ 5 words), or say **"yes"** to accept.
```

**After each accepted answer**:
1. Update the task description via `bd update [task-id] --description="[updated]"`
2. Confirm: "Updated [section]. Moving to next question."

**Stop conditions**: All questions answered, user says "done"/"stop", or 5 questions reached.

### 5. Acceptance Criteria Hardening

After questions, specifically review acceptance criteria:

```markdown
### Acceptance Criteria Review

| # | Criterion | Testable? | Specific? | Action |
|---|-----------|-----------|-----------|--------|
| 1 | [criterion] | ✅/❌ | ✅/❌ | [Keep/Rewrite/Add detail] |
| 2 | [criterion] | ✅/❌ | ✅/❌ | [Keep/Rewrite/Add detail] |

**Suggested improvements:**
- [Rewritten criterion with specific, testable language]
- [New criterion to cover identified gap]
```

Ask: "Apply these acceptance criteria improvements? Say **'yes'** to update, or provide edits."

If accepted, apply via `bd update`.

### 6. Subtask Alignment Check

If the task has subtasks, check alignment:

```markdown
### Subtask Alignment

| Subtask | Covers Criterion | Status | Action |
|---------|-----------------|--------|--------|
| [id]: [title] | AC #[n] | ✅ Aligned | None |
| [id]: [title] | AC #[n] | ⚠️ Drift | [what changed] |
| — | AC #[n] | 🆕 Missing | No subtask covers this criterion |
```

Offer to update drifted subtasks or suggest creating missing ones.

### 7. Sibling Consistency Check

Compare with sibling tasks:

```markdown
### Sibling Consistency

| Check | Result |
|-------|--------|
| Granularity | [Consistent / This task is larger/smaller than siblings] |
| Priority | [Aligned / Mismatch: this is P[n] but siblings are P[m]] |
| Dependencies | [Complete / Missing dep on [sibling-id]] |
| Terminology | [Consistent / Drift: uses "[term A]" but siblings use "[term B]"] |
```

If issues found, offer specific fixes.

### 8. Report Completion

```markdown
## Task Refinement Complete

**Task**: [task-id] — [title]
**Parent Epic**: [epic-id] — [epic-title]
**Questions Asked**: [N]/5
**Sections Updated**: [list]

### Quality Summary

| Category | Before | After |
|----------|--------|-------|
| Clarity of Action | [status] | [status] |
| Acceptance Criteria | [status] | [status] |
| Scope Sizing | [status] | [status] |
| Epic Alignment | [status] | [status] |
| ... | ... | ... |

### Changes Applied
1. [Change summary]
2. [...]

### Next Steps

| Action | Command |
|--------|---------|
| Analyze task consistency | `/bd-analyze-task [task-id]` |
| Create subtasks | `/bd-create-subtask [task-id]` |
| Refine a subtask | `/bd-refine-subtask [subtask-id]` |
| Claim and start work | `bd update [task-id] --claim` |
```

## Guidance Rules

- **Tasks CAN be technical** — include file paths, API details, function signatures. This is expected.
- **Focus on testability** — every refinement should make acceptance criteria more verifiable.
- **Don't over-decompose** — if the task is clear and right-sized, say so. Not everything needs subtasks.
- **Check both up and down** — alignment with parent epic AND consistency with child subtasks.
- **If the task is already strong**, skip questions and report: "This task is well-specified. No refinement needed."
