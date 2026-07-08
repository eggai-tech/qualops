# Spec — Dependencies & supply chain

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: quality · Overview: [README.md](README.md)

- Minimize runtime dependencies; a new one needs a stated justification (what it replaces, license, footprint). Prefer the small tested utilities in `kernel/` ([`../architecture.md`](../architecture.md) §6).
- The model backbone is the Vercel AI SDK (`ai` + `@ai-sdk/*`), wired per-provider as optional peer dependencies ([`../../concept/08-harness-decision.md`](../../concept/08-harness-decision.md)); the retired `@openai/agents` and `@eggai/configurable-agent` are not reintroduced.
- Prefer current, stable, well-licensed versions; record the rationale for any older pin.
