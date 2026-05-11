# @eggai/qualops

AI-powered code review for your PRs.

## Features

- **Automated PR Reviews** - AI analyzes changed files and posts findings as PR comments
- **Two Review Modes** - File-by-file (fast, high volume) or Agentic (cross-file analysis with Claude Agent SDK)
- **GitHub Checks Integration** - Inline annotations directly in the "Files changed" tab
- **Multi-stage Pipeline** - Analyze → Review → Fix → Report → Judge
- **Framework-aware** - Detects Angular, React, Node.js and loads relevant context
- **Customizable** - Configure severity thresholds, prompts, AI providers, and custom agents
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

      - uses: eggai-tech/qualops@stable
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

### File-by-File Mode (Default)

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

### Agentic Mode (Cross-File Analysis)

```json
{
  "jobs": {
    "security-audit": {
      "mode": "agentic",
      "agentic": {
        "maxTurns": 20,
        "contextMode": "auto",
        "enabledSubagents": ["security-analyzer", "dependency-tracer"],
        "systemPrompt": "Focus on security vulnerabilities and injection risks"
      }
    }
  }
}
```

See [qualops-llm.txt](./qualops-llm.txt) for full configuration reference.

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

## Review Modes

| Mode | Best For | How It Works |
|------|----------|--------------|
| **file-by-file** | High volume, quick scans | Reviews each file independently using configured passes |
| **agentic** | Complex analysis, cross-file issues | Agent explores codebase with tools, traces dependencies |

Built-in subagents for agentic mode:
- `dependency-tracer` - Cross-file import analysis
- `breaking-change-detector` - API compatibility checks
- `security-analyzer` - Vulnerability detection
- `pattern-validator` - Codebase pattern consistency

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
