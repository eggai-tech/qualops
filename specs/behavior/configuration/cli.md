# Spec — CLI

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · Domain: configuration · Overview: [README.md](README.md)

Binary `qualops` (commander). Running it with no subcommand runs the stage pipeline.

## Global options

| Flag | Default | Purpose |
|---|---|---|
| `-c/--config <path>` | `.qualops/.qualopsrc.json` | config file |
| `-b/--base <ref>` | `main` | base ref for the diff |
| `-h/--head <ref>` | HEAD | head ref (note: `-h` is bound to head, not help) |
| `-f/--files <paths>` | — | comma-separated / globs |
| `-s/--stages <list\|all>` | `all` | stage selection |
| `-n/--name <session>` | timestamp | session name |
| `--report-root <name>` | `.qualops/reports` | report root |
| `--fix-apply` | off | apply fixes |
| `--include-medium` / `--exclude-medium` | — | medium severity in fixes |
| `--skip-cache` | off | force fresh analysis |

## Subcommands

`all` (alias of default) · `generate-index` (`--filter <pattern>`) · `validate` (config-only check; prints deprecation/unknown-field warnings) · `init-claude` (`--provider anthropic\|openai\|bedrock`, scaffolds `.qualops/`) · `github-integration` (posts results; run after the pipeline).

## Selection rules

- **File selection:** comma-split; entries with `*`/`{`/`?` are globs (ignoring `skipPatterns`); plain paths must exist.
- **Stages:** default `all`; dependencies enforced and topologically ordered ([`../pipeline/README.md`](../pipeline/README.md)).

## Corrections / open items

- ⚠ (F-6) `--skip-cache`/resume behavior is made explicit — [`../pipeline/README.md`](../pipeline/README.md) (Orchestration).
- **Open discrepancy:** `--include-medium`/`--exclude-medium` are currently non-functional (fix selection is hardcoded) — tied to the fix-selection decision in [`../pipeline/fix.md`](../pipeline/fix.md).
