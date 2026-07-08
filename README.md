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

---

## Setup

### CLI

```bash
npm install -g @eggai/qualops
```

Then set an API key (see [Zero-config providers](#zero-config-providers) below) and run:

```bash
qualops --base=main --head=HEAD
```

### GitHub Actions

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

To use a different provider, pass credentials via env vars instead — see [Zero-config providers](#zero-config-providers) below. No config file is required for basic usage.

---

## Zero-config providers

No `.qualopsrc.json` needed. Set one of the following environment variables and QualOps picks a sensible default model automatically.

### Anthropic

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

Default model: `claude-sonnet-4-6`

In GitHub Actions:

```yaml
      - uses: eggai-tech/qualops@stable
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

### OpenAI

```bash
export OPENAI_API_KEY=sk-...
```

Default model: `gpt-4.1`

In GitHub Actions:

```yaml
      - uses: eggai-tech/qualops@stable
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
```

### OpenAI on Azure

Azure OpenAI uses the same `OPENAI_API_KEY` env var, with `OPENAI_BASE_URL` pointing to your Azure endpoint. The model name must match your Azure deployment name.

```bash
export OPENAI_API_KEY=<your-azure-api-key>
export OPENAI_BASE_URL=https://<your-resource>.openai.azure.com/openai/deployments/<deployment-name>
```

No config file needed — QualOps routes the request to your Azure endpoint automatically. Note: Azure keys do not start with `sk-`; QualOps skips format validation when a custom base URL is set.

In GitHub Actions:

```yaml
      - uses: eggai-tech/qualops@stable
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          OPENAI_API_KEY: ${{ secrets.AZURE_OPENAI_API_KEY }}
          OPENAI_BASE_URL: ${{ secrets.AZURE_OPENAI_BASE_URL }}
```

---

## LLM configuration

To use a specific model, switch providers, or use a self-hosted model, create `.qualops/.qualopsrc.json` in your project root.

### Anthropic

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "inputPerMillion": 3,
      "outputPerMillion": 15
    }
  }
}
```

Available models: `claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5-20251001`

### OpenAI

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai",
      "model": "gpt-4.1",
      "inputPerMillion": 2,
      "outputPerMillion": 8
    }
  }
}
```

Available models: `gpt-4.1`, `gpt-4o`, `o4-mini`

### AWS Bedrock

```bash
export AWS_REGION=us-east-1
export AWS_ACCESS_KEY_ID=...
export AWS_SECRET_ACCESS_KEY=...
```

```json
{
  "ai": {
    "reviewStage": {
      "provider": "bedrock",
      "model": "us.anthropic.claude-sonnet-4-6-v1:0",
      "inputPerMillion": 3,
      "outputPerMillion": 15
    }
  }
}
```

### GitHub Models

Uses [GitHub Models](https://github.com/marketplace/models). Requires a GitHub personal access token.

```bash
export GITHUB_API_KEY=ghp_...
```

```json
{
  "ai": {
    "reviewStage": {
      "provider": "github",
      "model": "gpt-4o-mini",
      "inputPerMillion": 0,
      "outputPerMillion": 0
    }
  }
}
```

### OpenAI-compatible (Ollama, Mistral, vLLM, LiteLLM, …)

Any OpenAI-compatible endpoint. Useful for self-hosted models, cost optimization, or on-premise deployments.

**Ollama (local):**

```bash
export OPENAI_BASE_URL=http://localhost:11434/v1
# no API key required for Ollama
```

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai-compatible",
      "model": "llama3.1:8b",
      "inputPerMillion": 0,
      "outputPerMillion": 0
    }
  }
}
```

**Mistral (hosted):**

```bash
export OPENAI_API_KEY=<your-mistral-api-key>
export OPENAI_BASE_URL=https://api.mistral.ai/v1
```

```json
{
  "ai": {
    "reviewStage": {
      "provider": "openai-compatible",
      "model": "mistral-large-latest",
      "inputPerMillion": 2,
      "outputPerMillion": 6
    }
  }
}
```

`OPENAI_BASE_URL` must be an `http://` or `https://` URL.

---

## AI-Assisted Setup

Use Claude Code to interactively configure QualOps for your project:

```bash
npx @eggai/qualops init-claude
```

Then use `/qualops-setup` in Claude Code. The AI will guide you through configuration based on your project's framework and needs.

---

## Configuration

Full configuration example with all common options:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "anthropic",
      "model": "claude-sonnet-4-6",
      "inputPerMillion": 3,
      "outputPerMillion": 15
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
        "enabledSubagents": ["security-analyzer", "dependency-tracer"],
        "systemPrompt": "Focus on security vulnerabilities and injection risks"
      }
    }
  }
}
```

See [qualops-llm.txt](./qualops-llm.txt) for the full configuration reference.

---

## Review Modes

### Agentic mode

An AI agent explores the codebase across files using tools (read, grep, bash), traces dependencies, and reports cross-file issues. Best for security audits, breaking change detection, and complex refactors where single-file context is insufficient.

Enable via job configuration:

```json
{
  "jobs": {
    "security-audit": {
      "mode": "agentic",
      "agentic": {
        "maxTurns": 20,
        "enabledSubagents": ["security-analyzer", "dependency-tracer"]
      }
    }
  }
}
```

Built-in subagents:

| Subagent | What it does |
|----------|-------------|
| `dependency-tracer` | Cross-file import analysis, coupling issues |
| `breaking-change-detector` | Public API compatibility checks |
| `security-analyzer` | Vulnerability detection across files |
| `pattern-validator` | Codebase pattern consistency |

**Custom subagents** extend or replace the built-ins. Create a markdown file in `.qualops/agents/` with a frontmatter header and a prompt body:

```
.qualops/agents/license-checker.md
```

```markdown
---
description: "Checks that all new source files include the required license header"
tools: [Read, Grep, Glob]
---
You are a license compliance checker.

Check every new file in the diff for a license header matching:
  // Copyright (c) Acme Corp. All rights reserved.
  // SPDX-License-Identifier: MIT

Report each file missing the header as a high-severity issue.
Return results as JSON: [{ "type": "compliance", "severity": "high", "location": "file:1", "description": "...", "confidence": 9 }]
```

QualOps loads all `.md` files from `.qualops/agents/` automatically. Custom agents can override built-ins by using the same name.

### File-by-file mode

Reviews each changed file independently. Faster and lower cost than agentic mode; suitable for high-volume workflows or when cross-file context is not needed.

Each review runs one or more **passes** — a pass is a prompt applied to the file. The default pass uses a built-in general-purpose quality prompt. Custom passes let you tailor reviews to your team's standards, stack, or compliance rules.

**When to add a custom pass:**

- Domain-specific rules — e.g. "all DB queries must use parameterized statements"
- Security or compliance focus — stricter than the default prompt
- Framework conventions — e.g. "React hooks must follow the rules of hooks"
- Migration checks — catching deprecated API usage during an upgrade

Create a prompt file, then add a pass referencing it:

```
.qualops/prompts/review/security.md
.qualops/prompts/review/migration.md
```

```json
{
  "review": {
    "pipeline": [
      {
        "name": "codeQuality",
        "passes": [
          { "name": "quality", "prompt": "review/quality.md" },
          { "name": "security", "prompt": "review/security.md" }
        ]
      }
    ]
  }
}
```

**Example — security pass** (`.qualops/prompts/review/security.md`):

```markdown
Review the diff for security issues only. Focus on:
- SQL/NoSQL injection: any string concatenation into queries
- Authentication gaps: missing auth checks on new endpoints
- Secrets in code: hardcoded tokens, passwords, or keys
- Insecure deserialization: untrusted input passed to JSON.parse or similar

For each issue report: file, line, severity (critical/high/medium/low), description, and fix.
Skip style, performance, and maintainability issues entirely.
```

**Example — migration pass** (`.qualops/prompts/review/migration.md`):

```markdown
This project is migrating from Express 4 to Express 5. Flag any usage of:
- Removed APIs: res.redirect() with non-string arguments, req.param()
- Changed middleware signatures: error handlers must have 4 arguments (err, req, res, next)
- router.param() callback signature changes
```

---

## Pipeline Stages

| Stage | Description |
|-------|-------------|
| **analyze** | Detects changed files between git refs |
| **review** | AI reviews code — file-by-file or agentic mode |
| **fix** | Generates fix suggestions for high-confidence issues |
| **report** | Creates HTML reports with findings |
| **judge** | Evaluates quality against thresholds |

---

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

## Testing

### Unit tests

```bash
npm test
```

### Provider-dialect smoke tests

Real-API tests that exercise the 4 AI caller stages (`file-reviewer`, `validation-resolver`, `dedup-resolver`, `root-cause-extract`) against each supported provider. Validates that the structured-output dialect path returns a zod-validated response without throwing. Providers without credentials are skipped automatically.

```bash
npm run test:smoke
```

See [`tests/smoke/README.md`](./tests/smoke/README.md) for details on env vars and CI setup.

## License

MIT
