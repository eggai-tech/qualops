# Spec — Documentation

**Status:** Approved — EggAI, 2026-07-08 · **Owner:** EggAI · Source: user requirement (root README + user-docs standard), aligned with [`quality/README.md`](quality/README.md) and [`../CLAUDE.md`](../CLAUDE.md) §8.

Defines the shape and upkeep rules for user-facing documentation: the root `README.md` and the documentation **website** (`website/`, Astro/Starlight). It governs **structure and hygiene**, not the prose itself (writing the pages is documentation-phase work). Rule of record: `specs/` = intent, `concept/` = exploration, **the website = shipped-behavior user docs**.

## 1. Decision: website-only

There is **no repo-root `docs/` folder.** All user-facing documentation lives in the `website/` (Astro/Starlight) and is authored there directly. *(The former `docs/` folder is removed and its content migrated into the website.)* The website may still sync a few root files that are their own source of truth (`CHANGELOG.md`, `CONTRIBUTING.md`) and generate reference pages from `action.yml`; it does **not** depend on a `docs/` folder.

## 2. Scope

**In:** root `README.md`; the website's documentation content and structure; the README↔website relationship. **Out (N/A here):** page prose, and the generated config/action reference (owned by documentation-phase work and the existing generator scripts).

## 3. Requirements

### Root README
- **DOC-1 — Crisp intro.** Opens with a one- to two-paragraph plain-language statement of what QualOps is and the value it delivers, then a minimal feature list. No deep architecture, no exhaustive option tables.
- **DOC-2 — Quick start / setup / usage.** A runnable quick start: install, the single required credential, a zero-config CLI run, and the minimal GitHub Action snippet. Enough for a first review; nothing more.
- **DOC-3 — Table of contents into the website.** The README carries a TOC linking to the documentation **website** by top-level section. The TOC is the navigation surface; it points to depth rather than inlining it.
- **DOC-4 — Short, crisp, precise.** The README stays short and to the point — **no fixed line limit**, but anything beyond quick start (full config, provider matrix, review modes, CLI reference, troubleshooting) lives on the website and is linked, not duplicated.
- **DOC-5 — README in sync.** Any change to install, credentials, the zero-config path, or the Action interface updates the README in the same PR.

### Documentation website
- **DOC-6 — Nested by reader journey.** Content is organized so a reader progresses from high-level to advanced without the structure announcing itself: overview → getting started → understanding (how it works) → configuration → customizing/extending → guides → reference → troubleshooting (§4). One topic per page.
- **DOC-7 — Concise, no duplication.** Each fact has one home; pages link rather than repeat. Prefer short focused pages over long omnibus ones (mirrors the file-size discipline in [`architecture.md`](architecture.md) §5).
- **DOC-8 — Shipped behavior only.** The website describes what the released version does. It never documents planned or concept-stage behavior; updated in the same PR as any observable change (with [`quality/README.md`](quality/README.md)).
- **DOC-9 — README TOC ↔ website nav consistency.** Every top-level website section appears in the README TOC and vice versa; the website sidebar (`astro.config.mjs`) and the README TOC stay aligned.
- **DOC-10 — No dead links, no stubs.** All internal doc links resolve; a page is either real content or absent — no "coming soon" placeholders masquerading as documentation.
- **DOC-11 — Website is the single source of user docs.** Canonical user documentation is authored in `website/`; there is no repo `docs/` folder to keep in sync. Root files that are their own source (`CHANGELOG.md`, `CONTRIBUTING.md`) and generated reference (from `action.yml`) may be pulled in by the website's build scripts.

## 4. Target website structure

Recommended shape under `website/src/content/docs/` (ownership boundaries are the contract, not an exhaustive file list):

```
overview                 # what it is + the review philosophy, plain language
getting-started/         # install · GitHub Action quickstart · CLI · first review
understanding/           # how it works (pipeline in plain terms) · findings & severity · the gate
configuration/           # config file · providers · review pipeline/modes · quality gate
customizing/             # custom review agents · prompts · (future: reviewers/rules)
guides/                  # github-action/setup · GitLab setup · monorepos · self-hosted models
reference/               # CLI · config schema · env vars · exit codes · Action inputs/outputs
troubleshooting
```

Current state (starting point, not a violation): the Starlight site has several "coming soon" stubs; the migrated GitHub-Action setup guide lives under `guides/`. Populating this structure is documentation-phase work, written against **shipped** behavior and evolving per implementation phase.

## 5. Acceptance & verification

- **AC-1 (DOC-3, DOC-9, DOC-10):** a Markdown/link check across `README.md` and the website content; dead links fail the build. A consistency check asserts the README TOC and the website top-level sections match.
- **AC-2 (DOC-1, DOC-2, DOC-6, DOC-7):** human review at documentation-phase acceptance confirms the intro is crisp, the quick start runs, and the tree follows §4.
- **AC-3 (DOC-5, DOC-8, DOC-11):** PR review verifies README/website were updated when observable behavior changed; a page describing unshipped behavior is a review blocker; no canonical user content exists only outside `website/`.

## 6. Decisions recorded (this baseline)

- **Website-only** (DOC-1, DOC-11): no repo `docs/` folder — EggAI decision 2026-07-08.
- **README length:** no fixed limit; short/crisp/precise (DOC-4).
- **CI doc-checks** (link-check, TOC↔nav consistency): added in the **documentation phase**, not the structure refactor (they touch CI config, not `src/`).
