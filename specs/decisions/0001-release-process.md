# Decision 0001 — Two-tier release model

**Status:** Accepted — 2026-05-11 · **Normative spec:** [`../operations/release.md`](../operations/release.md)

## Context

QualOps ships as a GitHub Action (`@<ref>`) and an npm package. Before this decision the `stable` git tag had been hand-moved ~50 commits past the last versioned release (exposing unreleased, buggy code), there was no `beta` channel, no release since Mar 2026, flaky release workflows, and an npm publish that lacked `--tag` (so a prerelease would have moved `latest` for every consumer).

## Decision

A two-tier model — `@beta` (internal soak) and `@stable` (external) — on movable lightweight git tags force-moved only by CI, with immutable version tags, a fresh `X.Y.Z` published on promotion from the beta's commit, and an npm dist-tag policy that keeps `latest` off prereleases. Full contract: the normative spec.

## Alternatives considered

- **Branches instead of lightweight tags** — rejected: minimizes change surface (`stable` was already a tag; `@<ref>` resolves both identically); tag movement is already gated by the `npm` environment approval.
- **Time-based auto-promotion** — rejected: soak only has value while a human actively exercises the beta.
- **In-place promotion (no fresh `X.Y.Z`)** — rejected: consumers pinning via npm would get a `-beta.N` string in their lockfile.
- **Yank/deprecate the drifted `0.2.1`** — rejected: the version itself was correct; only the `stable` ref had drifted.

## Consequences

Prerelease versions are first-class; the `Promote to Stable` workflow is the only promotion path; manual tag movement is banned; external consumers get a `beta` opt-in dist-tag. Realized by the release CI workflows (implementation).
