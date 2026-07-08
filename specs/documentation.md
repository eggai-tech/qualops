# Spec — Documentation

**Status:** Draft (authored 2026-07-08) — pending spec-readiness-review + human approval · **Owner:** TBD · Source: user requirement (root README + `docs/` standard), aligned with [`quality/README.md`](quality/README.md) and [`../CLAUDE.md`](../CLAUDE.md) §8.

Defines the shape and upkeep rules for user-facing documentation: the root `README.md` and the `docs/` tree. It governs **structure and hygiene**, not the prose itself (writing/porting the pages is the documentation phase of implementation). Rule of record: `specs/` = intent, `concept/` = exploration, **`docs/` = shipped behavior only**.

## 1. Scope

**In:** root `README.md`; the `docs/` folder (structure, index, hygiene); the relationship between `docs/` and the `website/` (Starlight) presentation layer. **Out (N/A here):** the page content, the config reference generation, and the API/action reference generation (owned by the documentation-phase work and existing sync scripts).

## 2. Requirements

Each is verifiable; IDs are stable for traceability.

### Root README
- **DOC-1 — Crisp intro.** The README opens with a one- to two-paragraph plain-language statement of what QualOps is and the value it delivers, followed by a minimal feature list. No deep architecture, no exhaustive option tables.
- **DOC-2 — Quick start / setup / usage.** The README contains a runnable quick start: install, the single required credential, a zero-config CLI run, and the minimal GitHub Action snippet. Enough to get a first review; nothing more.
- **DOC-3 — Table of contents into `docs/`.** The README carries a TOC that links into `docs/` by top-level section. The TOC is the navigation surface; it points to depth rather than inlining it.
- **DOC-4 — README stays short.** Budget: the README fits comfortably on a couple of screens (target ≤ ~150 lines). Anything beyond quick start (full config, provider matrix, review modes, CLI reference, troubleshooting) lives in `docs/` and is linked, not duplicated.
- **DOC-5 — README in sync.** Any change to install, credentials, the zero-config path, or the Action interface updates the README in the same PR.

### `docs/` folder
- **DOC-6 — Nested by reader journey.** `docs/` is organized so a reader progresses from high-level to advanced without the structure announcing itself: overview → getting started → understanding (how it works) → configuration → customizing/extending → guides → reference → troubleshooting (§3). Each page covers one topic.
- **DOC-7 — Concise, no duplication.** Each fact has one home; pages link rather than repeat. Prefer short focused pages over long omnibus ones (mirrors the file-size discipline in [`architecture.md`](architecture.md) §5).
- **DOC-8 — Shipped behavior only.** `docs/` describes what the released version does. It never documents planned or concept-stage behavior; updated in the same PR as any observable change (with [`quality/README.md`](quality/README.md)).
- **DOC-9 — Index mirrors the README TOC.** `docs/` has an index (`docs/README.md`) listing its sections; the root README TOC (DOC-3) and this index stay consistent — every top-level `docs/` section appears in the README TOC and vice versa.
- **DOC-10 — No dead links, no stubs pretending to be content.** All internal doc links resolve; a page is either real content or absent (no "coming soon" placeholders masquerading as documentation).

### `docs/` ↔ `website/`
- **DOC-11 — `docs/` is the authored source of truth.** The Starlight `website/` is a presentation/publishing layer that syncs from `docs/` and root files (the existing `sync-root-docs.mjs` / `gen-action-docs.mjs` scripts). Canonical content is authored in `docs/` (plain Markdown, readable in-repo), not solely in website pages. *(Confirm at readiness: this codifies the existing sync direction; if the team wants website-first authoring instead, that reverses DOC-11.)*

## 3. Target `docs/` structure

Recommended shape (not every file enumerated; the ownership boundaries are the contract):

```
docs/
├── README.md              # index; mirrors the root README TOC (DOC-9)
├── overview.md            # what it is + the review philosophy, plain language
├── getting-started/       # install · GitHub Action quickstart · CLI · first review
├── understanding/         # how it works (pipeline in plain terms) · findings & severity · the gate
├── configuration/         # config file · providers · review pipeline/modes · quality gate
├── customizing/           # custom review agents · prompts · (future: reviewers/rules)
├── guides/                # GitHub setup · GitLab setup · monorepos · self-hosted models
├── reference/             # CLI · config schema · env vars · exit codes · Action inputs/outputs
└── troubleshooting.md
```

Current state (not a violation, just the starting point): `docs/` holds only `github-setup.md` (→ `guides/`), and `website/` carries several "coming soon" stubs. Populating this structure is the documentation-phase deliverable; content is written against **shipped** behavior and evolves per implementation phase.

## 4. Acceptance & verification

- **AC-1 (DOC-3, DOC-9, DOC-10):** CI runs a Markdown link check across `README.md` and `docs/`; dead links fail the build. A consistency check asserts the README TOC and `docs/README.md` index list the same top-level sections.
- **AC-2 (DOC-4):** CI flags a README exceeding the length budget.
- **AC-3 (DOC-5, DOC-8):** PR review verifies README/`docs/` were updated when observable behavior changed (checklist item; also enforced socially via `CLAUDE.md`). A doc that describes unshipped behavior is a review blocker.
- **AC-4 (DOC-1, DOC-2, DOC-6, DOC-7):** human review at documentation-phase acceptance confirms the intro is crisp, quick start runs, and the tree follows §3.
- **AC-5 (DOC-11):** the website build consumes `docs/`; no canonical content exists only under `website/`.

## 5. Open items for readiness review

- DOC-11 authoring direction (docs-first vs website-first) — recommend docs-first (matches existing sync scripts); confirm.
- Exact README length budget number (proposed ≤ ~150 lines) — confirm or set.
- Whether the CI link-check / TOC-consistency / length checks are added in this refactor round or the documentation phase (they touch CI config, not `src/`).
