# Spec — Integrations (overview)

**Status:** Approved — EggAI, 2026-07-08 · Current behavior the refactor **preserves**; it wraps providers behind the two ports ([`../../architecture.md`](../../architecture.md) §3) and de-duplicates forge code into `forges/core`. The model-backbone swap to the Vercel AI SDK and the fingerprint-based posting protocol are **later phases** (`concept/08`, `concept/02`).

| Spec | Scope |
|---|---|
| [providers.md](providers.md) | AI providers, dialect routing, cost & retries |
| [github.md](github.md) | GitHub posting: summary comment, Checks annotations, gating |
| [gitlab.md](gitlab.md) | GitLab posting: summary comment, discussions, dedup, gating |

Forge posting behavior is preserved by the refactor; only the shared code moves to `forges/core`. Known posting limitations that the refactor does **not** fix (they motivate the future protocol in `concept/02` §7) are recorded per forge.
