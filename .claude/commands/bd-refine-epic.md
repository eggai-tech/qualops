---
description: Guide the user through refining an existing epic — clarify scope, improve structure, and resolve ambiguities.
handoffs:
  - label: Analyze Epic
    agent: bd-analyze-epic
    prompt: Analyze the refined epic for consistency
  - label: Create Tasks
    agent: bd-create-task
    prompt: Create tasks for this epic
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Improve an existing epic through a structured clarification workflow — modeled on the speckit clarify pattern. Ask up to 5 targeted questions to resolve ambiguities, fill gaps, and strengthen the epic's scope, goals, and success criteria. All changes are applied incrementally to the epic via `bd update`.

## Operating Principles

- **Read-first**: Load the full epic and its children before suggesting anything.
- **Targeted questions**: Maximum 5 questions, one at a time, each with a recommendation.
- **Incremental writes**: Update the epic after each accepted answer — don't batch.
- **Non-destructive**: Improve what exists; don't rewrite from scratch.
- **Beads-native**: All updates go through `bd update`. Never use TodoWrite or markdown files.

## Execution Steps

### 1. Load Epic Context

Determine the epic ID from `$ARGUMENTS`. If not provided:
- Run `bd list --type=epic --status=open` and present options
- Wait for user selection

Once identified, load full context:
```bash
bd show [epic-id]
bd children [epic-id]
```

For each child task, load a summary:
```bash
bd show [child-id]
```

Build an internal model of:
- Epic title, description, priority, labels
- All child tasks (titles, descriptions, acceptance criteria)
- All subtasks under those tasks
- Dependency graph
- Current gaps and inconsistencies

### 2. Structured Quality Scan

Evaluate the epic against this taxonomy. For each category, mark: **Strong** / **Partial** / **Missing**.

| Category | What to Check |
|----------|--------------|
| **Goals & Motivation** | Is the "why" clear? Are goals specific and measurable? |
| **Scope Boundaries** | Are in-scope and out-of-scope items explicit? Could someone misinterpret what's included? |
| **Success Criteria** | Are outcomes measurable and verifiable? Technology-agnostic? |
| **Task Coverage** | Do child tasks cover all in-scope items? Any gaps? |
| **Task Consistency** | Are tasks at consistent granularity? Do they align with epic goals? |
| **Dependencies** | Are cross-task and external dependencies captured? Any hidden blockers? |
| **Priority Alignment** | Is the epic priority consistent with its tasks and urgency signals? |
| **Acceptance Criteria** | Is there a clear "done" signal for the epic as a whole? |
| **Risk & Constraints** | Are known risks, constraints, or assumptions documented? |
| **Terminology** | Are terms used consistently across epic and tasks? |

### 3. Generate Clarification Questions

From categories marked **Partial** or **Missing**, generate up to 5 prioritized questions:

**Prioritization heuristic**: Impact on scope × Uncertainty level
- Scope/goals questions first (highest blast radius)
- Then coverage gaps (missing work)
- Then consistency issues (misalignment)
- Then polish items (terminology, formatting)

Each question must be:
- Answerable with a short multiple-choice selection (2-5 options) OR a short phrase (≤ 5 words)
- Impactful enough that the answer changes the epic's structure or its tasks
- Not already answered in the existing description

### 4. Interactive Questioning Loop

Present **one question at a time**. For each:

**Multiple-choice format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote the relevant part of the epic or identify the gap]

**Recommended:** Option [X] — [1-2 sentence reasoning why this is best]

| Option | Description | Impact |
|--------|-------------|--------|
| A | [option] | [what changes] |
| B | [option] | [what changes] |
| C | [option] | [what changes] |

Reply with the option letter, say **"yes"** to accept the recommendation, or provide your own answer.
```

**Short-answer format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote the relevant part of the epic or identify the gap]

**Suggested:** [your proposed answer] — [brief reasoning]

Reply with your answer (≤ 5 words), or say **"yes"** to accept the suggestion.
```

**After each accepted answer**:
1. Determine which section of the epic description to update
2. Apply the change via `bd update`:
   ```bash
   bd update [epic-id] --description="[updated full description]"
   ```
3. Confirm the update: "Updated epic description with [change summary]. Moving to next question."

**Stop conditions**:
- All questions answered
- User says "done", "stop", or "good enough"
- 5 questions reached

### 5. Task Alignment Check

After all questions are answered, check if the refinements imply changes to child tasks:

```markdown
### Task Alignment

Based on the refinements, here's how child tasks are affected:

| Task | Status | Action Needed |
|------|--------|---------------|
| [task-id]: [title] | ✅ Aligned | None |
| [task-id]: [title] | ⚠️ Needs Update | [what changed] |
| [task-id]: [title] | ❌ No Longer Needed | [why] |
| — | 🆕 New Task Needed | [what's missing] |
```

For tasks needing updates, offer:
> Would you like me to update these tasks now? Say **"yes"** to update, or handle them manually later.

If yes, apply updates via `bd update [task-id] --description="..."` for each affected task.

### 6. Report Completion

```markdown
## Epic Refinement Complete

**Epic**: [epic-id] — [title]
**Questions Asked**: [N]/5
**Sections Updated**: [list]

### Quality Summary

| Category | Before | After |
|----------|--------|-------|
| Goals & Motivation | [status] | [status] |
| Scope Boundaries | [status] | [status] |
| Success Criteria | [status] | [status] |
| Task Coverage | [status] | [status] |
| ... | ... | ... |

### Changes Applied
1. [Change summary 1]
2. [Change summary 2]
3. [...]

### Outstanding Items
- [Any Partial/Missing categories not addressed, with rationale]

### Next Steps

| Action | Command |
|--------|---------|
| Analyze epic consistency | `/bd-analyze-epic [epic-id]` |
| Create missing tasks | `/bd-create-task [epic-id]` |
| Refine a child task | `/bd-refine-task [task-id]` |
| View updated epic | `bd show [epic-id]` |
```

## Guidance Rules

- **Never rewrite the entire description** — update sections surgically.
- **Don't ask about implementation details** — epics are about WHAT and WHY, not HOW.
- **Respect the user's time** — if the epic is already well-structured, say so and suggest proceeding to tasks.
- **If fewer than 5 questions are needed**, stop early. Quality over quantity.
- **Always offer task alignment** after refinement — cascading changes are the highest-value output.
