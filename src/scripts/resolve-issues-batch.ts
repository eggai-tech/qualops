#!/usr/bin/env node --env-file=.env --experimental-strip-types

import { exec } from 'child_process';
import { readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { promisify } from 'util';

const execAsync = promisify(exec);

interface BatchOptions {
  category?: string;
  severity?: string;
  limit?: number;
  apply: boolean;
  interactive: boolean;
}

async function getIssueFiles(issuesDir: string, category?: string): Promise<string[]> {
  const issues: string[] = [];

  if (category) {
    const categoryPath = join(issuesDir, category);
    const files = await readdir(categoryPath);
    return files.filter((f) => f.endsWith('.md')).map((f) => join(categoryPath, f));
  }

  const categories = await readdir(issuesDir);
  for (const cat of categories) {
    const catPath = join(issuesDir, cat);
    try {
      const files = await readdir(catPath);
      const mdFiles = files.filter((f) => f.endsWith('.md')).map((f) => join(catPath, f));
      issues.push(...mdFiles);
    } catch {
      continue;
    }
  }

  return issues;
}

async function resolveIssueFile(issuePath: string, apply: boolean): Promise<{ success: boolean; error?: string }> {
  const applyFlag = apply ? '--apply' : '';
  const scriptPath = resolve(process.cwd(), 'src/scripts/resolve-issue.ts');

  try {
    const { stdout, stderr } = await execAsync(
      `node --env-file=../../.env --experimental-strip-types ${scriptPath} ${issuePath} ${applyFlag}`,
      { maxBuffer: 10 * 1024 * 1024 }
    );

    if (stderr && !stderr.includes('ExperimentalWarning')) {
      return { success: false, error: stderr };
    }

    console.log(stdout);
    return { success: true };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

async function main() {
  const args = process.argv.slice(2);

  const options: BatchOptions = {
    apply: args.includes('--apply'),
    interactive: args.includes('--interactive'),
  };

  const categoryIdx = args.indexOf('--category');
  if (categoryIdx !== -1) {
    options.category = args[categoryIdx + 1];
  }

  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1) {
    options.limit = parseInt(args[limitIdx + 1]);
  }

  const issuesDir = args.find((arg) => !arg.startsWith('--')) || '../../reports/qualops-full-2025-10-22/issues';

  console.log(`\n🔍 Scanning for issues in: ${issuesDir}`);
  if (options.category) {
    console.log(`   Category filter: ${options.category}`);
  }
  if (options.limit) {
    console.log(`   Limit: ${options.limit} issues`);
  }
  console.log(`   Mode: ${options.apply ? 'APPLY FIXES' : 'DRY RUN'}\n`);

  let issueFiles = await getIssueFiles(issuesDir, options.category);

  if (options.limit) {
    issueFiles = issueFiles.slice(0, options.limit);
  }

  console.log(`📋 Found ${issueFiles.length} issues to process\n`);

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const issuePath of issueFiles) {
    processed++;
    console.log(`\n${'='.repeat(80)}`);
    console.log(`[${processed}/${issueFiles.length}] Processing: ${issuePath}`);
    console.log('='.repeat(80));

    const result = await resolveIssueFile(issuePath, options.apply);

    if (result.success) {
      succeeded++;
    } else {
      failed++;
      console.error(`❌ Failed: ${result.error}`);
    }

    if (options.interactive && processed < issueFiles.length) {
      console.log('\nPress Enter to continue or Ctrl+C to stop...');
      await new Promise((resolve) => {
        process.stdin.once('data', resolve);
      });
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 SUMMARY');
  console.log('='.repeat(80));
  console.log(`Total processed: ${processed}`);
  console.log(`Succeeded: ${succeeded}`);
  console.log(`Failed: ${failed}`);
  console.log('='.repeat(80));
}

if (process.argv.length < 3 || process.argv.includes('--help')) {
  console.log(`
Usage: resolve-issues-batch.ts [issues-dir] [options]

Options:
  --category <name>    Process only issues from specific category
  --limit <number>     Limit number of issues to process
  --apply              Apply fixes (default: dry-run)
  --interactive        Pause between each issue
  --help               Show this help

Examples:
  # Dry run all issues
  node resolve-issues-batch.ts ../../reports/qualops-full-2025-10-22/issues

  # Apply fixes to security issues only (first 5)
  node resolve-issues-batch.ts --category security_input_validation --limit 5 --apply

  # Interactive mode for code quality issues
  node resolve-issues-batch.ts --category code_quality --interactive

Categories:
  - architecture_violations
  - code_quality
  - memory_leaks_cleanup
  - null_undefined_safety
  - performance
  - race_conditions_async
  - rxjs_operator_misuse
  - security_input_validation
  `);
  process.exit(0);
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
