# @eggai/qualops

AI-powered code review for your PRs.

## Features

- **Automated PR Reviews** - AI analyzes changed files and posts findings as PR comments
- **GitHub Checks Integration** - Inline annotations directly in the "Files changed" tab
- **Multi-stage Pipeline** - Analyze → Review → Fix → Report → Judge
- **Framework-aware** - Detects Angular, React, Node.js and loads relevant context
- **Customizable** - Configure severity thresholds, prompts, and AI providers
- **CI/CD Ready** - GitHub Actions and GitLab CI support

## Quick Start

### GitHub Actions (Recommended)

Add to `.github/workflows/qualops.yml`:

```yaml
name: QualOps Review

on:
  pull_request:
    branches: [main]

permissions:
  contents: read
  pull-requests: write
  checks: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: eggai-tech/qualops@v0.1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### CLI Usage

```bash
# Install
npm install -g @eggai/qualops

# Run on changed files
qualops --base=main --head=HEAD

# Run on specific files
qualops --files="src/**/*.ts"
```

## AI-Assisted Setup

Use Claude Code to interactively configure QualOps for your project:

```bash
npx @eggai/qualops init-claude
```

Then use `/setup-qualops` in Claude Code. The AI will guide you through configuration based on your project's framework and needs.

## Configuration

Create `.qualops/.qualopsrc.json` in your project:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-20250514"
    }
  },
  "review": {
    "minConfidence": 4
  },
  "github": {
    "postComments": true,
    "maxInlineComments": 50
  }
}
```

## Environment Variables

```bash
# Anthropic (recommended)
ANTHROPIC_API_KEY=sk-ant-...

# Or AWS Bedrock
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## Pipeline Stages

| Stage | Description |
|-------|-------------|
| **analyze** | Detects changed files between git refs |
| **review** | AI reviews code with framework-specific context |
| **fix** | Generates fix suggestions for high-confidence issues |
| **report** | Creates HTML reports with findings |
| **judge** | Evaluates quality against thresholds |

## CLI Options

```
qualops [options]

Options:
  -b, --base <branch>    Base branch for comparison (default: main)
  -h, --head <ref>       Head ref for comparison (default: HEAD)
  -f, --files <paths>    Specific files to analyze (glob patterns)
  -s, --stages <stages>  Stages to run (default: all)
  -n, --name <name>      Session name for reports
  --fix-apply            Apply fixes automatically
  --skip-cache           Force fresh analysis
```

## Custom Prompts

Create custom review prompts in your project:

```
prompts/
  review-system-message.md   # Core review instructions
  validation.md              # False positive filtering rules
  deduplication.md           # Duplicate detection rules
```

Reference in `.qualopsrc.json`:

```json
{
  "review": {
    "prompt": "prompts/review-system-message.md"
  }
}
```

## License

MIT
