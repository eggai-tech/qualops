import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'fs';
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

const COMMAND_TEMPLATE = `# QualOps Setup Wizard

You are running a setup wizard that walks the user through configuring QualOps for their project. This is a single guided flow — collect all answers first, then apply everything at the end.

## Wizard Flow

Walk through each step in order using the \`AskUserQuestion\` tool. Ask one question at a time, wait for the answer, then move to the next step. Do NOT generate any files until all steps are complete.

**Step 1** — Ask what review types to enable (header: "Review type", multiSelect: true):
- "Quality (Recommended)" — Bug detection, maintainability, and code clarity
- "Security" — Injection, auth issues, data exposure, insecure defaults
- "Performance" — N+1 queries, unnecessary allocations, missing indexes
- "Migration" — Breaking changes, deprecated APIs, upgrade compatibility

**Step 2** — Ask about CI integration (header: "CI", multiSelect: false):
- "GitHub Actions (Recommended)" — Add a \`.github/workflows/qualops.yml\` workflow
- "GitLab CI" — Add a \`qualops-review\` job to \`.gitlab-ci.yml\`
- "None" — Skip CI integration for now

**Step 3** — Ask about severity filtering (header: "Severity", multiSelect: false):
- "Critical + High (Recommended)" — Focus on impactful issues only
- "Critical only" — Only flag showstoppers
- "All severities" — Include medium and low findings too

## Apply

Once all 3 answers are collected, read the existing \`.qualops/.qualopsrc.json\` config, then apply changes using the reference guide below:

### Review types → pipeline passes
For each selected review type, add a pass to \`review.pipeline[0].passes\`:
- **Quality** — already exists as \`review/quality.md\` (skip if present)
- **Security** — add pass with \`"prompt": "review/security.md"\`, create \`.qualops/prompts/review/security.md\` with a security-focused prompt
- **Performance** — add pass with \`"prompt": "review/performance.md"\`, create \`.qualops/prompts/review/performance.md\` with a performance-focused prompt
- **Migration** — add pass with \`"prompt": "review/migration.md"\`, create \`.qualops/prompts/review/migration.md\` with a migration-focused prompt

### Severity → report config
- **Critical + High** → \`"report": { "includedSeverities": ["critical", "high"] }\`
- **Critical only** → \`"report": { "includedSeverities": ["critical"] }\`
- **All severities** → \`"report": { "includedSeverities": ["critical", "high", "medium", "low"] }\`

### CI workflow
If selected, create the workflow file using the CI templates in the reference guide below. Skip if "None" was chosen.

### Validation
Validate the final config is valid JSON before writing. Use the checklist in the reference guide to verify all required fields are present.

---

$file:.qualops/qualops-llm.txt
`;

export function generateDefaultConfig(provider: Provider) {
  const defaults = PROVIDER_DEFAULTS[provider];
  return {
    $schema:
      'https://raw.githubusercontent.com/eggai-tech/qualops/main/qualops-config.schema.json',
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
      logger.error('Aborting initialization due to invalid generated configuration.');
      process.exitCode = 1;
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
  const commandAction = existsSync(commandFile) ? 'Updated' : 'Created';
  writeFileSync(commandFile, COMMAND_TEMPLATE);
  logger.info(`${commandAction} .claude/commands/qualops-setup.md`);

  logger.info('');
  logger.info('Use /qualops-setup in Claude Code to customize your QualOps configuration');
}
