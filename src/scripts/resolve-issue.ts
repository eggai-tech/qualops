#!/usr/bin/env node --env-file=.env --experimental-strip-types

import { readFile, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

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
      while (i < lines.length && (inCodeBlock || (!lines[i].startsWith('##')))) {
        if (lines[i].trim() === '```typescript' || lines[i].trim() === '```') {
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

async function resolveIssue(issuePath: string, monorepoRoot: string, dryRun: boolean = true): Promise<void> {
  console.log(`\n📖 Parsing issue: ${issuePath}`);
  const issue = await parseIssueFile(issuePath);

  console.log(`\n📋 Issue Details:`);
  console.log(`   ID: ${issue.id}`);
  console.log(`   Severity: ${issue.severity}`);
  console.log(`   Category: ${issue.category}`);
  console.log(`   File: ${issue.file}`);
  console.log(`   Line: ${issue.line || 'N/A'}`);
  console.log(`   Description: ${issue.description}`);
  console.log(`   Confidence: ${issue.confidence}`);

  const filePath = resolve(monorepoRoot, issue.file);
  console.log(`\n📂 Reading source file: ${filePath}`);

  let sourceContent: string;
  try {
    sourceContent = await readFile(filePath, 'utf-8');
  } catch (error) {
    console.error(`❌ Failed to read source file: ${error}`);
    return;
  }

  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  });

  console.log(`\n🤖 Generating fix using Claude...`);

  const prompt = `You are a code fixing assistant. You need to apply a fix to a TypeScript file.

ISSUE DETAILS:
Description: ${issue.description}
Reasoning: ${issue.reasoning}
Suggested Fix: ${issue.suggestedFix}

ORIGINAL CODE CONTEXT:
${issue.context}

FULL FILE CONTENT:
\`\`\`typescript
${sourceContent}
\`\`\`

Your task: Apply the fix to the code. Return ONLY the complete fixed file content, nothing else. No explanations, no markdown code blocks, just the raw TypeScript code.`;

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 8000,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  let fixedContent = message.content[0].type === 'text' ? message.content[0].text : '';

  if (!fixedContent) {
    console.error('❌ Failed to generate fix');
    return;
  }

  fixedContent = fixedContent.replace(/^```typescript\n/, '').replace(/\n```$/, '').trim();

  console.log(`\n✅ Fix generated successfully`);
  console.log(`\nTokens used: ${message.usage.input_tokens} input, ${message.usage.output_tokens} output`);

  if (dryRun) {
    console.log(`\n🔍 DRY RUN MODE - Changes not applied`);
    console.log(`\nTo apply changes, run with --apply flag`);

    const previewPath = `/tmp/qualops-preview-${issue.id}.ts`;
    await writeFile(previewPath, fixedContent, 'utf-8');
    console.log(`\n📁 Full preview saved to: ${previewPath}`);

    const previewLength = Math.min(500, fixedContent.length);
    console.log(`\n📝 Preview of fixed content (first ${previewLength} chars):`);
    console.log('─'.repeat(80));
    console.log(fixedContent.substring(0, previewLength));
    if (fixedContent.length > previewLength) {
      console.log(`\n... (${fixedContent.length - previewLength} more characters)`);
    }
    console.log('─'.repeat(80));
  } else {
    console.log(`\n✍️  Applying fix to ${filePath}`);
    await writeFile(filePath, fixedContent, 'utf-8');
    console.log(`✅ Fix applied successfully!`);
  }
}

const args = process.argv.slice(2);
const issuePath = args[0];
const applyFlag = args.includes('--apply');

if (!issuePath) {
  console.error('Usage: node resolve-issue.ts <path-to-issue.md> [--apply]');
  console.error('\nExample:');
  console.error('  node resolve-issue.ts reports/qualops-full-2025-10-22/issues/security_input_validation/ISSUE-018.md');
  console.error('\nBy default, runs in dry-run mode. Add --apply to actually modify files.');
  process.exit(1);
}

const projectRoot = process.cwd();

resolveIssue(issuePath, projectRoot, !applyFlag).catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
