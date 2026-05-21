#!/usr/bin/env node --env-file=.env --experimental-strip-types

import { readFile, writeFile } from 'fs/promises';
import { extname } from 'node:path';

import { AIFactory } from '../ai/providers/factory';
import { logger } from '../shared/utils/logger';
import { resolveWithinCwd } from '../shared/utils/security';

interface ParsedIssue {
  id: string;
  status: string;
  severity: string;
  category: string;
  file: string;
  line?: number;
  description: string;
  reasoning: string;
  context: string;
  suggestedFix: string;
  confidence: string;
}

async function parseIssueFile(issuePath: string): Promise<ParsedIssue> {
  const content = await readFile(issuePath, 'utf-8');
  const lines = content.split('\n');

  const issue: Partial<ParsedIssue> = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    if (line.startsWith('# ISSUE-')) {
      issue.id = line.replace('# ', '');
    } else if (line.startsWith('**Status:**')) {
      issue.status = line.split('**Status:**')[1].trim();
    } else if (line.startsWith('**Severity:**')) {
      issue.severity = line.split('**Severity:**')[1].trim();
    } else if (line.startsWith('**Category:**')) {
      issue.category = line.split('**Category:**')[1].trim();
    } else if (line.startsWith('**File:**')) {
      const fileMatch = line.match(/`([^`]+)`/);
      if (fileMatch) issue.file = fileMatch[1];
    } else if (line.startsWith('**Line:**')) {
      const lineNum = parseInt(line.split('**Line:**')[1].trim());
      if (!isNaN(lineNum)) issue.line = lineNum;
    } else if (line === '## Description') {
      i += 2;
      issue.description = lines[i].trim();
    } else if (line === '## Reasoning') {
      i += 2;
      const reasoningLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('##')) {
        reasoningLines.push(lines[i]);
        i++;
      }
      issue.reasoning = reasoningLines.join('\n').trim();
    } else if (line === '## Context') {
      i += 2;
      const contextLines: string[] = [];
      let inCodeBlock = false;
      while (i < lines.length && (inCodeBlock || !lines[i].startsWith('##'))) {
        if (lines[i].trim().startsWith('```')) {
          inCodeBlock = !inCodeBlock;
        }
        contextLines.push(lines[i]);
        i++;
        if (!inCodeBlock && lines[i]?.trim() === '') {
          break;
        }
      }
      issue.context = contextLines.join('\n').trim();
    } else if (line === '## Suggested Fix') {
      i += 2;
      const fixLines: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].startsWith('##')) {
        fixLines.push(lines[i]);
        i++;
      }
      issue.suggestedFix = fixLines.join('\n').trim();
    } else if (line === '## Confidence') {
      i += 2;
      issue.confidence = lines[i].trim();
    }
  }

  return issue as ParsedIssue;
}

async function resolveIssue(
  issuePath: string,
  monorepoRoot: string,
  dryRun: boolean = true,
): Promise<void> {
  logger.info(`\n📖 Parsing issue: ${issuePath}`);
  const issue = await parseIssueFile(issuePath);

  logger.info(`\n📋 Issue Details:`);
  logger.info(`   ID: ${issue.id}`);
  logger.info(`   Severity: ${issue.severity}`);
  logger.info(`   Category: ${issue.category}`);
  logger.info(`   File: ${issue.file}`);
  logger.info(`   Line: ${issue.line || 'N/A'}`);
  logger.info(`   Description: ${issue.description}`);
  logger.info(`   Confidence: ${issue.confidence}`);

  const filePath = resolveWithinCwd(monorepoRoot, issue.file);
  if (!filePath) {
    logger.error(`❌ Rejected path outside project root: ${issue.file}`);
    return;
  }
  logger.info(`\n📂 Reading source file: ${filePath}`);

  let sourceContent: string;
  try {
    sourceContent = await readFile(filePath, 'utf-8');
  } catch (error) {
    logger.error(`❌ Failed to read source file: ${error}`);
    return;
  }

  logger.info(`\n🤖 Generating fix...`);

  const prompt = `You are a code fixing assistant. You need to apply a fix to a source file.

ISSUE DETAILS:
Description: ${issue.description}
Reasoning: ${issue.reasoning}
Suggested Fix: ${issue.suggestedFix}

ORIGINAL CODE CONTEXT:
${issue.context}

FULL FILE CONTENT:
\`\`\`
${sourceContent}
\`\`\`

Your task: Apply the fix to the code. Return ONLY the complete fixed file content, nothing else. No explanations, no markdown code blocks, just the raw source code.`;

  const provider = await AIFactory.createForStage('review');
  let fixedContent = await provider.invoke(prompt, 8000);

  if (!fixedContent) {
    logger.error('❌ Failed to generate fix');
    return;
  }

  fixedContent = fixedContent
    .replace(/^```[^\n]*\n/, '')
    .replace(/\n```$/, '')
    .trim();

  logger.info(`\n✅ Fix generated successfully`);

  if (dryRun) {
    logger.info(`\n🔍 DRY RUN MODE - Changes not applied`);
    logger.info(`\nTo apply changes, run with --apply flag`);

    const previewPath = `/tmp/qualops-preview-${issue.id}${extname(filePath) || '.txt'}`;
    await writeFile(previewPath, fixedContent, 'utf-8');
    logger.info(`\n📁 Full preview saved to: ${previewPath}`);

    const previewLength = Math.min(500, fixedContent.length);
    logger.info(`\n📝 Preview of fixed content (first ${previewLength} chars):`);
    logger.info('─'.repeat(80));
    logger.info(fixedContent.substring(0, previewLength));
    if (fixedContent.length > previewLength) {
      logger.info(`\n... (${fixedContent.length - previewLength} more characters)`);
    }
    logger.info('─'.repeat(80));
  } else {
    logger.info(`\n✍️  Applying fix to ${filePath}`);
    await writeFile(filePath, fixedContent, 'utf-8');
    logger.info(`✅ Fix applied successfully!`);
  }
}

const args = process.argv.slice(2);
const issuePath = args[0];
const applyFlag = args.includes('--apply');

if (!issuePath) {
  logger.error('Usage: node resolve-issue.ts <path-to-issue.md> [--apply]');
  logger.error('\nExample:');
  logger.error(
    '  node resolve-issue.ts reports/qualops-full-2025-10-22/issues/security_input_validation/ISSUE-018.md',
  );
  logger.error('\nBy default, runs in dry-run mode. Add --apply to actually modify files.');
  process.exit(1);
}

const projectRoot = process.cwd();

resolveIssue(issuePath, projectRoot, !applyFlag).catch((error) => {
  logger.error('Error:', error);
  process.exit(1);
});
