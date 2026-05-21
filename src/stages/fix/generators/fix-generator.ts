import { readFile } from 'node:fs/promises';

import type { AIProvider } from '../../../ai/providers/provider';
import { SearchReplaceFixSchema } from '../../../ai/shared/schemas/search-replace-fix';
import { StructuredOutputError } from '../../../ai/shared/structured';
import type { FixSuggestion, ReviewIssue } from '../../../shared/types';

export function getIssueFilePath(issue: ReviewIssue): string {
  return issue.file || (issue.location ? issue.location.split(':')[0] : '');
}

export function extractLineNumber(issue: ReviewIssue): number {
  if (issue.line) return issue.line - 1;

  if (issue.location) {
    const locationParts = issue.location.split(':');
    const lineStr =
      locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
    const lineMatch = lineStr.match(/^(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      return parseInt(lineMatch[1], 10) - 1;
    }
  }

  return 0;
}

function createSearchReplacePrompt(
  issue: ReviewIssue,
  fileContent: string,
  contextCode: string,
  issueLineNumber: number,
): string {
  return `Fix this code quality issue using search/replace.

**ISSUE:**
- Type: ${issue.type}
- Severity: ${issue.severity}
- Description: ${issue.description}
- Location: Line ${issueLineNumber + 1}
- File: ${issue.file}

**CODE CONTEXT (30 lines around issue):**
\`\`\`
${contextCode}
\`\`\`

**FULL FILE (for reference):**
\`\`\`
${fileContent}
\`\`\`

${issue.suggestion ? `**SUGGESTED FIX:**\n${issue.suggestion}\n\n` : ''}Return a search/replace operation that resolves the issue.`;
}

export async function generateAIFix(
  issue: ReviewIssue,
  fileContent: string,
  file: string,
  aiProvider: AIProvider,
): Promise<FixSuggestion> {
  const lines = fileContent.split('\n');
  const issueLineNumber = extractLineNumber(issue);
  const contextStart = Math.max(0, issueLineNumber - 15);
  const contextEnd = Math.min(lines.length, issueLineNumber + 15);
  const contextCode = lines.slice(contextStart, contextEnd).join('\n');

  const prompt = createSearchReplacePrompt(issue, fileContent, contextCode, issueLineNumber);

  let fix;
  try {
    const response = await aiProvider.complete({
      messages: [{ role: 'user', content: prompt, cacheControl: { ttl: '5m' } }],
      schema: SearchReplaceFixSchema,
      maxTokens: 4000,
    });
    fix = response.content;
  } catch (error) {
    if (error instanceof StructuredOutputError) {
      throw new Error(`Failed to generate fix: ${error.message}`);
    }
    throw error;
  }

  const searchOccurrences = fileContent.split(fix.search).length - 1;
  if (searchOccurrences === 0) {
    throw new Error('Search string not found in file');
  }
  if (searchOccurrences > 1) {
    throw new Error(`Search string appears ${searchOccurrences} times, must be unique`);
  }

  return {
    issueId: issue.id,
    file,
    line: issueLineNumber + 1,
    originalCode: fix.search,
    suggestedCode: fix.replace,
    explanation: fix.explanation,
    confidence: fix.confidence,
    breaking: fix.breaking,
    applied: false,
  };
}

export async function generateFix(
  issue: ReviewIssue,
  aiProvider: AIProvider,
): Promise<FixSuggestion> {
  const file = getIssueFilePath(issue);
  if (!file) {
    throw new Error('Unable to determine file path from issue');
  }

  const fileContent = await readFile(file, 'utf-8');

  return await generateAIFix(issue, fileContent, file, aiProvider);
}
