# GitHub Integration Setup Guide

QualOps provides native GitHub Actions integration for automated code quality analysis on pull requests. This guide shows you how to set up QualOps in your GitHub repository.

## Features

- ✅ **PR Comments** - Post comprehensive code quality summaries directly on pull requests
- ✅ **GitHub Checks** - Create check runs with file-level annotations visible in "Files changed"
- ✅ **Annotations** - Issues appear inline on specific lines in PR diffs
- ✅ **Quality Gates** - Block merges based on configurable severity thresholds
- ✅ **Artifacts** - Full HTML reports uploaded for detailed analysis

## Quick Start (3 Steps)

### 1. Add GitHub Secret

Go to your repository settings and add your Anthropic API key:

```
Settings → Secrets → Actions → New repository secret
```

- **Name:** `ANTHROPIC_API_KEY`
- **Value:** Your Anthropic API key (starts with `sk-ant-...`)

### 2. Create Configuration File

Create `.qualopsrc.json` in your repository root:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-5-20250929",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    }
  },
  "github": {
    "enabled": true,
    "postComments": true,
    "skipOnDraft": false,
    "blockPipeline": false,
    "maxInlineComments": 50
  }
}
```

### 3. Add Workflow File

Create `.github/workflows/qualops.yml`:

```yaml
name: QualOps Code Quality

on:
  pull_request:
    types: [opened, synchronize, reopened]

jobs:
  qualops:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      pull-requests: write
      checks: write

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: eggai-tech/qualops@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

That's it! QualOps will now analyze all pull requests.

## Configuration Options

### GitHub Configuration

```json
{
  "github": {
    "enabled": true,              // Enable GitHub integration
    "postComments": true,          // Post PR summary comments
    "skipOnDraft": false,          // Skip draft PRs
    "blockPipeline": false,        // Fail CI on critical/high issues
    "maxInlineComments": 50        // Max annotations per check (GitHub limit)
  }
}
```

### AI Provider Configuration

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",     // or "bedrock", "openai"
      "model": "claude-sonnet-4-5-20250929",
      "temperature": 0,
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0
    }
  }
}
```

### Quality Thresholds

```json
{
  "review": {
    "minConfidence": 7,            // Minimum confidence (1-10)
    "maxFilesBeforeReset": 8,      // Files per session
    "maxContextTokens": 100000     // Token limit per session
  }
}
```

### Agentic Mode (Cross-File Analysis)

For complex PRs requiring dependency tracing and cross-file analysis:

```json
{
  "jobs": {
    "security-audit": {
      "mode": "agentic",
      "agentic": {
        "maxTurns": 20,
        "contextMode": "auto",
        "enabledSubagents": ["security-analyzer", "dependency-tracer"],
        "systemPrompt": "Focus on security vulnerabilities"
      }
    }
  }
}
```

| Option | Description |
|--------|-------------|
| `maxTurns` | Max tool call cycles (default: 15) |
| `contextMode` | `auto` (diff if available), `diff`, or `full` |
| `enabledSubagents` | Subset of built-in subagents to use |
| `systemPrompt` | Additional focus instructions for the agent |

Built-in subagents: `dependency-tracer`, `breaking-change-detector`, `security-analyzer`, `pattern-validator`

## Advanced Usage

### Custom Stages

Run specific stages only:

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    stages: 'analyze,review,judge'  # Skip fix and report
```

### Specific Files

Analyze only certain files or patterns:

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    files: 'src/**/*.ts,lib/**/*.js'
```

### Custom Config Path

Use a different config file:

```yaml
- uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    config-path: '.config/qualops-custom.json'
```

### Using Outputs

Access analysis results in subsequent steps:

```yaml
- id: qualops
  uses: eggai-tech/qualops@v1
  with:
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}

- name: Check Results
  run: |
    echo "Total Issues: ${{ steps.qualops.outputs.total-issues }}"
    echo "Critical: ${{ steps.qualops.outputs.critical-issues }}"
    echo "High: ${{ steps.qualops.outputs.high-issues }}"
    echo "Passed: ${{ steps.qualops.outputs.quality-passed }}"

- name: Fail on Critical
  if: steps.qualops.outputs.critical-issues > 0
  run: exit 1
```

## Permissions

The GitHub Action requires these permissions:

```yaml
permissions:
  contents: read        # Read repository code
  pull-requests: write  # Post PR comments
  checks: write         # Create check runs with annotations
```

## Environment Variables

QualOps automatically detects GitHub Actions environment:

- `GITHUB_TOKEN` - Provided by GitHub Actions
- `GITHUB_REPOSITORY` - Owner/repo name
- `GITHUB_SHA` - Commit SHA
- `GITHUB_EVENT_NAME` - Event type (pull_request)
- `GITHUB_BASE_REF` - PR base branch
- `GITHUB_HEAD_REF` - PR head branch

## Alternative Providers

### AWS Bedrock

```json
{
  "ai": {
    "reviewStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-5-v2:0",
      "region": "us-east-1"
    }
  }
}
```

Add AWS credentials as secrets:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`

### OpenAI

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai",
      "model": "gpt-4",
      "temperature": 0
    }
  }
}
```

Add OpenAI API key as secret:
- `OPENAI_API_KEY`

## Troubleshooting

### Check Not Appearing

Ensure your workflow has `checks: write` permission:

```yaml
permissions:
  checks: write
```

### Comments Not Posting

Ensure your workflow has `pull-requests: write` permission and `GITHUB_TOKEN` is passed:

```yaml
permissions:
  pull-requests: write

steps:
  - uses: eggai-tech/qualops@v1
    with:
      github-token: ${{ secrets.GITHUB_TOKEN }}  # Usually automatic
```

### No Files Analyzed

Ensure full git history is fetched:

```yaml
- uses: actions/checkout@v4
  with:
    fetch-depth: 0  # Required for git diff
```

### Rate Limiting

GitHub API has rate limits. If you hit them, QualOps will automatically retry with exponential backoff (3 attempts).

## Example Repositories

See the `examples/github/` directory for:
- `workflows/qualops-basic.yml` - Minimal setup
- `workflows/qualops-advanced.yml` - Full-featured with output handling

## Support

- Documentation: https://github.com/eggai-tech/qualops
- Issues: https://github.com/eggai-tech/qualops/issues
- Discussions: https://github.com/eggai-tech/qualops/discussions
