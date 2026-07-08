# Spec — Quality Standards

**Status:** Approved 2026-07-08 · Binding engineering quality bar. [`CLAUDE.md`](../CLAUDE.md) is the short enforceable summary; this is the detailed home. Applies to all code from the refactor onward.

## 1. Testing

- **Unit tests are colocated** with the code they test: `foo.ts` → `foo.test.ts` in the same folder. They test one module, with its dependencies provided as arguments (no global state).
- **Integration and smoke tests live in `tests/`**: integration exercises multiple modules or the full pipeline with the AI provider faked; smoke exercises real providers (credentialed, opt-in, excluded from the default `npm test`).
- **Coverage ≥ 80%** for statements, lines, and functions, **enforced in CI** via the Jest coverage threshold. Coverage is a floor, not a target — high coverage of trivial assertions is not quality.
- **Real tests, happy and unhappy paths.** Every module tests its success behavior *and* its error/edge behavior (invalid input, provider failure, empty results, boundary values). No snapshot-only tests standing in for assertions; no tests of private implementation detail. Every bug fix adds a regression test that fails before the fix.
- **Fakes only in tests.** Production code contains no mocks/stubs/placeholder implementations (see §5). Test fakes use the shared testing helpers where available.
- **Test files are excluded from the published package.** Only `dist/` is published (`package.json` `files`); `*.test.ts` is excluded from the library build (`tsconfig.lib.json`) so no test code compiles into `dist/`. CI verifies the packed tarball contains no test files.

## 2. Error handling

- All failures normalize to the shared `StructuredError { code, category, recoverable, exitCode, details }` (`kernel/error`). No bare `throw new Error`, no empty `catch`, no swallowed rejections.
- One process exit point (`app/run`): telemetry is flushed before exit; the gate verdict drives the exit code ([`behavior/pipeline.md`](behavior/pipeline.md) §2). Recoverable stage failures record an `error-<stage>.json` and continue; unrecoverable ones abort after flush.
- Exit codes are stable and documented (0 success/gate-passed · 1 gate failed · 2 config error · 3 provider/runtime error).

## 3. Logging

- **Redaction-safe by construction:** the default log path drops fields whose keys look like prompts/content/tokens/secrets and truncates large values, so a prompt or secret cannot be logged by accident.
- Structured, level-appropriate logging (`debug|info|warn|error`); **no `console.log`** in production code. The logger honors the configured `logger` block and the `--config` path (F-26).
- Content capture (full prompts/responses) is an **explicit observability opt-in** only (Langfuse/OTel), never the default.

## 4. Security

- Treat all PR-derived text (titles, bodies, comments, diffs) and all model output as **untrusted**: sanitize before prompt assembly, never `eval`/execute it, always path-guard file access (`kernel/path-safety`).
- Tool and shell execution runs only through the sandbox with skip-pattern enforcement, secret redaction, and output limits. A model backend's built-in tools are never enabled — QualOps owns its tools ([`architecture.md`](architecture.md) §3).
- No secrets in source, logs, artifacts, or test fixtures. Secrets come from env only, read solely in `platform/env`.

## 5. No fakes in shipped code

No mocks, stubs, fake implementations, placeholder returns, hardcoded sample data, or `TODO`-stubbed functions in production code. A function does the real thing or does not exist. Nothing "temporary" ships. (Dead code — e.g. the currently commented-out rollback-metadata writes, vestigial fields — is removed, not left in place; see [`behavior/pipeline.md`](behavior/pipeline.md) §5.)

## 6. Dependencies

Minimize runtime dependencies; a new one needs a stated justification (what it replaces, license, footprint). Prefer the small tested utilities in `kernel/`. The model backbone is the Vercel AI SDK (`ai` + `@ai-sdk/*`), wired per-provider as optional peer dependencies (`concept/08`); the retired `@openai/agents` and `@eggai/configurable-agent` are not reintroduced.

## 7. Documentation & change hygiene

- `docs/` describes **shipped** behavior; update it in the **same PR** as any observable change. Specs describe intent; docs describe reality.
- `CHANGELOG.md` updated for every behavior-affecting change (buckets B and C in [`plans/refactor.md`](plans/refactor.md) get changelog entries; bucket C also gets a release note).
- The reviewable-refactor method (move ≠ edit, strangler shims, characterization tests, one-singleton-at-a-time) is normative for the refactor — [`plans/refactor.md`](plans/refactor.md) §5.
