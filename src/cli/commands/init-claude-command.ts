import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';

import { logger } from '../../shared/utils/logger';

const COMMAND_TEMPLATE = `Fetch the QualOps configuration guide from:
https://raw.githubusercontent.com/eggai-tech/qualops/main/qualops-llm.txt

Use this guide to help me set up QualOps for this project. Follow the INTERACTIVE SETUP PROCESS from the guide, asking me questions about:
- Review focus (security, performance, code quality, etc.)
- Framework detection
- CI platform (GitHub Actions or GitLab CI)
- Validation and confidence settings

Then create:
1. \`.qualops/.qualopsrc.json\` - Main configuration
2. CI workflow file (\`.github/workflows/qualops.yml\` or \`.gitlab-ci.yml\`)
3. Custom prompts in \`.qualops/prompts/\` directory if needed
`;

export async function initClaudeCommand(): Promise<void> {
  const commandsDir = join(process.cwd(), '.claude', 'commands');
  const commandFile = join(commandsDir, 'qualops-setup.md');

  if (existsSync(commandFile)) {
    logger.info('Claude command already exists at .claude/commands/qualops-setup.md');
    return;
  }

  if (!existsSync(commandsDir)) {
    mkdirSync(commandsDir, { recursive: true });
  }

  writeFileSync(commandFile, COMMAND_TEMPLATE);
  logger.info('Created .claude/commands/qualops-setup.md');
  logger.info('Use /qualops-setup in Claude Code to configure QualOps for this project');
}
