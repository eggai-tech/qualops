#!/usr/bin/env node
import { Command } from 'commander';

import { executeAllStages } from './cli/commands/all-command';
import { generateIndexCommand } from './cli/commands/generate-index-command';
import { withErrorHandling } from './cli/utils/error-handler';
import { formatHelpText } from './cli/utils/help-formatter';

const runQualOps = withErrorHandling(executeAllStages, 'qualops');

const program = new Command();

program
  .name('qualops')
  .description('AI-powered code quality analysis tool')
  .version('1.0.0')
  .option(
    '-c, --config <path>',
    'path to config file (default: .qualopsrc.json)',
    '.qualopsrc.json',
  )
  .option('-b, --base <branch>', 'base branch for comparison', 'main')
  .option('-h, --head <ref>', 'head ref for comparison (defaults to HEAD)')
  .option('-f, --files <paths>', 'specific file(s) to analyze (comma-separated or glob patterns)')
  .option('-s, --stages <stages>', 'comma-separated list of stages to run (or "all")', 'all')
  .option('-n, --name <name>', 'session name (placed under sessions/)')
  .option('--report-root <name>', 'report root directory name')
  .option('--fix-apply', 'apply fixes automatically')
  .option('--include-medium', 'include medium severity issues in fixes (default: true)')
  .option('--exclude-medium', 'exclude medium severity issues from fixes')
  .option('--skip-cache', 'skip cache and force fresh analysis')
  .action(runQualOps);

program
  .command('all')
  .description('Run all stages (alias for default command)')
  .action(function (_opts, command: Command) {
    return runQualOps(command.parent?.opts());
  });

program
  .command('generate-index')
  .description('Generate index of all session reports with statistics')
  .option('--filter <pattern>', 'regex filter for session names to include')
  .action(function (options: Record<string, unknown>, command: Command) {
    const parentOpts = command.parent?.opts() || {};
    const merged = { ...parentOpts, ...options };
    return withErrorHandling(generateIndexCommand, 'generate-index')(merged);
  });

// Add help examples
program.addHelpText('after', formatHelpText());

// Parse arguments and run
program.parse(process.argv);
