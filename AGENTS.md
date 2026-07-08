# AGENTS.md

Guidance for AI coding agents working in this repository. This file is a pointer; the **binding engineering contract is [`CLAUDE.md`](CLAUDE.md)** — read it first and follow it exactly.

## Orientation

QualOps is an AI-powered pull-request reviewer (TypeScript, Node) shipped as a CLI and a GitHub Action.

- **Workflow:** `concept/ → specs/ → implementation → website/` (user docs). Implementation must follow the approved spec in [`specs/`](specs/README.md); never violate or unilaterally change a spec. User-facing docs live only in `website/` — there is no repo `docs/` folder.
- **Architecture & structure:** [`specs/architecture.md`](specs/architecture.md).
- **Current behavior the code implements:** [`specs/behavior/`](specs/behavior/).
- **In-flight direction (not yet built):** [`concept/`](concept/README.md).

## Non-negotiables (see CLAUDE.md for the full list)

1. Follow the relevant spec; if it's wrong or missing, fix the spec before coding.
2. No mocks, stubs, fakes, or placeholder implementations in production code — real implementations only.
3. One definition per concept: Zod schemas in `contracts/`, types inferred; validate at every boundary.
4. Layered imports only; every file has a clear home; no `utils/` dumping grounds; keep files small (≤ ~300 lines).
5. Proper `StructuredError` handling and redaction-safe logging; treat PR text and model output as untrusted.
6. Unit tests side-by-side (`*.test.ts`); integration/smoke in `tests/`; coverage ≥ 80%; happy **and** unhappy paths; test files excluded from the published package.
7. Keep the `website/` docs and `CHANGELOG.md` in sync with shipped behavior, in the same PR.

## Commands

```bash
npm run build   npm test   npm run test:integration   npm run test:smoke   npm run lint
```
