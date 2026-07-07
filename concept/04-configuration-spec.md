# 04 — Configuration Specification

**Status:** Draft spec for human review · Terms per [01-goals-and-glossary.md](01-goals-and-glossary.md). Motivating audit evidence and the full decision rationale (YAML choice, markdown-as-config risks, rejected alternatives): this spec's §6 and appendix A. Inspiration: Vercel Eve's file-tree-as-definition, Claude Code subagents, Renovate presets, Greptile dual-format rules, ESLint's cascading regret.

## 1. Mental model (one sentence)

> **Your review team is a folder: each reviewer is a markdown file, house rules live in `REVIEW.md`, and one small `config.yaml` holds the knobs.**

```
.qualops/
├── config.yaml            # ≤25 lines: model, gate, extends, toggles ($schema-backed)
├── REVIEW.md              # highest-priority review policy, plain prose        (optional)
├── reviewers/*.md         # the pipeline: one review step per file             (optional)
└── rules/
    ├── rules.yaml         # structured rules: id, scope, severity              (optional)
    └── learned/           # rules the tool proposed, merged via PR             (optional)
```

Progressive disclosure — each tier is a strict superset; leveling up never requires rewriting:

| Tier | User writes | Gets |
|---|---|---|
| 0 | nothing (an API-key env var) | default review team, balanced profile, honest zero-config (no stage may error for lacking config); `AGENTS.md`/`CLAUDE.md` read as context automatically |
| 1 | `config.yaml`, often one line | profile, presets via `extends`, model slug, gate thresholds |
| 2 | `REVIEW.md` | team policy prose injected as the top-priority instruction block for every reviewer |
| 3 | `reviewers/*.md` | custom review steps / replaced or disabled built-ins |
| 4 | `rules/` | scoped, identifiable, lifecycle-managed rules; learned-rule PRs |

## 2. `config.yaml` (normative surface)

```yaml
extends: [qualops:recommended, github>my-org/qualops-preset]   # optional, Renovate-style
model: anthropic/claude-sonnet-4-6    # ONE slug; provider inferred; pricing from catalog
models:                               # optional per-role overrides
  verify: openai/gpt-5.2              # cross-model verification (D9)
  fix: anthropic/claude-haiku-4-5
profile: balanced                     # chill | balanced | strict
gate:
  maxCritical: 0
  maxHigh: 0
  baseline: true                      # fail only on findings the PR introduces
tiering:
  sensitivePaths: ["src/auth/**", ".github/workflows/**"]
verification:
  minConfidence: 80                   # verifier confidence 0–100 (D1)
reviewers:
  disable: [conventions]
publish:
  maxInlineFindings: 25
memory:
  feedbackSuppression: true
pricing: {}                           # optional override ONLY (self-hosted/negotiated rates)
```

Rules: every key optional; unknown keys are hard errors everywhere (**no `.passthrough()` anywhere** — kills the silent-typo trap); env vars are overrides only, never the sole home of a setting (gate thresholds move into the file, F-4); JSON accepted alongside YAML; `$schema` published to SchemaStore.

**Precedence (flat, explicit, printable):** `org preset (extends) < repo config.yaml < REVIEW.md < reviewer frontmatter < rules matching changed paths`. Path scoping is by changed-file matching only — no ambient directory cascading (ESLint's lesson). `qualops config --pr` prints the resolved result and where each value came from.

## 3. Reviewers (`reviewers/*.md`)

Filename = reviewer name. Frontmatter = knobs (real YAML, schema-validated against `contracts/config`, unknown keys are errors — the current silently-failing parser is explicitly banned). Body = instructions.

```markdown
---
description: Deep-dives authentication and secret handling
paths: ["src/auth/**", "**/*.env*"]        # runs only when these change; omit = always
mode: agent                                 # checklist | agent
model: anthropic/claude-opus-4-6            # optional override
tools: [read, grep, usages, bash]           # agent mode capability allowlist
severityFloor: high
budget: { maxTurns: 30, maxUsd: 2 }
enabled: true
---
You are a security specialist. Trace how user-controlled data reaches
authentication, session, and secret-handling code in this diff.

Do NOT flag: theoretical DoS, rate limiting, defense-in-depth suggestions
when primary defenses are adequate.
```

- **Two modes replace five legacy nouns** (D6): `checklist` (one structured pass over assembled context) and `agent` (tool-using investigation).
- **Built-in reviewers ship in this exact format**; `qualops init` can materialize them into `reviewers/` — customizing starts with copying, and the default pipeline documents itself. Same-named user file overrides a built-in; `enabled: false` or `reviewers.disable` turns one off.
- Platform-owned prompt parts (output schema, response format, verification wiring) are invisible and non-overridable — the legacy `<response_format>` footgun ceases to exist.
- Only the body is required; every frontmatter key has a default.

## 4. Rules (`rules/`)

Structured where lifecycle matters, prose where examples matter (Greptile's dual format):

```yaml
# rules/rules.yaml
- id: no-raw-sql
  rule: Use parameterized queries. Never interpolate user input into SQL strings.
  scope: ["src/db/**"]
  severity: high
```

IDs enable per-package opt-out (`rulesDisable:` in reviewer frontmatter), per-rule **last-fired telemetry** ("is this rule doing anything?"), and the learned-rule lifecycle: `@qualops remember <fact>` and approved suggestions land as **PRs adding files under `rules/learned/`** — config that writes itself, reviewable like code, no dashboard split-brain (D7). Free-form prose rules with code examples belong in `REVIEW.md` or a rule's markdown body.

## 5. Tooling contract

| Command | Behavior |
|---|---|
| `qualops init` | native wizard (no Claude Code dependency): detect provider env, choose profile, optionally materialize built-ins; alternatively an onboarding PR showing what the default team would do on a recent real PR |
| `qualops config --pr [ref]` | effective config for a diff: which reviewers/rules fire, every value's origin |
| `qualops doctor` | env/key checks, reviewers whose `paths` never match, rules never fired, missing NOT-to-flag sections, stale learned rules |
| `qualops validate` | CI check; loud errors with did-you-mean on typos |
| `qualops eval` | run the review team against fixture PRs/slices — config changes become testable ([05-quality-spec.md](05-quality-spec.md) §6); a differentiator no competitor ships |
| `qualops baseline` | capture/update the base-branch fingerprint baseline |
| `qualops migrate` | mechanical `.qualopsrc.json` → new layout |

**Consistency by construction:** README examples, `init` output, the JSON schema, and the (shrunken) `qualops-llm.txt` are generated in CI from the same contracts + built-in reviewer files — the current three-contradicting-doors failure becomes impossible.

## 6. Settled decisions & accepted costs

- **YAML core file** (comments; category convention) with JSON accepted; one parser dependency accepted against the minimal-deps principle because the file is ≤25 lines (D4). TOML and config-in-TS rejected (flat-key sprawl; an Actions-first tool must not require a TS toolchain to configure).
- **Markdown-as-config risks mitigated**: schema-validated frontmatter with hard unknown-key errors; docs teach measurable rules; `doctor` + `eval` make prompt quality observable; length guidance + soft cap (long policy dilutes — Claude REVIEW.md evidence).
- **Pricing fields deleted**, not improved (D5): catalog-derived, optional override retained.
- **Given up deliberately**: per-invocation override of arbitrary settings (curated flags only: `--profile`, `--reviewers`, `--gate`); wiki/dashboard config; old-schema compatibility beyond `qualops migrate` + one transition release with warnings (D10). Breaking-change honesty: the current surface's non-validating README examples and contradicting init leave little continuity worth preserving; the old schema's information content maps 1:1 onto the new layout.
