# Issue 68 Test Plan

## File layout

```
tests/
  unit/
    stages/
      review/
        agentic/
          agentic-executor.spec.ts
          loaders/
            agent-loader.spec.ts
          subagents/
            definitions.spec.ts
          tools/
            mcp-tools.spec.ts
  integration/
    agentic-executor.integration.spec.ts
```

---

## Unit tests

### 1. AgenticExecutor — `tests/unit/stages/review/agentic/agentic-executor.spec.ts`

The `query()` call from `@anthropic-ai/claude-agent-sdk` is the external boundary. We mock it at the module level with `jest.mock` and make it return an async generator that yields pre-built message sequences.

**Coordinator prompt built correctly**

- Default case: call `execute([someFile])` with a job that has no `agentic.systemPrompt` and no `coordinatorPrompt` file. Assert the `options.systemPrompt` passed to `query` contains the static role text (`"You are a code reviewer"`) and an empty append section.
- With `systemPrompt` append: set `job.agentic.systemPrompt = "Focus on security"`. Assert the string appears in the built prompt.
- With `coordinatorPrompt` file override: this field doesn't exist in the current code — the issue mentions it but `buildSystemPrompt` doesn't read a file. I'll note this in the test file as a TODO and skip that sub-case for now, keeping the test for the two cases that are actually implemented.

**`subagentOverrides` applied to built-in definitions**

- `subagentOverrides` is not yet a field in `AgenticConfig`. The issue scope says to verify it, which suggests it will be added. I'll add a placeholder `it.todo` with a clear description so it's visible and can be filled in when the feature lands.

**Budget enforcement aborts at threshold**

- Same situation: `maxBudgetUsd` is in the config type but the executor doesn't currently track spend or abort. I'll add an `it.todo` that describes the expected behaviour (abort loop when cumulative cost exceeds threshold) so the test slot is reserved.

**Token usage reported to `SessionContext`**

- `addStageTokenStats` is not called from the executor today. Mark as `it.todo`.

**Structured output parsed from `SDKResultSuccess.structured_output`**

- The current code reads `message.result` (a string), not `structured_output`. Mark as `it.todo`.

**Partial results preserved on error/abort**

- Make the mock generator yield two `result/success` messages then throw. Assert that `execute()` throws but the issues from the first two messages were collected. *(This is testable today — the code does accumulate into `issues` before the throw.)*

**Per-subagent metrics captured from `SDKTaskNotificationMessage`**

- Mark as `it.todo` — the executor currently only logs these messages, it doesn't capture metrics.

**Other things actually testable today**

- `execute([])` returns `[]` immediately without calling `query`.
- Files sorted by total diff changes (additions + deletions) before building user prompt — inject two `FileInfo` objects with different diff sizes and spy on `buildUserPrompt` (or inspect the `prompt` arg to `query`) to assert ordering.
- `parseIssuesFromResult` — tested indirectly: mock generator yields a `result/success` with JSON containing issues of varying confidence; assert only those with `confidence >= 7` come back, and that fields map correctly to `ReviewIssue`.
- `parseIssuesFromResult` with no JSON in result: assert empty array returned (no throw).
- `parseIssuesFromResult` with malformed JSON: assert empty array, no throw.
- `parseLocation` cases: `"src/file.ts:42"` → `{file: "src/file.ts", line: 42}`; `"line:10"` → `{line: 10}`; empty string → `{}`.
- `calculatePriority`: critical→1, high→2, medium→3, low→4, unknown→3.

**Setup pattern**

```ts
jest.mock('@anthropic-ai/claude-agent-sdk', () => ({ query: jest.fn() }));

function makeQueryGenerator(...messages) {
  return (async function* () { for (const m of messages) yield m; })();
}
```

---

### 2. MCP tools — `tests/unit/stages/review/agentic/tools/mcp-tools.spec.ts`

The issue asks to test `git_diff`, `git_show`, `list_changed_files` with a temp git repo. Looking at the actual tools: the file exposes `git_diff_analysis`, `list_changed_files`, `find_usages`, `trace_imports`, `analyze_exports`, `find_interface_changes`. We test the git-backed ones using a real temp git repo (same approach as `createTestProject` in test-fixtures).

**Helper** — `createTempGitRepo(baseDir)`: calls `git init`, creates an initial commit, returns `{root, cleanup}`.

**`list_changed_files`**

- Add a file, commit it, add another file, commit — call `list_changed_files({base: "HEAD~1"})`. Assert output contains the second file with `A` prefix.
- Filter `A` vs `M`: modify the first file in a third commit, call with `filter: "M"` — assert only the modified file is listed.

**`git_diff_analysis`**

- Two commits with a known change. Call `git_diff_analysis({base: "HEAD~1"})`. Assert diff output contains the added/removed lines.
- With `stat: true` — assert output contains summary stats, not full diff.
- With `file` filter — assert only that file's diff is returned.

**`find_usages`**

- Create a temp dir with two `.ts` files where one defines `mySymbol` and the other uses it. Call `find_usages({symbol: "mySymbol"})`. Assert both files appear in output.
- Symbol that doesn't exist → returns `"No usages found"`.

**`trace_imports`** (pure file read, no git needed)

- Create a file that imports from two paths. Call `trace_imports({filePath})`. Assert the `imports` array in the JSON response matches.
- Non-existent file → returns `"File not found"`.

**`analyze_exports`** (with and without `compareWithRef`)

- File with several exports. Call without `compareWithRef` — assert `exports` array lists all export names.
- With `compareWithRef` pointing to a previous commit where one export was missing — assert `comparison.added` contains that export name.

These tests call the tool handler functions directly (extract them from the `createSdkMcpServer` call, or expose them as standalone helpers). Since `createSdkMcpServer` wraps them opaquely, the easiest path is to extract the handler logic into named private functions and test those, or accept that we call the full `createAgenticTools(cwd)` and invoke the handler via the returned server's tool registry.

**Decision**: call `createAgenticTools(tmpDir)` and extract each tool's handler by inspecting the tools array returned by the builder (check the SDK's API). If that's not easily accessible, refactor `tools/index.ts` minimally to export the handler functions directly so they can be imported and unit-tested without going through the MCP server layer.

---

### 3. AgentLoader — `tests/unit/stages/review/agentic/loaders/agent-loader.spec.ts`

All tests use a real temp directory (no mocking needed — this is pure file I/O with no network).

**Markdown parsing**

- File with valid `---` frontmatter: assert `description`, `model`, `tools` extracted correctly.
- File without frontmatter: assert `body` is the whole content, `frontmatter` is `{}`, defaults applied (`tools: ['Read','Grep','Glob']`, `model: 'sonnet'`).
- File with `tools: [Read, Grep]` array syntax in frontmatter: assert `tools` parsed as `['Read', 'Grep']`.
- Empty file body (frontmatter only): assert `loadAgentFromMarkdown` returns `null`.

**Frontmatter extraction**

- `description` with quotes stripped: `description: "My Agent"` → `My Agent`.
- `model: haiku` → `model: 'haiku'` on the definition.
- Unknown keys in frontmatter are silently ignored.

**Custom agent override by name**

- Create `.qualops/agents/security-analyzer.md` in the temp dir. Call `loadCustomAgents({agentsDir: '.qualops/agents', ...})`. Assert the returned map has key `security-analyzer` with the markdown agent's prompt (overriding whatever built-in would have that name).
- Two agents from files — both loaded, both present in returned map.

**Inline config agents**

- Pass `config.customAgents = [{name: 'my-agent', description: '...', prompt: '...'}]`. Assert `my-agent` is in the returned map with correct fields.
- Inline agents merged with file agents: inline agent `a` + file agent `b` → both present.
- File agent with same name as inline agent: file wins (loaded second, overwrites inline). Verify the order from the code: inline loaded first, then files — so file wins.

**Missing agents dir**

- `agentsDir` points to non-existent path → no error, returns empty `{}` (or just inline agents if provided).

---

### 4. Subagent definitions — `tests/unit/stages/review/agentic/subagents/definitions.spec.ts`

Pure logic tests, no I/O.

**`createSubagentDefinitions` respects `enabledSubagents` filter**

- `enabledSubagents: ['security-analyzer']` → returned map has exactly one key.
- `enabledSubagents: ['dependency-tracer', 'pattern-validator']` → exactly two keys.
- `enabledSubagents: []` → empty map (no subagents).
- `enabledSubagents` not set (undefined) → all four built-in agents returned.
- Unknown agent name in `enabledSubagents` (e.g. `'nonexistent'`) → silently skipped, not in returned map.

**Definitions are independent copies**

- Call `createSubagentDefinitions` twice; mutating the first result's entry does not affect the second result. (The current code does `{...def}` shallow copy — sufficient for this.)

**All four built-ins present and valid**

- Loop over the returned map when no filter applied; assert each entry has non-empty `description`, `prompt`, `tools` (array length > 0), and a valid `model` value.

---

## Integration test

### `tests/integration/agentic-executor.integration.spec.ts`

**Goal**: a real `query()` call against Claude — no mocks. Uses haiku, `maxTurns: 5`, `maxBudgetUsd: 0.50`.

**Fixture codebase**

Create a small fixture in `tests/helpers/` or inline in the test: a 3-file TypeScript codebase committed to a temp git repo. The fixture should have at least one deliberate issue (e.g. a SQL injection via string concat) so the agent has something to find, and a clean file so we can verify it doesn't hallucinate issues.

```
fixture/
  src/
    user-service.ts   ← has SQL injection issue
    math-utils.ts     ← clean, pure functions
    index.ts          ← re-exports
```

**Test: agentic review returns issues**

- Build a `PipelineJob` with `agentic: { maxTurns: 5, maxBudgetUsd: 0.50, model: 'haiku' }`.
- Build `FileInfo[]` from the fixture files (include `rawDiff` for at least the `user-service.ts`).
- Call `new AgenticExecutor(job, fixtureDir).execute(files)`.
- Assert: result is an array, length >= 0 (don't assert a specific count — LLM output is non-deterministic).
- Assert: each item in the array conforms to the `ReviewIssue` shape (has required fields, no undefined `id`, `file`, `type`, `severity`).

**Test: subagent delegation actually happens**

- Same setup but capture log output (spy on `logger.info`).
- After `execute()`, assert that logger was called with a message matching `/Message: type=.*task/` or similar pattern — confirming the SDK emitted task-related messages during the run.
- Alternatively (more robust): wrap `query` with a spy that records yielded messages, then assert at least one message has `type` containing `task_started` or `task_notification`.

**Notes on test config**

- Gate behind `ANTHROPIC_API_KEY` environment variable: if not set, `test.skip` with a descriptive message.
- Add to `jest.integration.config.ts` (already exists) — no new config file needed.
- Set a generous Jest timeout: `jest.setTimeout(120_000)`.
- Clean up temp git repo in `afterAll`.
