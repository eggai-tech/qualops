---
description: Guide the user through refining an existing subtask — sharpen scope, verify done criteria, and align with parent hierarchy.
handoffs:
  - label: Analyze Subtask
    agent: bd-analyze-subtask
    prompt: Analyze the refined subtask for consistency
  - label: Analyze Parent Task
    agent: bd-analyze-task
    prompt: Analyze the parent task after subtask refinement
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Sharpen an existing subtask so it's unambiguously actionable — a developer should be able to read the subtask and start coding within minutes. Ask up to 5 targeted questions to resolve any remaining ambiguity about what to do, where to do it, and how to verify it's done.

## Operating Principles

- **Precision over prose**: Subtask descriptions should be terse and specific. File paths, function names, expected behaviors.
- **Done = verifiable**: Every subtask must have at least one concrete verification step.
- **Hierarchy-aware**: Check alignment with parent task, sibling subtasks, and grandparent epic.
- **Incremental writes**: Update after each accepted answer via `bd update`.
- **Beads-native**: All updates through `bd`. Never use TodoWrite or markdown files.

## Execution Steps

### 1. Load Full Context

Determine the subtask ID from `$ARGUMENTS`. If not provided:
- Show open subtasks and ask for selection
- Wait for response

Load the complete hierarchy:
```bash
bd show [subtask-id]              # Subtask details
bd show [parent-task-id]          # Parent task
bd show [grandparent-epic-id]    # Grandparent epic
bd children [parent-task-id]     # Sibling subtasks
```

Build an internal model of:
- Subtask: title, description, done criteria, priority, dependencies
- Parent task: acceptance criteria (which criterion does this subtask serve?)
- Grandparent epic: goals and scope
- Sibling subtasks: what they cover, their granularity
- Dependencies: what this subtask needs and what depends on it

### 2. Structured Quality Scan

Evaluate against this taxonomy. Mark each: **Strong** / **Partial** / **Missing**.

| Category | What to Check |
|----------|--------------|
| **Title Specificity** | Does the title alone tell a developer exactly what to do? |
| **Action Clarity** | Is the single action described without ambiguity? |
| **File/Location** | Are target file paths, modules, or components specified? |
| **Input/Output** | Are expected inputs, outputs, or behavior changes defined? |
| **Done Criteria** | Is there a concrete, verifiable "done when" statement? |
| **Parent Alignment** | Does this subtask map to a specific acceptance criterion of the parent task? |
| **Sibling Consistency** | Is this subtask at the same granularity as its siblings? |
| **Dependencies** | Are prerequisites on sibling subtasks correctly captured? |
| **Edge Cases** | Are relevant edge cases or error conditions mentioned? |
| **Time Estimate** | Is this completable in hours (not days)? If days, it's too big. |

### 3. Generate Clarification Questions

From **Partial** or **Missing** categories, generate up to 5 prioritized questions:

**Prioritization**: Action clarity > file/location > done criteria > dependencies > edge cases

Each question must:
- Be answerable with multiple-choice (2-5 options) or short phrase (≤ 5 words)
- Directly improve a developer's ability to start and complete the work
- Focus on the concrete, not the abstract

### 4. Interactive Questioning Loop

Present **one question at a time**:

**Multiple-choice format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote the relevant part or identify the gap]

**Recommended:** Option [X] — [reasoning based on codebase patterns and parent task context]

| Option | Description |
|--------|-------------|
| A | [specific option, e.g., "Add to src/utils/schema.ts"] |
| B | [specific option, e.g., "Create new src/utils/validate.ts"] |
| C | [specific option] |

Reply with option letter, **"yes"** for recommendation, or your own answer.
```

**Short-answer format**:
```markdown
### Question [N]/[total]: [Topic]

**Context**: [Quote or identify gap]

**Suggested:** [specific answer] — [reasoning]

Reply with your answer (≤ 5 words), or **"yes"** to accept.
```

**After each accepted answer**:
1. Update via `bd update [subtask-id] --description="[updated]"`
2. Confirm: "Updated. Moving to next question."

**Stop conditions**: All answered, user says "done"/"stop", or 5 questions reached.

### 5. Done Criteria Hardening

After questions, specifically evaluate the "done when" / verification criteria:

```markdown
### Done Criteria Review

**Current**:
- [existing criterion 1]
- [existing criterion 2]

**Assessment**:
| Criterion | Verifiable? | Specific? | Recommendation |
|-----------|-------------|-----------|----------------|
| [criterion] | ✅/❌ | ✅/❌ | [Keep / Rewrite to: "..."] |

**Proposed done criteria**:
- [ ] [Specific, verifiable criterion — e.g., "npm test passes with new test in tests/schema.test.ts"]
- [ ] [Specific, verifiable criterion — e.g., "validateConfig({}) returns { valid: false, errors: [...] }"]
```

Ask: "Apply these done criteria? Say **'yes'** or provide edits."

If accepted, apply via `bd update`.

### 6. Sibling and Parent Alignment

Quick alignment check:

```markdown
### Alignment Check

**Maps to parent criterion**: [Which acceptance criterion of the parent task this subtask addresses]
**Sibling coverage gap**: [Any parent criterion not covered by any subtask]
**Dependency correctness**: [Any missing or incorrect deps with siblings]
**Granularity**: [Consistent with siblings / too big / too small]
```

If issues found, offer specific fixes or suggest creating/merging subtasks.

### 7. Report Completion

```markdown
## Subtask Refinement Complete

**Subtask**: [subtask-id] — [title]
**Parent Task**: [task-id] — [task-title]
**Parent Epic**: [epic-id] — [epic-title]
**Questions Asked**: [N]/5

### Quality Summary

| Category | Before | After |
|----------|--------|-------|
| Title Specificity | [status] | [status] |
| Action Clarity | [status] | [status] |
| File/Location | [status] | [status] |
| Done Criteria | [status] | [status] |
| ... | ... | ... |

### Changes Applied
1. [Change summary]
2. [...]

### Next Steps

| Action | Command |
|--------|---------|
| Analyze subtask in context | `/bd-analyze-subtask [subtask-id]` |
| Refine sibling subtask | `/bd-refine-subtask [sibling-id]` |
| Claim and start work | `bd update [subtask-id] --claim` |
| View parent task | `bd show [task-id]` |
```

## Guidance Rules

- **Be extremely specific** — subtask refinement is about precision. "Add function X to file Y that does Z" not "implement the feature".
- **File paths are mandatory** when the work involves code changes.
- **Done criteria must be machine-verifiable** when possible (test passes, linter clean, build succeeds).
- **If the subtask is already precise**, say so immediately: "This subtask is well-specified. Ready to claim and start."
- **Don't inflate scope** — refinement should sharpen, not expand. If new scope emerges, suggest a new subtask.
- **Check for over-decomposition** — if this subtask is trivial (< 30 min), suggest merging with a sibling.
