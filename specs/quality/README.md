# Spec — Quality Standards (overview)

**Status:** Approved — EggAI, 2026-07-08 · Binding engineering quality bar. [`../../CLAUDE.md`](../../CLAUDE.md) is the short enforceable summary; these specs are the detailed home. Applies to all code from the refactor onward.

| Standard | Spec |
|---|---|
| Testing & coverage | [testing.md](testing.md) |
| Error handling & exit codes | [error-handling.md](error-handling.md) |
| Logging | [logging.md](logging.md) |
| Security | [security.md](security.md) |
| Dependencies & supply chain | [dependencies.md](dependencies.md) |

## Cross-cutting principles

- **No fakes in shipped code.** No mocks, stubs, fake implementations, placeholder returns, hardcoded sample data, or `TODO`-stubbed functions in production code. A function does the real thing or does not exist. Nothing "temporary" ships. Dead code (e.g. the commented-out rollback-metadata writes, vestigial fields) is removed, not left in place ([`../behavior/pipeline/fix.md`](../behavior/pipeline/fix.md)). Fakes belong only in tests → [testing.md](testing.md).
- **Docs & change hygiene.** The `website/` describes **shipped** behavior; update it in the **same PR** as any observable change. Specs describe intent; the website describes reality. Full standard: [`../documentation.md`](../documentation.md). `CHANGELOG.md` is updated for every behavior-affecting change (refactor buckets B and C get changelog entries; bucket C also gets a release note — [`../plans/refactor.md`](../plans/refactor.md) §4).
- **Reviewable-refactor method** (move ≠ edit, strangler shims, characterization tests, one-singleton-at-a-time) is normative for the refactor — [`../plans/refactor.md`](../plans/refactor.md) §5.
