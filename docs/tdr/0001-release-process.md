# TDR 0001 — Release process

**Status:** Accepted — 2026-05-11

## Context

Qualops is consumed two ways:

1. As a GitHub Action: `uses: eggai-tech/qualops@<ref>`. The `<ref>` is resolved by GitHub against the repository's git refs (tags or branches).
2. As an npm package: `@eggai/qualops` on the public npm registry.

The release state before (this TDR) had several concrete problems:

- **`stable` ref drift.** The `stable` lightweight git tag had been moved by hand to commit `e313241` (PR #122 "github-integration", Apr 20 2026), roughly 50 commits ahead of the most recent versioned release `v0.2.1` (Mar 14 2026). Anyone consuming `eggai-tech/qualops@stable` was running unreleased code.
- **Known bug under `@stable`.** The github-integration feature that `@stable` pointed at had a documented bug ("Fix GitHub Action post-integration step" in the unreleased changelog), and the fix had never shipped.
- **No `beta` ref.** Internal repos had no separate channel to dogfood pre-release code.
- **No release since Mar 14.** Substantial work had accumulated under `[Unreleased]` (TypeScript 6, ESLint 10, OpenTelemetry, OpenAI/Azure providers, GitHub Models provider, agentic mode, github-integration, init-claude scaffolding, JSON Schema generation, eval severity filter) without a version bump.
- **Workflow flakiness.** `v0.2.1` required three release-PR attempts (#61, #63, #65) before one succeeded; failed attempts left half-created `release/v*` branches behind.
- **npm dist-tag bug.** `.github/workflows/npm-publish.yml` published without a `--tag` flag, so a prerelease publish (`0.3.0-beta.1`) would have silently moved npm's `latest` dist-tag to the prerelease and exposed it to every `npm install @eggai/qualops` consumer.

The release process is designed to:

- Let internal users opt into pre-release code without affecting external clients.
- Move the `@stable` ref through CI, not by hand.
- Version and tag releases consistently, with accurate GitHub Releases.
- Keep the npm `latest` dist-tag stable.

## Decision

Qualops ships on a two-tier release model: `@beta` for internal users and `@stable` for external clients. Both refs are movable lightweight git tags, force-moved by CI on every release or promotion. Versioned tags (`vX.Y.Z`, `vX.Y.Z-beta.N`) are immutable forever.

### Two-tier flow

1. **Beta release.** A maintainer triggers the `Create Release PR` workflow with a version like `0.3.0-beta.1`. After review, the release PR is merged. CI then:
   - Creates the immutable tag `v0.3.0-beta.1`.
   - Publishes `@eggai/qualops@0.3.0-beta.1` to npm with `--tag beta` (so the `latest` dist-tag is untouched).
   - Creates a GitHub Release marked as pre-release.
   - Force-moves the `beta` lightweight tag to the release commit.
2. **Internal soak.** Internal repos consume `uses: eggai-tech/qualops@beta`. The expected soak window is **5–7 days minimum** for a typical minor release; shorter windows are acceptable for low-risk patch releases at the maintainer's discretion.
3. **Promotion to stable.** When a beta is judged ready, a maintainer triggers the `Promote to Stable` workflow with inputs `beta_version`, `stable_version`, and `reason`. CI then:
   - Validates that `@eggai/qualops@$BETA_VERSION` exists on npm and currently carries the `beta` dist-tag.
   - Opens a release PR for `$STABLE_VERSION` from the exact commit that `v$BETA_VERSION` points at. The PR contains only the `package.json` version bump and the `[Unreleased]` → `[$STABLE_VERSION]` changelog move — no source changes.
   - After merge, the publish pipeline ships `@eggai/qualops@$STABLE_VERSION` to npm with the default `latest` dist-tag. The `update-stable-ref` job then force-moves the `stable` lightweight tag to the release commit and edits the GitHub Release to be non-prerelease + `latest`.
4. **Hotfix.** Branch from the `stable` tag (`git checkout -b hotfix/0.3.1 stable`), apply the fix, version as `0.N.M+1`, run the standard release workflow. The publish workflow ships straight to `latest` and the `update-stable-ref` job force-moves `stable` to the new commit. Merge the fix forward to `main` separately.

The `update-stable-ref` job is part of the general publish pipeline, not the promotion workflow — so it fires on **every** non-prerelease publish (promotion, hotfix, or otherwise). The promotion workflow's only responsibility is to open the right release PR.

**Caveat on byte-equivalence:** the promoted stable publish is byte-equivalent to the soaked beta *only if no other PRs landed on `main` between the beta and the promotion*. If main has moved forward, the release PR's merge (squash or otherwise) reconciles with main's new tip, and the stable build can include those newer commits as a side effect. This is the standard pragmatic trade-off; reviewers should check the promotion PR's diff against main before merging. If byte-identical promotion is required, the workaround is to freeze merges to main during the soak window.

### SemVer scheme

Betas iterate as `X.Y.Z-beta.N` (`0.3.0-beta.1`, `0.3.0-beta.2`, …). When a beta is selected for promotion, a **fresh `X.Y.Z`** is published from the same source commit (only `package.json` and `CHANGELOG.md` differ). The promoted artifact is byte-equivalent to the soaked beta in everything that runs at execution time; only the version string in `package.json` changes. This gives consumers clean version numbers while preserving the soak guarantee.

### npm dist-tag policy

- Prerelease publishes use `npm publish --tag beta`.
- Stable publishes use the default (no flag), which writes to the `latest` dist-tag.
- The publish workflow detects prerelease versus stable from the existing `PRERELEASE` job output and selects the flag accordingly.

### Tag movement

- Movable refs (`beta`, `stable`) are lightweight tags.
- Tag pushes always use `--force-with-lease` (never `--force`) to prevent racing promotions from clobbering each other.
- Only the publish and promotion workflows move these tags. Manual movement is explicitly disallowed (documented in `CONTRIBUTING.md`).
- Access control is enforced by the `environment: npm` GitHub environment, which already requires manual approval for any job that uses it. Both the publish and promotion workflows route through this environment.

## Alternatives considered

### Branches instead of lightweight tags

Convert `stable` and `beta` to branches. This matches the `actions/checkout@v4` convention and enables GitHub branch-protection rules (e.g., require status checks before a push). **Rejected** to minimize the change surface — `stable` is already a tag in this repo, and `uses: <repo>@<ref>` resolves tags and branches identically. The branch-protection-rule benefit is real but not load-bearing given that tag movement is already gated by the `environment: npm` approval step.

### Time-based automatic promotion

Promote a beta to stable automatically after N days. **Rejected** because the soak period only has value if a human is actively exercising the beta. Auto-promotion would ship untested code if the internal team happens to be heads-down or on vacation during the window.

### In-place promotion (no fresh stable version)

Promote `0.3.0-beta.2` to stable by moving the `stable` tag to that same commit and re-tagging the npm dist-tag, with no fresh `0.3.0` publish. **Rejected** because consumers who pin via `npm install @eggai/qualops` would end up with `0.3.0-beta.2` in their lockfile, which looks alarming and is a poor signal. The cost of the alternative — one extra `npm publish` per cycle — is small.

### Yank or deprecate `@eggai/qualops@0.2.1` from npm

**Rejected.** The 72-hour unpublish window has passed. The package version itself is correct (it matches its source tag); only the `stable` git ref drifted off it. Deprecating it would mislead consumers into thinking the version itself is faulty.

## Consequences

### For contributors

- The familiar `Create Release PR` workflow remains the entry point for releases. Prerelease versions (`-beta.N`) are first-class and ship with the correct npm dist-tag.
- The `Promote to Stable` workflow is the only mechanism for promoting a beta to stable. Manual movement of the `beta` or `stable` git tags is not permitted.
- Pre-release changelog entries stay under `[Unreleased]`; the workflow intentionally does not move them out until the stable promotion. The intent is documented inline in the workflow.

### For external consumers

- `uses: eggai-tech/qualops@stable` resolves to the most recent commit promoted out of beta.
- `@eggai/qualops` on npm exposes a `beta` dist-tag for users who want to opt in to pre-releases via `npm install @eggai/qualops@beta`.

### For internal consumers

- Internal qualops-using repositories pin `uses: eggai-tech/qualops@beta` to participate in soak testing.
- Repositories that need conservative behaviour stay on `@stable`.

### For operations

- Failure issues from `npm-publish.yml` include the failing stages and release kind in the title, so the retry decision is obvious from the issue list.
- `create-release-pr.yml` cleans up its half-created `release/v*` branch on failure (only the branch this run pushed), preventing the leftover-branch state that previously recurred during retries.

## Implementation

The process is realised by four workflow files and a small amount of documentation:

- `.github/workflows/npm-publish.yml` — conditional `--tag beta` on the publish step; `update-beta-ref` job (force-moves `beta` on prerelease publishes using an explicit-SHA lease); `update-stable-ref` job (force-moves `stable` and marks the GitHub Release as `latest` on stable publishes); failure issues that include the failing stages and release kind.
- `.github/workflows/create-release-pr.yml` — accepts only `(rc|alpha|beta)` prerelease labels; leaves `[Unreleased]` untouched on prereleases; deletes a half-created `release/v*` branch on failure when the cleanup sentinel confirms this run pushed it.
- `.github/workflows/promote-to-stable.yml` — `workflow_dispatch` triggered, gated by the `npm` environment. Validates the beta on npm, asserts `stable_version` matches `beta_version`'s base, branches from `v$BETA_VERSION`, bumps `package.json` + moves CHANGELOG entries, and opens the release PR. Post-merge work flows through `npm-publish.yml`.
- `.github/workflows/ci.yml` — changelog gate treats `release/v*-(rc|alpha|beta).N` PRs like ordinary PRs (requires entries under `[Unreleased]` rather than a versioned heading), so beta release PRs pass CI.
- `CONTRIBUTING.md` — Release Process section documenting the two-tier model, hotfix flow, soak window, and the manual-tag-move ban.
- `website/src/content/docs/releases.mdx` — user-facing release-model documentation.

### Initial cutover (historical)

When this TDR was adopted, the repository state diverged from the model: the `stable` lightweight tag had been hand-moved to an unreleased commit (`e313241`) and no `beta` tag existed. The bootstrap was a single round of the new flow:

1. Run `Create Release PR` with version `0.3.0-beta.1`. Merge the resulting PR.
2. CI publishes `@eggai/qualops@0.3.0-beta.1` (npm dist-tag `beta`), creates the GitHub Release as pre-release, and force-moves the `beta` tag to the release commit.
3. After 5–7 days of internal soak, run `Promote to Stable` with `beta_version=0.3.0-beta.1` and `stable_version=0.3.0`.
4. The promotion run force-moves the previously-misplaced `stable` tag onto the `v0.3.0` commit — no manual cleanup of the old `stable` position was required.

## Open considerations

- **Major-version policy.** The same model applies to a future `1.0.0` release; no separate process is needed.
- **Per-PR canary releases.** Not adopted at this time. Revisit only if the internal soak loop proves too slow for the work in flight.
- **`stable_version` ≠ `beta_version` base.** Currently enforced at workflow input validation. If a workflow ever needs to promote across versions (e.g., skip a stable for some reason), that constraint would need to be relaxed.
