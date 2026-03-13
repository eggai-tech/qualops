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

Releases are managed by maintainers using GitHub Actions.

### For Maintainers

#### Creating a Release

1. Go to **Actions** → **Create Release PR**
2. Click **Run workflow**
3. Enter the version number:
   - Stable: `0.2.0`
   - Pre-release: `0.2.0-rc.1`
4. The workflow creates a PR that:
   - Updates `package.json` version
   - Moves changelog entries from `[Unreleased]` to versioned section
5. Review and merge the PR

#### What Happens After Merge

1. **Auto Tag**: Creates git tag `v0.2.0`
2. **npm Publish**: Builds and publishes to npm
3. **GitHub Release**: Creates release with changelog

### Version Guidelines

We follow [Semantic Versioning](https://semver.org/):

- **MAJOR** (`1.0.0`): Breaking changes
- **MINOR** (`0.2.0`): New features, backward compatible
- **PATCH** (`0.1.1`): Bug fixes, backward compatible

Pre-release versions:
- `0.2.0-rc.1` - Release candidate
- `0.2.0-alpha.1` - Alpha release
- `0.2.0-beta.1` - Beta release

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
