import { existsSync, mkdirSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

import { logger } from '../../shared/utils/logger';

const COMMAND_TEMPLATE = `# QualOps Setup Assistant

You are helping a user set up QualOps in their project. Use the comprehensive guide below to assist them.

## Your Role

1. **Ask the right questions** about their review needs (security, performance, migration, etc.)
2. **Generate configuration files** (\`.qualopsrc.json\` and custom prompts)
3. **Create CI workflows** (GitHub Actions or GitLab CI)
4. **Validate the setup** before finishing

## Interactive Process

Start by asking:
1. What type of code review do they need? (security, performance, quality, migration, custom)
2. What language/framework is their codebase? (TypeScript, Python, etc.)
3. Do they want CI integration? (GitHub Actions, GitLab CI, or none)
4. What severity levels matter? (critical only, critical+high, all)

Then generate the appropriate files based on their answers.

---

$file:.qualops/qualops-llm.txt
`;

function getPackageRoot(): string {
  // Go up from dist/cli/commands/ to package root
  return join(__dirname, '..', '..', '..');
}

export async function initClaudeCommand(): Promise<void> {
  const cwd = process.cwd();
  const qualopsDir = join(cwd, '.qualops');
  const commandsDir = join(cwd, '.claude', 'commands');
  const commandFile = join(commandsDir, 'qualops-setup.md');
  const localLlmFile = join(qualopsDir, 'qualops-llm.txt');

  // Create directories
  if (!existsSync(qualopsDir)) {
    mkdirSync(qualopsDir, { recursive: true });
  }
  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true });
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

  // Create or update the Claude command
  writeFileSync(commandFile, COMMAND_TEMPLATE);

  if (existsSync(commandFile)) {
    logger.info('Updated .claude/commands/qualops-setup.md');
  } else {
    logger.info('Created .claude/commands/qualops-setup.md');
  }

  logger.info('');
  logger.info('Use /qualops-setup in Claude Code to configure QualOps for this project');
}
