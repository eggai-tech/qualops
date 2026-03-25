import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

import { logger } from '../../shared/utils/logger';
import { validateConfig } from '../../shared/utils/validate-config';

export type Provider = 'anthropic' | 'openai' | 'bedrock';

const PROVIDER_DEFAULTS: Record<
  Provider,
  { model: string; inputPerMillion: number; outputPerMillion: number }
> = {
  anthropic: { model: 'claude-sonnet-4-6', inputPerMillion: 3, outputPerMillion: 15 },
  openai: { model: 'gpt-4.1', inputPerMillion: 2, outputPerMillion: 8 },
  bedrock: {
    model: 'us.anthropic.claude-sonnet-4-6-v1:0',
    inputPerMillion: 3,
    outputPerMillion: 15,
  },
};

const DEFAULT_QUALITY_PROMPT = `# Code Quality Review

Review the code for:
- **Bugs & Logic Errors** — incorrect behavior, off-by-one errors, null/undefined issues
- **Security** — injection, auth issues, data exposure, insecure defaults
- **Performance** — unnecessary allocations, N+1 queries, missing indexes
- **Maintainability** — unclear naming, excessive complexity, missing error handling

For each issue found, provide:
1. The file path and line number
2. Severity (critical / high / medium / low)
3. A clear description of the problem
4. A suggested fix
`;

const COMMAND_TEMPLATE = `# QualOps Setup Customizer

You are helping a user customize their QualOps configuration. A valid default config has already been generated.

## Instructions

1. **Read the existing config** at \`.qualops/.qualopsrc.json\`
2. **Ask which customization** the user wants from the menu below
3. **Apply the change** using the concrete snippets provided
4. **Validate** the final config is valid JSON before writing

## Customization Menu

### 1. Add a Security Review Pass
Add this to the \`passes\` array inside the first pipeline job:
\`\`\`json
{
  "name": "security",
  "enabled": true,
  "prompt": "review/security.md"
}
\`\`\`
Then create \`.qualops/prompts/review/security.md\` with a security-focused prompt.

### 2. Switch to Agentic Mode
Replace the pipeline job with:
\`\`\`json
{
  "name": "agenticReview",
  "enabled": true,
  "mode": "agentic",
  "agentic": {
    "maxTurns": 10,
    "enabledSubagents": ["dependency-tracer", "security-analyzer"]
  },
  "passes": [{
    "name": "quality",
    "enabled": true,
    "prompt": "review/quality.md"
  }]
}
\`\`\`

### 3. Change AI Provider/Model
Update the \`ai.reviewStage\` section. Valid providers and their recommended models:
- **anthropic**: \`claude-sonnet-4-6\` ($3/$15 per million tokens)
- **openai**: \`gpt-4.1\` ($2/$8 per million tokens)
- **bedrock**: \`us.anthropic.claude-sonnet-4-6-v1:0\` ($3/$15 per million tokens)

### 4. Add CI Workflow

**GitHub Actions** — create \`.github/workflows/qualops.yml\`:
\`\`\`yaml
name: QualOps Review
on:
  pull_request:
    types: [opened, synchronize]
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: eggai-tech/qualops@v1
        with:
          anthropic_api_key: \${{ secrets.ANTHROPIC_API_KEY }}
\`\`\`

**GitLab CI** — add to \`.gitlab-ci.yml\`:
\`\`\`yaml
qualops-review:
  image: node:20
  script:
    - npx @eggai/qualops --base $CI_MERGE_REQUEST_TARGET_BRANCH_NAME
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
\`\`\`

### 5. Add Validation & Deduplication
Add to a pipeline job:
\`\`\`json
{
  "validation": { "enabled": true, "minConfidence": 7 },
  "deduplication": { "enabled": true }
}
\`\`\`

---

$file:.qualops/qualops-llm.txt
`;

export function generateDefaultConfig(provider: Provider) {
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    $schema:
      'https://raw.githubusercontent.com/eggai-tech/qualops/main/docs/qualops-config.schema.json',
    ai: {
      reviewStage: {
        provider,
        model: defaults.model,
        inputPerMillion: defaults.inputPerMillion,
        outputPerMillion: defaults.outputPerMillion,
      },
    },
    review: {
      pipeline: [
        {
          name: 'codeQuality',
          enabled: true,
          passes: [
            {
              name: 'quality',
              enabled: true,
              prompt: 'review/quality.md',
            },
          ],
        },
      ],
    },
  };
}

export function getPackageRoot(): string {
  // Go up from dist/cli/commands/ to package root
  return join(__dirname, '..', '..', '..');
}

export async function initClaudeCommand(options?: { provider?: Provider }): Promise<void> {
  const provider: Provider = options?.provider || 'anthropic';
  const cwd = process.cwd();
  const qualopsDir = join(cwd, '.qualops');
  const commandsDir = join(cwd, '.claude', 'commands');
  const commandFile = join(commandsDir, 'qualops-setup.md');
  const localLlmFile = join(qualopsDir, 'qualops-llm.txt');
  const configFile = join(qualopsDir, '.qualopsrc.json');
  const promptsDir = join(qualopsDir, 'prompts', 'review');
  const qualityPromptFile = join(promptsDir, 'quality.md');

  // Create directories
  if (!existsSync(qualopsDir)) {
    mkdirSync(qualopsDir, { recursive: true });
  }
  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true });
  }
  if (!existsSync(promptsDir)) {
    mkdirSync(promptsDir, { recursive: true });
  }

  // Copy qualops-llm.txt from package to .qualops/
  const packageRoot = getPackageRoot();
  const sourceLlmFile = join(packageRoot, 'qualops-llm.txt');

  if (existsSync(sourceLlmFile)) {
    copyFileSync(sourceLlmFile, localLlmFile);
    logger.info('Copied qualops-llm.txt to .qualops/');
  } else {
    logger.warn(`Could not find qualops-llm.txt in package at ${sourceLlmFile}`);
    logger.warn('The Claude command will still work but may have limited guidance');
  }

  // Generate and validate default config
  if (existsSync(configFile)) {
    logger.warn('.qualops/.qualopsrc.json already exists — skipping config generation');
  } else {
    const config = generateDefaultConfig(provider);
    const result = validateConfig(config);
    if (!result.valid) {
      logger.error('Generated config failed schema validation:');
      result.errors.forEach((err) => logger.error(`  ${err}`));
      return;
    }
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
    logger.info(`Created .qualops/.qualopsrc.json (provider: ${provider})`);
  }

  // Create default prompt file
  if (!existsSync(qualityPromptFile)) {
    writeFileSync(qualityPromptFile, DEFAULT_QUALITY_PROMPT);
    logger.info('Created .qualops/prompts/review/quality.md');
  }

  // Create or update the Claude command
  writeFileSync(commandFile, COMMAND_TEMPLATE);
  logger.info('Created .claude/commands/qualops-setup.md');

  logger.info('');
  logger.info('Use /qualops-setup in Claude Code to customize your QualOps configuration');
}
