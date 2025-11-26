# GitHub Integration Examples

This directory contains example configurations and workflows for using QualOps with GitHub Actions.

## Files

- **`.qualopsrc.json`** - Full-featured configuration example
- **`workflows/qualops-basic.yml`** - Minimal workflow setup
- **`workflows/qualops-advanced.yml`** - Advanced workflow with output handling

## Quick Setup

1. Copy `.qualopsrc.json` to your repository root
2. Copy one of the workflow files to `.github/workflows/`
3. Add `ANTHROPIC_API_KEY` to repository secrets
4. Open a pull request to see QualOps in action!

## What You Get

When you open a pull request, QualOps will:

1. **Analyze** changed files using AI
2. **Review** code for issues (security, bugs, maintainability, performance)
3. **Post** a summary comment on the PR
4. **Create** a GitHub check run with annotations
5. **Annotate** specific lines in the "Files changed" view
6. **Upload** full HTML reports as artifacts

## Configuration

### Minimal Config

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929"
    }
  },
  "github": {
    "enabled": true,
    "postComments": true
  }
}
```

### Full Config

See `.qualopsrc.json` in this directory for all available options.

## Workflow Customization

### Basic Usage

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### Custom Stages

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    stages: 'analyze,review,judge'
```

### Specific Files

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    files: 'src/**/*.ts'
```

## Required Permissions

Your workflow needs these permissions:

```yaml
permissions:
  contents: read        # Read code
  pull-requests: write  # Post comments
  checks: write         # Create check runs
```

## Documentation

For detailed setup instructions, see [docs/github-setup.md](../../docs/github-setup.md).

## Support

- Main Repository: https://github.com/eggai-tech/qualops
- Issues: https://github.com/eggai-tech/qualops/issues
- Full Documentation: https://github.com/eggai-tech/qualops#readme
