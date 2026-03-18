---
description: Create a new epic with guided workflow — title, description, priority, children, and dependencies.
handoffs:
  - label: Create Tasks for Epic
    agent: bd-create-task
    prompt: Create a task under the epic I just created
  - label: Analyze Epic
    agent: bd-analyze-epic
    prompt: Analyze the epic I just created
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Guide the developer through creating a well-structured epic in beads (`bd`). An epic is a high-level initiative that decomposes into tasks and subtasks. This command ensures epics are created with sufficient context, clear scope, and actionable structure — not just a title and a prayer.

## Operating Principles

- **Guide, don't interrogate**: Make informed defaults, ask only when ambiguity is high-impact.
- **Scope discipline**: Epics define WHAT and WHY, not HOW. Implementation details belong in tasks.
- **Beads-native**: All tracking goes through `bd` commands. Never use TodoWrite, TaskCreate, or markdown files.
- **Incremental value**: Even a partially-completed epic is better than nothing — save progress at every step.

## Execution Steps

### 1. Parse User Input

Analyze `$ARGUMENTS` to extract:
- **Title candidates**: The core initiative name (action-noun format preferred)
- **Scope signals**: What's included, what's excluded
- **Priority signals**: Urgency, impact, deadlines mentioned
- **Dependency signals**: References to other work, prerequisites, blockers

If `$ARGUMENTS` is empty or trivially short (< 5 words):
- Ask the user: "What initiative or feature area should this epic cover? A sentence or two is enough."
- Wait for response before proceeding.

### 2. Draft the Epic Structure

Generate the following from the user's input (making informed defaults where details are missing):

**Title**: Concise, action-oriented (e.g., "Onboarding Improvement", "API Rate Limiting", "Migrate to V2 Schema")
- 3-8 words
- No ticket prefixes, no version numbers
- Captures the initiative, not a single task

**Description**: Structured using this template:

```markdown
[1-2 sentence summary of the initiative and its motivation]

## Goals
- [Primary outcome this epic delivers]
- [Secondary outcomes, if any]

## Scope
### In Scope
- [Concrete deliverable or change]
- [...]

### Out of Scope
- [Explicitly excluded items that might be assumed]
- [...]

## Success Criteria
- [Measurable outcome 1]
- [Measurable outcome 2]

## Context
[Any background, constraints, or references that inform this work]
```

**Priority**: Map from user signals:
- P0: Production incident, security vulnerability, blocking all other work
- P1: Important initiative, time-sensitive, affects multiple teams or users
- P2: Standard planned work (default if no urgency signals)
- P3: Nice-to-have improvement, low urgency
- P4: Backlog/exploration, no timeline

**Labels**: Extract from context (e.g., team names, component areas, initiative tags).

**Dependencies**: Identify any mentioned blockers or prerequisites.

### 3. Present Draft for Review

Display the draft to the user in a clear, scannable format:

```markdown
## Epic Draft

**Title**: [title]
**Priority**: P[n] — [one-line rationale]
**Labels**: [labels, if any]

### Description

[full description from template above]

### Proposed Task Breakdown (High-Level)

Based on the scope, this epic could decompose into:

| # | Task Area | Description | Priority |
|---|-----------|-------------|----------|
| 1 | [area]    | [what]      | P[n]     |
| 2 | [area]    | [what]      | P[n]     |
| 3 | [area]    | [what]      | P[n]     |

> These are suggestions — tasks will be created separately via `/bd-create-task`.
```

Then ask:
> **Review the draft above.** You can:
> - Say **"go"** to create as-is
> - Say **"adjust [field]: [change]"** to modify specific fields
> - Say **"add/remove scope: [item]"** to adjust scope
> - Say **"change priority to P[n]"**
> - Provide freeform feedback and I'll revise

### 4. Incorporate Feedback

If the user requests changes:
- Apply modifications to the draft
- Show only the changed sections (not the full draft again)
- Ask for confirmation: "Updated. Ready to create, or more changes?"

Iterate up to 3 rounds. After 3 rounds, create with current state and note any unresolved items.

### 5. Create the Epic

Run the `bd create` command:

```bash
bd create --title="[title]" --description="[full description]" --type=epic --priority=[N] [--labels="label1,label2"] [--deps="dep1,dep2"]
```

**Important**:
- Use `--type=epic` always
- Pass the full structured description (use heredoc for multi-line)
- Include labels and dependencies if identified
- Capture the created issue ID from output

### 6. Create Dependencies (if applicable)

If the user mentioned dependencies on existing issues:
```bash
bd dep add [new-epic-id] [depends-on-id]
```

### 7. Quality Validation

After creation, verify the epic by running `bd show [epic-id]` and check:

- [ ] Title is concise and descriptive
- [ ] Description has Goals, Scope, and Success Criteria sections
- [ ] Priority is appropriate
- [ ] Dependencies are correctly linked
- [ ] No orphaned references

If any check fails, use `bd update` to fix immediately.

### 8. Report Completion

Output a summary:

```markdown
## Epic Created

**ID**: [epic-id]
**Title**: [title]
**Priority**: P[n]
**Status**: Open

### Next Steps

| Action | Command |
|--------|---------|
| Create tasks for this epic | `/bd-create-task [epic-id]` |
| Refine this epic | `/bd-refine-epic [epic-id]` |
| Analyze this epic | `/bd-analyze-epic [epic-id]` |
| View epic details | `bd show [epic-id]` |
| View epic tree | `bd children [epic-id]` |
```

## Guidance Rules

- **Never create an epic without a description** — even a one-liner is better than empty.
- **Default to P2** if priority is ambiguous.
- **Don't create child tasks automatically** — suggest them, but let the user trigger `/bd-create-task` explicitly.
- **If the user provides a very detailed description**, skip the review step and create directly (confirm first: "This looks complete — creating now. Say 'wait' if you want to review first.").
- **Respect existing epics** — before creating, do a quick `bd search` to check for duplicates. Warn if a similar epic exists.
