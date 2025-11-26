import { readFile } from 'node:fs/promises';

import type { AIProvider } from '../../../ai/providers/provider';
import type { FixSuggestion, ReviewIssue } from '../../../shared/types';

export function getIssueFilePath(issue: ReviewIssue): string {
  return issue.file || (issue.location ? issue.location.split(':')[0] : '');
}

export function extractLineNumber(issue: ReviewIssue): number {
  if (issue.line) return issue.line - 1; // Convert to 0-based index

  if (issue.location) {
    const locationParts = issue.location.split(':');
    const lineStr =
      locationParts.length > 1 ? locationParts[locationParts.length - 1] : locationParts[0];
    const lineMatch = lineStr.match(/^(\d+)(?:-(\d+))?$/);
    if (lineMatch) {
      return parseInt(lineMatch[1], 10) - 1; // Convert to 0-based index
    }
  }

  return 0; // Default to first line
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
\`\`\`typescript
${contextCode}
\`\`\`

**FULL FILE (for reference):**
\`\`\`typescript
${fileContent}
\`\`\`

${issue.suggestion ? `**SUGGESTED FIX:**\n${issue.suggestion}\n\n` : ''}

**INSTRUCTIONS:**
Return a JSON object with a search/replace operation:

{
  "search": "exact code block to find (5-10 lines, must be unique)",
  "replace": "fixed version of the same code block",
  "explanation": "what changed and why",
  "confidence": "high|medium|low",
  "breaking": true|false
}

**RULES:**
1. Search string must appear EXACTLY ONCE in the file
2. Include 2-3 lines before/after the problem for uniqueness
3. Preserve exact indentation and whitespace
4. Only include code that needs changing
5. Return ONLY the JSON, no markdown or extra text`;
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

  const response = await aiProvider.invoke(prompt, 4000, { enableCaching: true });

  let jsonStr = response.trim();
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr
      .replace(/```json\n?/g, '')
      .replace(/```\s*$/g, '')
      .trim();
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr
      .replace(/```\n?/g, '')
      .replace(/```\s*$/g, '')
      .trim();
  }

  const fixData = JSON.parse(jsonStr);

  if (!fixData.search || !fixData.replace) {
    throw new Error('AI response missing search or replace fields');
  }

  const searchOccurrences = fileContent.split(fixData.search).length - 1;
  if (searchOccurrences === 0) {
    throw new Error('Search string not found in file');
  }
  if (searchOccurrences > 1) {
    throw new Error(`Search string appears ${searchOccurrences} times, must be unique`);
  }

  return {
    issueId: issue.id,
    file: file,
    line: issueLineNumber + 1,
    originalCode: fixData.search,
    suggestedCode: fixData.replace,
    explanation: fixData.explanation || 'Fix applied',
    confidence: (fixData.confidence || 'medium') as 'high' | 'medium' | 'low',
    breaking: fixData.breaking === true,
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
