# Spec — Custom review agents (current mechanism)

**Status:** Approved — EggAI, 2026-07-08 · Domain: configuration · Overview: [README.md](README.md)

How a user adds a reviewer sub-agent to an agentic job today. *(The richer folder-based reviewer model is future — `concept/04`.)*

## Two mechanisms

| Mechanism | Shape |
|---|---|
| **Inline** | `agentic.customAgents[]` — `{ name, description, prompt, tools?, model? }` |
| **File-based** | drop `<name>.md` into `.qualops/agents/` — frontmatter (`description`, `tools`, `model`) + a prompt body; the filename is the agent name |

## Built-in subagents

Selectable via `enabledSubagents` (enum): `dependency-tracer`, `breaking-change-detector`, `security-analyzer`, `pattern-validator`.

## Correction

- ⚠ Post-refactor hardening: the file-based frontmatter parser becomes a **real, schema-validated YAML parser with loud errors** (today it is a hand-rolled parser that silently ignores malformed frontmatter). Format and location are unchanged. Bucket B. Parser home: `kernel/markdown` ([`../../architecture.md`](../../architecture.md) §6).
