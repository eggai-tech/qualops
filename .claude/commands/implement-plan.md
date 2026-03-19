---
description: Implement a plan file end-to-end — read context, write code, validate, close issues, commit, and open a PR.
handoffs:
  - label: Create Follow-up Issues
    agent: bd-create-task
    prompt: Create follow-up tasks for issues discovered during implementation
  - label: Refine the Plan
    agent: bd-refine-task
    prompt: Refine the plan before implementation
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding (if not empty). It may contain a plan file path, a beads issue ID, or both.

## Goal

Execute an implementation plan from start to finish. This command takes a plan (either a file path or a beads issue with a linked plan) and systematically implements all subtasks, validates the result, closes issues, commits, pushes, and opens a PR.

## Operating Principles

- **Read before writing**: Never modify a file you haven't read. Understand existing code before changing it.
- **Follow the dependency chain**: Implement subtasks in order. Earlier subtasks may produce exports or types that later ones depend on.
- **Validate continuously**: Build and test after each major subtask, not just at the end. Fix issues as they arise.
- **Minimal changes**: Only change what the plan calls for. Don't refactor surrounding code, add extra features, or "improve" things not in scope.
- **Beads-native**: All issue tracking goes through `bd`. Never use TodoWrite, TaskCreate, or markdown files.

## Execution Steps

### 1. Locate and Read the Plan

**If a file path is provided in `$ARGUMENTS`:**
```bash
# Read the plan file directly
```

**If a beads issue ID is provided:**
```bash
bd show [issue-id]
```
Look for a linked plan file in the issue description, notes, or design field. Also check the `plans/` directory for matching files.

**If neither is provided:**
- Check `bd ready` and `bd list --status=in_progress` for active work with plans
- Check `plans/` directory for recent plan files
- Ask the user which plan to implement

**Read the plan thoroughly.** Identify:
- The subtask dependency chain (what must be done in what order)
- All files to create or modify
- Any new dependencies to install
- The verification criteria

### 2. Read All Existing Files

Before writing any code, read **every file** the plan says to modify. Also read:
- Neighboring files for import patterns and conventions
- Existing tests in the same area for test patterns (mocking style, setup/teardown, assertion patterns)
- Config files (`tsconfig.json`, `package.json`, etc.) that affect compilation
- Schema files or type definitions that the implementation must conform to

Use parallel reads where possible. This context is critical — skipping it leads to code that doesn't match the project's style or breaks existing patterns.

### 3. Install Dependencies

If the plan requires new packages:
```bash
npm install <package-name>
```

Run the build immediately after to catch any type or resolution issues early:
```bash
npm run build:check
```

If the build fails due to the new dependency (e.g., missing type definitions, incompatible versions, special configuration), fix it now before writing feature code.

### 4. Implement Subtasks in Order

Work through the dependency chain one subtask at a time. For each subtask:

1. **Create or modify files** as specified in the plan
2. **Follow existing patterns** — match the import style, naming conventions, and code organization of the surrounding code
3. **Export what later subtasks need** — if subtask 2 depends on subtask 1, make sure the right functions/types are exported

**After each subtask that produces compilable code**, run:
```bash
npm run build:check
```

Fix any type errors before moving to the next subtask. Errors compound if left unaddressed.

### 5. Write Tests

When implementing the test subtask:
- Use the same test patterns observed in step 2 (mocking style, describe/it nesting, setup/teardown)
- Use `@/` path aliases for imports (this project uses `@/*` → `src/*`)
- Use temp directories (`mkdtempSync`) for filesystem operations, clean up in `afterEach`
- Mock the logger: `jest.mock('@/shared/utils/logger')`
- Run tests immediately after writing:
```bash
npx jest <path-to-new-test-file>
```

Fix any failures before proceeding.

### 6. Full Validation

Run all three quality gates. These must ALL pass before committing.

```bash
npm run build:check   # Type-check
npm test              # Full test suite (all existing + new tests)
npm run lint          # Linting
```

**If lint fails with auto-fixable errors:**
```bash
npm run lint:fix
```
Then re-run `npm run lint` to confirm no remaining issues. Fix any non-auto-fixable errors manually.

**If tests fail**, diagnose and fix. Do not skip or disable existing tests. If your changes break existing tests, that's a signal the implementation needs adjustment.

### 7. Close Beads Issues

Close all completed subtask and parent issues:
```bash
bd close [issue-id] --reason="Brief description of what was done"
```

Use `bd close id1 id2 ...` to close multiple issues efficiently. Include a meaningful reason that summarizes the implementation.

### 8. Commit and Push

```bash
# Pull beads updates
bd dolt pull

# Stage specific files (never use git add -A)
git add <file1> <file2> ... .beads/

# Commit with descriptive message
git commit -m "$(cat <<'EOF'
<type>(<scope>): <short description>

<body explaining the why, not the what>

- Bullet points for notable changes
- Include test counts if tests were added

Closes <issue-id>

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
EOF
)"

# Push beads and code
bd dolt push
git push  # Use --set-upstream origin <branch> if no upstream
```

### 9. Open a Pull Request

```bash
gh pr create --title "<type>(<scope>): <short title under 70 chars>" --body "$(cat <<'EOF'
## Summary

- Bullet points summarizing each major change
- Focus on what and why, not implementation details

## Test plan

- [x] `npm test` — all N tests pass (M new)
- [x] `npm run build` — compiles without errors
- [x] `npm run lint` — no lint errors
- [ ] Manual verification steps from the plan

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)" --base main
```

Return the PR URL to the user.

## Error Recovery

### Build fails after dependency install
Check if the dependency needs additional companion packages (e.g., `ajv` needs `ajv-formats` for format validation). Check the error message for specific missing features.

### Tests fail at module level (before any test runs)
Usually a misconfigured import or missing module. Check:
- Is the import path correct? (`@/` prefix, correct file name)
- Does the module initialize correctly? (top-level `compile()`, `new Class()`, etc.)
- Are there missing peer dependencies?

### Lint fails after auto-fix
The auto-fixer handles formatting. Remaining errors are typically:
- Unused variables — remove them
- Type-only imports — use `import type { ... }` syntax
- Missing return types — add explicit return types

### Push fails (no upstream)
```bash
git push --set-upstream origin <branch-name>
```

## Anti-Patterns to Avoid

- **Don't read the plan and then start coding without reading existing files** — you'll miss conventions
- **Don't implement all subtasks then validate at the end** — errors compound
- **Don't skip the full test suite** — your changes may break things outside your new test file
- **Don't stage everything with `git add .`** — stage specific files to avoid committing sensitive or unrelated files
- **Don't amend commits** — create new commits
- **Don't say "ready to push when you are"** — YOU must push. Work isn't done until it's on the remote.
