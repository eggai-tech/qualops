# QualOps

AI-powered code quality analysis pipeline orchestration tool using Claude AI.

## Installation

```bash
npm install
npm run build
```

Or use directly in development mode:

```bash
npm run dev -- <command> [options]
```

## How it works

QualOps runs a multi-stage pipeline:

1. **analyze** - Identifies changed files to review
2. **review** - AI reviews files using session-based analysis with framework-specific documentation
3. **fix** - AI generates fix suggestions for high-confidence issues
4. **report** - Generates HTML report with findings and metrics
5. **judge** - Evaluates overall quality against configured thresholds

## Configuration

Create `.qualopsrc.json` in your project root:

```json
{
  "ai": {
    "reviewStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-20250514-v1:0",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    },
    "fixStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-20250514-v1:0",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    },
    "judgeStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-20250514-v1:0",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    },
    "filterStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-20250514-v1:0",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    },
    "reportStage": {
      "provider": "bedrock",
      "model": "anthropic.claude-sonnet-4-20250514-v1:0",
      "inputPerMillion": 3.0,
      "outputPerMillion": 15.0,
      "temperature": 0
    }
  },
  "review": {
    "minConfidence": 4,
    "sessionBased": true,
    "groundTruthOnly": true,
    "maxFilesBeforeReset": 8,
    "maxContextTokens": 50000
  },
  "performance": {
    "maxFileSizeKB": 500,
    "maxFilesPerBatch": 20,
    "maxTokensPerFile": 8000,
    "timeoutSeconds": 300
  }
}
```

## Environment Variables

API keys and credentials only:

```bash
# AWS Bedrock
AWS_REGION=eu-west-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## AWS Bedrock Provider

- Enterprise features and AWS integration
- Region-specific model availability
- Models: `anthropic.claude-sonnet-4-20250514-v1:0`

## Usage

QualOps can be run as a CLI tool or via npm scripts:

```bash
# Using npm scripts (development)
npm run qualops -- [command] [options]

# Using CLI directly (after build)
node dist/cli.js [command] [options]

# Or install globally (future)
qualops [command] [options]
```

### Analysis Modes

QualOps supports two analysis modes based on the CLI options provided:

#### 1. Git Mode (Default - MR/PR Review)

Analyzes changed files between two git references. This is the default mode when no `--files` is specified.

```bash
# Analyze changes between branches (default: main...HEAD)
npm run qualops

# Compare against specific branch
npm run qualops -- --base=development

# Compare two specific branches
npm run qualops -- --base=main --head=feature-branch

# Analyze uncommitted changes only
npm run qualops -- --base=HEAD

# GitLab CI (automatic in merge requests)
npm run qualops -- --base=${CI_MERGE_REQUEST_TARGET_BRANCH_NAME} --head=HEAD
```

**Git mode analyzes:**
- Committed changes between base...head
- Staged changes (git add)
- Unstaged changes (working directory)
- Untracked files

#### 2. Files Mode (Targeted Analysis)

Analyzes specific files or file patterns.

```bash
# Analyze specific files
npm run qualops -- --files=src/app/component.ts,src/app/service.ts

# Analyze files matching glob pattern
npm run qualops -- --files="src/**/*.component.ts"

# Analyze specific library
npm run qualops -- --files="libs/my-lib/src/**/*.ts"
```

**Files mode analyzes:**
- Exact file paths provided
- Files matching glob patterns (`*`, `**`, `{a,b}`, `?`)
- Filters to `.ts` files only (excludes `.d.ts`)

### Common Options

```bash
# Run specific stages only
npm run qualops -- --stages=analyze,review,fix

# Custom session name
npm run qualops -- --name=my-analysis

# Custom report directory
npm run qualops -- --report-root=custom-reports

# Skip cache (force fresh analysis)
npm run qualops -- --skip-cache

# Apply fixes automatically
npm run qualops -- --fix-apply

# Exclude medium severity from auto-fix
npm run qualops -- --exclude-medium
```

## Session-based Review

The review stage uses sessions with framework-specific documentation:

- **Architecture Decision Records** - URL state, Signal Store patterns
- **OWASP Security** - XSS, injection, authentication (split into 2 sessions)
- **Angular Best Practices** - Component lifecycle, DI, change detection
- **NgRx State Management** - Actions, effects, selectors, store patterns
- **RxJS Patterns** - Observable patterns, subscription management, memory leaks

Each session maintains context across files and applies framework-specific rules based on detected framework.

## Documentation

Documentation is downloaded to `.qualops/unified-docs/` and includes:

- Framework-specific best practices (Angular, NgRx, RxJS)
- Security guidelines (OWASP)
- Architecture decision records

```bash
# Download documentation (first time setup)
npm run qualops:docs:download

# Or use CLI directly
node dist/cli.js docs:download
```

Documentation sources:
- **Angular**: https://angular.dev/context/llm-files/llms-full.txt
- **NgRx**: https://context7.com/ngrx/platform/llms.txt
- **RxJS**: https://context7.com/reactivex/rxjs/llms.txt
- **OWASP**: GitHub CheatSheetSeries repository

## Customizing AI Prompts

QualOps uses markdown files in `examples/prompts/` to guide AI behavior at each stage.
You can customize these to adjust review criteria, validation rules, and output formats:

### Customizable Prompt Files

- **review-system-message.md** - Core review principles and instructions (used as system prompt)
- **validation.md** - AI-powered validation rules to filter false positives
- **deduplication.md** - Rules for identifying duplicate issues within files

## Development

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev -- all

# Run tests
npm test

# Run integration tests
npm run test:integration

# Lint code
npm run lint

# Build for production
npm run build
```

## GitLab CI Integration

QualOps runs automatically on merge requests to analyze changed files and post results as comments.

### Setup

Go to **Settings > CI/CD > Variables** and add **one** of the following:

**Option 1: Anthropic (Recommended)**
- `ANTHROPIC_API_KEY` - Your Anthropic API key (masked)

**Option 2: AWS Bedrock**
- `AWS_REGION` - e.g., eu-west-1
- `AWS_ACCESS_KEY_ID` - Your AWS access key (masked)
- `AWS_SECRET_ACCESS_KEY` - Your AWS secret key (masked)

### Pipeline Behavior

- Runs on merge request events (non-main branches)
- Executes after unit tests complete
- Non-blocking by default (configure with `blockPipeline: true` to enforce)
- Results posted as MR comments
- Full reports available as job artifacts
- Documentation cached between runs for performance

### GitLab Configuration

Add to `.qualopsrc.json`:

```json
{
  "gitlab": {
    "enabled": true,
    "postComments": true,
    "skipOnDraft": false,
    "blockPipeline": false
  }
}
```

**Customization:**
- `postComments: false` - Disable MR comments
- `skipOnDraft: true` - Skip analysis on draft MRs
- `blockPipeline: true` - Fail the pipeline if critical/high issues found (default: false)
- Adjust `minConfidence` in review settings for severity thresholds
