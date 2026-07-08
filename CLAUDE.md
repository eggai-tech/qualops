# CLAUDE.md — Engineering contract for QualOps

Rules for anyone (human or AI) changing this codebase. They are binding. When a rule and a request conflict, surface the conflict — don't silently break the rule.

## 0. The workflow: concept → spec → implementation → documentation

- **`concept/`** — exploratory ideas, may conflict or be rejected. Not binding.
- **`specs/`** — approved, gap-free, aligned specifications. **The source of truth.**
- **implementation** — follows the relevant spec *precisely*. You may not violate a spec or change one on your own; specs are human-owned and human-reviewed. If a spec is wrong or a gap appears, stop and fix the spec first (or raise it), then implement.
- **`docs/`** — end-user documentation; describes **only shipped behavior**, never planned behavior.

Every change starts from a spec and ends with docs and tests in sync. See [`specs/README.md`](specs/README.md).

## 1. Architecture & file structure

- The code is layered: `contracts ← kernel ← platform ← llm ← domains/forges ← app`. Imports flow one way only. See [`specs/architecture.md`](specs/architecture.md) for the module map and the exclusivity rules (only `llm/backend` imports a model SDK; only `llm/boundary` parses model output; only `platform/env` reads `process.env`; only `platform/session-store` writes artifacts).
- **Every file has one clear home in the structure.** If you can't say which layer/module a file belongs to, the design is wrong — fix the design, don't dump it in a `utils/` bucket. New generic `utils/` folders are prohibited; shared helpers live in `kernel/`.
- **No very large files.** Target ≤ ~300 lines per file; treat > ~400 as a smell to split. A file should do one thing. Large files are almost always multiple responsibilities that belong in separate modules.
- Named exports only. **Functions by default**; classes only for genuine live state.
- **No new singletons.** Dependencies arrive explicitly via `RunContext` or parameters.

## 2. Types & validation

- **One definition per concept.** No parallel hand-written type for something a schema already describes.
- Shared shapes live in `contracts/` as **Zod schemas; TypeScript types are inferred** from them (`z.infer`), never written twice.
- **Validate at every boundary** — model output, config, tool I/O, forge payloads — with the shared schemas. Untrusted/model data is parsed and normalized at its boundary before any domain code sees it (model output: only in `llm/boundary`).

## 3. No fakes in shipped code

- **No mocks, stubs, fake implementations, placeholder returns, or `TODO`-stubbed functions in production code.** If something isn't implemented, it isn't merged. A function either does the real thing or does not exist.
- No hardcoded sample/demo data standing in for real logic. No "temporary" shortcuts that ship.
- Fakes belong **only** in tests (and only via the shared testing helpers).

## 4. Refactor discipline

- No spaghetti: keep concerns isolated, control flow flat, responsibilities single.
- **No duplication** — one home per piece of functionality (see the centralization map in `specs/architecture.md`). Before writing a helper, check `kernel/`; add it there if missing.
- Reduce complexity actively; leave code cleaner than you found it. Separate a *move* from an *edit* in distinct commits/PRs (see `specs/plans/refactor.md` §5 for the reviewable-refactor method).

## 5. Error handling & logging

- All failures normalize to the shared `StructuredError` (`{ code, category, recoverable, exitCode, details }`); no bare `throw`/`catch`-and-ignore, no swallowing.
- One exit point; telemetry is flushed before exit; the gate result drives the exit code.
- Logging is **redaction-safe by construction** — prompts, model output, tokens, and secrets must never reach a log or trace on the default path. Content capture is an explicit opt-in only.
- Log at the right level with structured fields; no `console.log`.

## 6. Security

- Treat all PR-derived text (titles, bodies, comments, diffs) and all model output as untrusted: sanitize before prompt assembly, never execute or eval it, always path-guard file access.
- Tool/shell execution goes through the sandbox with skip-pattern enforcement and secret redaction. Never enable a model backend's built-in tools; QualOps owns its tools.
- No secrets in code, logs, artifacts, or test fixtures.

## 7. Testing

- **Unit tests live side-by-side** with the code: `foo.ts` → `foo.test.ts` in the same folder.
- **Integration and smoke tests live in `tests/`** (they cross module or process boundaries or hit real providers).
- **Coverage ≥ 80%** (statements/lines/functions), enforced in CI. Coverage is a floor, not a goal.
- **Real tests, happy and unhappy paths.** Test observable behavior and error cases — not implementation detail, not trivial getters, no snapshot-only "tests." Every bug fix adds a test that would have caught it.
- **Test files must be excluded from the published package**: only `dist/` is published, and `*.test.ts` is excluded from the library build (`tsconfig.lib.json`). Verify the package tarball contains no test code.

## 8. Documentation

- User docs in `docs/` track **shipped** behavior. If a change alters observable behavior, update `docs/` **in the same PR**. Specs describe intent; docs describe reality; keep both true.
- Update `CHANGELOG.md` for any behavior-affecting change.

## 9. Dependencies

- Minimize them. A new runtime dependency needs justification (what it replaces, its license, its footprint). Prefer the small hand-rolled utilities already in `kernel/`. The model backbone is the Vercel AI SDK (`ai` + `@ai-sdk/*`); see [`concept/08-harness-decision.md`](concept/08-harness-decision.md).

## Commands

```bash
npm run build            # tsc lib build (excludes tests) + alias + copy prompts/agents
npm test                 # unit tests (jest)
npm run test:integration # integration tests
npm run test:smoke       # provider smoke tests (needs creds)
npm run test:evals       # eval harness
npm run lint             # eslint
```

Full engineering standards and the current-behavior/architecture specs are in [`specs/`](specs/README.md).
