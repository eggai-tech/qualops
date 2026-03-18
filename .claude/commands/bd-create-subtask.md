---
description: Create a new subtask with guided workflow — title, description, parent task, priority, and dependencies.
handoffs:
  - label: Analyze Parent Task
    agent: bd-analyze-task
    prompt: Analyze the parent task for consistency
  - label: Refine Subtask
    agent: bd-refine-subtask
    prompt: Refine the subtask I just created
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty).

## Goal

Guide the developer through creating a well-structured subtask in beads (`bd`). A subtask is the most granular unit of work — a single, concrete action that a developer can pick up, complete in hours, and verify. This command ensures subtasks are atomic, testable, and properly nested in the hierarchy.

## Operating Principles

- **Atomic**: One subtask = one pull-request-sized change. If you can't describe it in one sentence, it's too big.
- **Verifiable**: Every subtask has a clear "done" signal — a test passes, a file exists, a behavior changes.
- **Connected**: Subtasks always have a parent task and inherit context from the epic above.
- **Beads-native**: All tracking goes through `bd` commands. Never use TodoWrite, TaskCreate, or markdown files.

## Execution Steps

### 1. Establish Context

Determine the parent task. Check `$ARGUMENTS` for:
- An explicit task ID (e.g., `qualops-b23.1`)
- A task name or reference
- No parent mentioned

**If a parent task is referenced**:
```bash
bd show [task-id]
```
Load the task's title, description, acceptance criteria, and existing children. Also load the grandparent epic for alignment context:
```bash
bd show [parent-epic-id]
```

**If no parent is referenced**:
- Run `bd list --type=task --status=open` to show available tasks
- Present them grouped by epic:

  ```markdown
  ## Available Tasks

  | ID | Epic | Task Title | Priority | Subtasks |
  |----|------|------------|----------|----------|
  | [id] | [epic-title] | [title] | P[n] | [count] |

  Which task should this subtask belong to?
  ```

- Wait for user selection.

### 2. Parse User Input

From `$ARGUMENTS` and context, extract:
- **What**: The specific atomic action
- **Why**: How it contributes to the parent task's acceptance criteria
- **Done signal**: How to verify completion
- **Dependencies**: Sibling subtasks that must complete first
- **File paths**: Specific files to create or modify (if mentioned)

If `$ARGUMENTS` is empty or trivially short (< 5 words):
- Show the parent task's acceptance criteria and ask: "Which part of this task should the subtask address? Or describe the specific work."
- Wait for response.

### 3. Check Sibling Context

Load existing subtasks:
```bash
bd children [task-id]
```

Use siblings to:
- Detect duplicates
- Identify the next logical step in the sequence
- Ensure consistent scope (all siblings should be roughly same size)
- Map dependency chains

### 4. Draft the Subtask

**Title**: Highly specific, verb-led (e.g., "Add validateConfig() function to src/utils/schema.ts", "Write unit test for config generation happy path")
- 4-15 words
- Starts with a verb
- Includes specific file paths or function names when applicable
- Unambiguous — someone reading just the title knows exactly what to do

**Description**: Concise and action-oriented:

```markdown
[One sentence: what to do and where]

## Details
- [Specific implementation detail or constraint]
- [File path(s) to create/modify]
- [Expected behavior or output]

## Done When
- [ ] [Concrete verification — e.g., "Tests pass", "Function returns expected output", "File exists at path"]
```

**Priority**: Inherit from parent task unless:
- This subtask is on the critical path → same as parent
- This subtask is cleanup/polish → one level below parent
- Default: Same as parent

**Dependencies**: Look for:
- Explicit mentions
- Logical ordering (e.g., "create utility" before "use utility in command")
- Siblings that produce artifacts this subtask consumes

### 5. Present Draft for Review

```markdown
## Subtask Draft

**Parent Task**: [task-id] — [task-title]
**Parent Epic**: [epic-id] — [epic-title]
**Title**: [title]
**Priority**: P[n]
**Dependencies**: [dep-ids or "None"]

### Description

[description from template]

### Hierarchy View

[epic-id] (Epic)
└── [task-id] (Task)
    ├── [existing-subtask-1]
    ├── [existing-subtask-2]
    └── ★ NEW: [this-subtask-title]
```

Then ask:
> **Review the draft.** Say **"go"** to create, **"adjust [field]: [change]"** to modify, or provide feedback.

### 6. Incorporate Feedback

Apply changes, show diffs, confirm. Max 3 revision rounds.

### 7. Create the Subtask

```bash
bd create --title="[title]" --description="[full description]" --type=task --priority=[N] --parent=[task-id] [--deps="dep1,dep2"] [--labels="label1,label2"]
```

**Important**:
- Use `--parent=[task-id]` (the parent task, NOT the epic)
- Use `--type=task` (beads uses task type for all levels; hierarchy comes from `--parent`)
- Use heredoc for multi-line descriptions
- Capture the created issue ID

### 8. Create Dependencies

If dependencies were identified on sibling subtasks:
```bash
bd dep add [new-subtask-id] [depends-on-id]
```

### 9. Quality Validation

Run `bd show [subtask-id]` and verify:

- [ ] Title is specific enough to act on without reading the description
- [ ] Description has a "Done When" section with at least one criterion
- [ ] Parent is correctly set to the task (not the epic)
- [ ] Dependencies are correctly linked
- [ ] Scope is atomic (completable in < 1 day)
- [ ] No duplicate of an existing sibling

Fix any issues immediately with `bd update`.

### 10. Batch Creation Offer

After creating one subtask, check if the parent task's acceptance criteria suggest more subtasks are needed:

```markdown
### More Subtasks Needed?

The parent task has these uncovered acceptance criteria:
- [ ] [criterion not yet addressed by any subtask]
- [ ] [criterion not yet addressed by any subtask]

Would you like to create subtasks for these? Say **"yes"** to continue, **"batch [descriptions]"** to create multiple at once, or **"done"** to stop.
```

If the user says "batch" or provides multiple descriptions:
- Create each subtask in sequence
- Set up dependency chains between them where logical
- Report all created subtasks in a single summary

### 11. Report Completion

```markdown
## Subtask Created

**ID**: [subtask-id]
**Title**: [title]
**Parent Task**: [task-id] — [task-title]
**Parent Epic**: [epic-id] — [epic-title]
**Priority**: P[n]
**Dependencies**: [deps or "None"]

### Task Progress

[task-id] (Task)
├── [subtask-1] — [status]
├── [subtask-2] — [status]
└── ★ [new-subtask-id] — Open

### Next Steps

| Action | Command |
|--------|---------|
| Create another subtask | `/bd-create-subtask [task-id]` |
| Refine this subtask | `/bd-refine-subtask [subtask-id]` |
| Claim and start work | `bd update [subtask-id] --claim` |
| View parent task | `bd show [task-id]` |
```

## Guidance Rules

- **Subtasks must be atomic** — if it takes more than a day, it should be a task instead.
- **Every subtask needs a "Done When"** — at minimum one verifiable criterion.
- **Include file paths when possible** — developers should know exactly where to work.
- **Match sibling granularity** — don't mix "write entire module" with "add one test case" under the same parent.
- **Offer batch creation** — most tasks need multiple subtasks, make it easy to create them in flow.
