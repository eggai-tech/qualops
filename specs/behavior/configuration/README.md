# Spec — Configuration & CLI surface (overview)

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · The current user-facing surface, which the refactor **preserves** (config format, CLI flags, and Action inputs are unchanged — [`../../plans/refactor.md`](../../plans/refactor.md) §2). The `qualops-config.schema.json` / `src/config/config-schema.ts` Zod schema is the machine source of truth. The future folder-based config model is a separate phase in `concept/04-configuration-spec.md` and is **not** part of this baseline.

| Spec | Surface |
|---|---|
| [cli.md](cli.md) | `qualops` commands, flags, defaults, stage selection, file selection |
| [config-file.md](config-file.md) | `.qualopsrc.json` sections (live/deprecated) + zero-config defaults |
| [action-and-env.md](action-and-env.md) | GitHub Action inputs/outputs; environment variables |
| [custom-agents.md](custom-agents.md) | how a user adds a reviewer sub-agent today |
