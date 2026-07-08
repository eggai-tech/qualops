# Contributing to QualOps

Thank you for your interest in contributing to QualOps! This document provides guidelines and instructions for contributing.

## Development Setup

```bash
# Clone the repository
git clone https://github.com/eggai-tech/qualops.git
cd qualops

# Install dependencies
npm install

# Run tests
npm test

# Run linting
npm run lint

# Build
npm run build
```

## Making Changes

### Branch Naming

Use descriptive branch names:
- `feat/` - New features
- `fix/` - Bug fixes
- `docs/` - Documentation changes
- `refactor/` - Code refactoring
- `chore/` - Maintenance tasks

### Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add new review pass for security checks
fix: handle empty file arrays in pipeline
docs: update README with new configuration options
chore: update dependencies
```

### Updating the Changelog

**Every PR must update `CHANGELOG.md`** under the `[Unreleased]` section (unless it's a documentation-only or CI change).

Add your changes under the appropriate subsection:

```markdown
## [Unreleased]

### Added
- New feature description

### Changed
- Change description

### Fixed
- Bug fix description

### Removed
- Removed feature description
```

PRs that only touch `docs/`, `.github/`, `examples/`, or root config files are auto-skipped by CI — no label needed.

## Pull Request Process

1. Create a feature branch from `main`
2. Make your changes
3. Update `CHANGELOG.md` under `[Unreleased]`
4. Ensure all tests pass: `npm test`
5. Ensure linting passes: `npm run lint`
6. Create a Pull Request to `main`
7. Wait for CI to pass and request review

### PR Requirements

- All CI checks must pass
- At least one approval required
- Changelog must be updated (or `skip-changelog` label applied)

## Release Process

QualOps ships on **two tiers**:

- **`@beta`** — pre-release track for internal users. Consumed as `uses: eggai-tech/qualops@beta` or `npm install @eggai/qualops@beta`.
- **`@stable`** — production track for external clients. Consumed as `uses: eggai-tech/qualops@stable` or the default `npm install @eggai/qualops`.

`beta` and `stable` are **movable lightweight git tags**. They are moved automatically by CI on every release or promotion. **Never move them by hand.** If you find them out of sync, see [`specs/adr/0001-release-process.md`](specs/adr/0001-release-process.md).

### Cutting a beta release

1. Make sure `[Unreleased]` in `CHANGELOG.md` reflects all the changes you intend to ship.
2. Go to **Actions** → **Create Release PR** → **Run workflow**.
3. Enter a pre-release version, e.g. `0.3.0-beta.1`.
4. Review the PR the workflow opens. It bumps `package.json` only — `[Unreleased]` is intentionally left untouched on beta releases.
5. Merge the PR. CI will:
   - Tag the commit `v0.3.0-beta.1` (immutable).
   - Publish `@eggai/qualops@0.3.0-beta.1` to npm with the `beta` dist-tag (`latest` is not touched).
   - Create a GitHub Release marked as pre-release.
   - Force-move the `beta` git tag to the release commit.

### Promoting a beta to stable

Soak the beta for **at least 5–7 days** by running it against internal workloads. When you're confident:

1. Go to **Actions** → **Promote to Stable** → **Run workflow**.
2. Fill in:
   - `beta_version`: the beta you want to promote (e.g., `0.3.0-beta.1`).
   - `stable_version`: the clean version (e.g., `0.3.0`).
   - `reason`: short justification — gets surfaced in the PR and the audit log.
3. The workflow:
   - Verifies the beta exists on npm with the `beta` dist-tag.
   - Branches off the exact commit that `v$BETA_VERSION` tags.
   - Bumps `package.json` to `$STABLE_VERSION` and moves `[Unreleased]` entries into `[$STABLE_VERSION]`.
   - Opens a release PR labelled `promotion`.
4. Review the PR. Check the diff against `main` — if other PRs have landed since the beta, decide whether those changes need additional soaking before promotion.
5. Merge the PR. CI will:
   - Tag `v0.3.0`.
   - Publish `@eggai/qualops@0.3.0` to npm with the default `latest` dist-tag.
   - Create a GitHub Release.
   - Force-move the `stable` git tag and mark the release as `--latest`.

### Hotfixes

For an urgent fix to the current stable without going through beta:

1. `git checkout -b hotfix/0.3.1 stable` (branch directly off the `stable` tag).
2. Apply the fix and update `CHANGELOG.md` under `[Unreleased]`.
3. Run **Create Release PR** with `0.3.1`. Merge.
4. CI publishes `@eggai/qualops@0.3.1` to `latest` and force-moves `stable` to the new commit.
5. Open a separate PR to merge the fix forward into `main`.

### Version guidelines

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.0.0`): Breaking changes.
- **MINOR** (`0.3.0`): New features, backward compatible.
- **PATCH** (`0.3.1`): Bug fixes, backward compatible.

Pre-release suffix: `-beta.N` (e.g., `0.3.0-beta.1`, `0.3.0-beta.2`). The `-rc.N` and `-alpha.N` suffixes are also accepted by the workflow and follow the same dist-tag handling as `-beta`.

### Troubleshooting

- **`stable` and `beta` git tags point at unexpected commits.** Do not move them manually. Open an issue — the recovery path is to run a `Promote to Stable` (or `Create Release PR` for beta) for the version you want them to point at; CI will overwrite the tag.
- **A release workflow fails partway.** Check the auto-generated failure issue — it lists which stage failed. If `publish-npm` succeeded but a later stage failed, re-running the workflow is safe (later stages are idempotent). If `publish-npm` itself failed, check npm for partial state before retrying.
- **`Create Release PR` left a `release/v*` branch behind after a failure.** Delete it manually with `git push origin --delete release/vX.Y.Z` and re-run.

The full design rationale lives in [`specs/adr/0001-release-process.md`](specs/adr/0001-release-process.md).

## Code Style

- TypeScript with strict mode
- ESLint + Prettier for formatting
- Run `npm run lint:fix` before committing

## Testing

```bash
# Run all tests
npm test

# Run specific test file
npx jest path/to/test.spec.ts

# Run tests in watch mode
npx jest --watch

# Run with coverage
npx jest --coverage
```

## Questions?

Open an issue or reach out to the maintainers.
