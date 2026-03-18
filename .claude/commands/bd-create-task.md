---
description: Create a new task with guided workflow — title, description, parent epic, priority, and dependencies.
handoffs:
  - label: Create Subtasks
    agent: bd-create-subtask
    prompt: Create subtasks for the task I just created
  - label: Analyze Parent Epic
    agent: bd-analyze-epic
    prompt: Analyze the parent epic for consistency
  - label: Refine Task
    agent: bd-refine-task
    prompt: Refine the task I just created
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Guide the developer through creating a well-structured task in beads (`bd`). A task is a concrete unit of work that lives under an epic. This command ensures tasks have clear scope, acceptance criteria, and proper parent-child relationships.

## Operating Principles

- **Actionable from day one**: Every task should be claimable and startable without further clarification.
- **Right-sized**: A task should be completable in 1-3 days. If larger, suggest decomposing into subtasks.
- **Traceable**: Every task connects upward to an epic and downward to subtasks (if needed).
- **Beads-native**: All tracking goes through `bd` commands. Never use TodoWrite, TaskCreate, or markdown files.

## Execution Steps

### 1. Establish Context

First, determine the parent epic. Check `$ARGUMENTS` for:
- An explicit epic ID (e.g., `qualops-b23`)
- An epic name or reference
- No parent mentioned

**If a parent epic is referenced**:
```bash
bd show [epic-id]
```
Load the epic's title, description, scope, and existing children to ensure the new task aligns.

**If no parent is referenced**:
- Run `bd list --type=epic --status=open` to show available epics
- Present them:

  ```markdown
  ## Available Epics

  | ID | Title | Priority | Tasks |
  |----|-------|----------|-------|
  | [id] | [title] | P[n] | [count] |

  Which epic should this task belong to? Or say **"standalone"** to create without a parent.
  ```

- Wait for user selection.

**If user says "standalone"**: Proceed without `--parent`.

### 2. Parse User Input

From `$ARGUMENTS` and context, extract:
- **What**: The specific work to be done
- **Why**: How it serves the parent epic's goals
- **Acceptance criteria**: How we know it's done
- **Dependencies**: What must be done first
- **Estimate**: If the user mentions time/effort

If `$ARGUMENTS` is empty or trivially short (< 5 words):
- Ask: "What work needs to be done? A sentence describing the task is enough."
- Wait for response.

### 3. Check for Sibling Context

If a parent epic is known, load existing children:
```bash
bd children [epic-id]
```

Use sibling tasks to:
- Detect potential duplicates (warn if similar title/scope exists)
- Infer appropriate priority level
- Identify natural dependency chains
- Ensure consistent granularity (if siblings are fine-grained, match that level)

### 4. Draft the Task

Generate the following:

**Title**: Specific, verb-led action (e.g., "Add JSON Schema validation utility", "Rewrite /qualops-setup command template")
- 4-12 words
- Starts with a verb (Add, Create, Fix, Refactor, Update, Implement, Write, Remove)
- Specific enough to understand without reading the description

**Description**: Structured using this template:

```markdown
[1-2 sentence summary of what this task delivers and why it matters]

## What to Do
- [Concrete action step 1]
- [Concrete action step 2]
- [...]

## Acceptance Criteria
- [ ] [Testable criterion 1]
- [ ] [Testable criterion 2]
- [ ] [...]

## Technical Notes
[Any implementation hints, file paths, API references, or constraints — optional but valuable]
```

**Priority**: Inherit from parent epic unless the task has its own urgency signals:
- Critical path tasks: Same as or higher than parent
- Supporting/polish tasks: One level below parent
- Default: Same as parent

**Dependencies**: Identify from:
- Explicit user mentions
- Logical ordering with siblings (e.g., "schema validation" before "config generation that uses validation")
- Technical prerequisites visible from the description

### 5. Present Draft for Review

```markdown
## Task Draft

**Parent Epic**: [epic-id] — [epic-title]
**Title**: [title]
**Priority**: P[n]
**Dependencies**: [dep-ids or "None"]

### Description

[full description from template]

### Relationship Map

```
[epic-id] (Epic)
├── [existing-sibling-1]
├── [existing-sibling-2]
└── ★ NEW: [this-task-title]    ← [dep arrows if applicable]
```
```

Then ask:
> **Review the draft above.** You can:
> - Say **"go"** to create as-is
> - Say **"adjust [field]: [change]"** to modify specific fields
> - Say **"split"** if this task should be decomposed into subtasks instead
> - Provide freeform feedback and I'll revise

### 6. Handle Split Request

If the user says "split":
1. Propose 2-4 subtask titles based on the task's scope
2. Ask which split structure they prefer
3. Create the parent task with a simplified description
4. Suggest running `/bd-create-subtask` for each child

### 7. Incorporate Feedback

Apply changes, show diffs, confirm. Max 3 revision rounds.

### 8. Create the Task

```bash
bd create --title="[title]" --description="[full description]" --type=task --priority=[N] --parent=[epic-id] [--deps="dep1,dep2"] [--labels="label1,label2"]
```

**Important**:
- Use `--parent=[epic-id]` to establish hierarchy
- Use heredoc for multi-line descriptions
- Capture the created issue ID

### 9. Create Dependencies

If dependencies were identified:
```bash
bd dep add [new-task-id] [depends-on-id]
```

For each dependency, verify the target exists first with `bd show`.

### 10. Quality Validation

Run `bd show [task-id]` and verify:

- [ ] Title starts with a verb and is specific
- [ ] Description has "What to Do" and "Acceptance Criteria" sections
- [ ] Parent is correctly set
- [ ] Dependencies are correctly linked
- [ ] Priority is consistent with parent and siblings
- [ ] No duplicate of an existing sibling

Fix any issues immediately with `bd update`.

### 11. Report Completion

```markdown
## Task Created

**ID**: [task-id]
**Title**: [title]
**Parent**: [epic-id] — [epic-title]
**Priority**: P[n]
**Dependencies**: [deps or "None"]

### Epic Progress

[epic-id] (Epic)
├── [sibling-1] — [status]
├── [sibling-2] — [status]
└── ★ [new-task-id] — Open

### Next Steps

| Action | Command |
|--------|---------|
| Create subtasks | `/bd-create-subtask [task-id]` |
| Create another task | `/bd-create-task [epic-id]` |
| Refine this task | `/bd-refine-task [task-id]` |
| Claim and start work | `bd update [task-id] --claim` |
| View task details | `bd show [task-id]` |
```

## Guidance Rules

- **Every task needs acceptance criteria** — at minimum one testable criterion.
- **Warn on oversized tasks**: If the description implies more than 3 days of work, suggest splitting.
- **Respect sibling granularity**: Match the specificity level of existing tasks under the same parent.
- **Don't duplicate existing work**: Always check siblings before creating.
- **If the user provides a very detailed description**, skip review and create directly (with a quick confirmation).
