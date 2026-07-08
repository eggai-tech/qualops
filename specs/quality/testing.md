# Spec — Testing & coverage

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: quality · Overview: [README.md](README.md)

- **Unit tests are colocated** with the code they test: `foo.ts` → `foo.test.ts` in the same folder. They test one module, with its dependencies provided as arguments (no global state).
- **Integration and smoke tests live in `tests/`**: integration exercises multiple modules or the full pipeline with the AI provider faked; smoke exercises real providers (credentialed, opt-in, excluded from the default `npm test`).
- **Coverage ≥ 80%** for statements, lines, and functions, **enforced in CI** via the Jest coverage threshold. Coverage is a floor, not a target — high coverage of trivial assertions is not quality.
- **Real tests, happy and unhappy paths.** Every module tests its success behavior *and* its error/edge behavior (invalid input, provider failure, empty results, boundary values). No snapshot-only tests standing in for assertions; no tests of private implementation detail. Every bug fix adds a regression test that fails before the fix.
- **Fakes only in tests.** Production code contains no mocks/stubs/placeholder implementations (see the no-fakes principle in [README.md](README.md)). Test fakes use the shared testing helpers where available.
- **Test files are excluded from the published package.** Only `dist/` is published (`package.json` `files`); `*.test.ts` is excluded from the library build (`tsconfig.lib.json`) so no test code compiles into `dist/`. CI verifies the packed tarball contains no test files.
