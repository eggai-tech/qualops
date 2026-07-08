# Spec — Logging

**Status:** Approved — EggAI, 2026-07-08 · Domain: quality · Overview: [README.md](README.md)

- **Redaction-safe by construction:** the default log path drops fields whose keys look like prompts/content/tokens/secrets and truncates large values, so a prompt or secret cannot be logged by accident.
- Structured, level-appropriate logging (`debug|info|warn|error`); **no `console.log`** in production code. The logger honors the configured `logger` block and the `--config` path (⚠ F-26 — [`../plans/refactor.md`](../plans/refactor.md) §4).
- Content capture (full prompts/responses) is an **explicit observability opt-in** only (Langfuse/OTel), never the default.
