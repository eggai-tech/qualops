import type { AgenticConfig, FileInfo } from '../../../shared/types/config';

export function buildUserPrompt(
  files: FileInfo[],
  config: Pick<AgenticConfig, 'contextMode' | 'maxTokensPerFile' | 'maxTotalTokens'>,
): string {
  const mode = config.contextMode || 'auto';
  const maxPerFile = config.maxTokensPerFile || 8000;
  const maxTotal = config.maxTotalTokens || 50000;

  let totalTokens = 0;
  const fileContexts: string[] = [];

  const sorted = [...files].sort((a, b) => {
    const aChanges = (a.diff?.additions.size || 0) + (a.diff?.deletions.size || 0);
    const bChanges = (b.diff?.additions.size || 0) + (b.diff?.deletions.size || 0);
    return bChanges - aChanges;
  });

  for (const file of sorted) {
    const ctx = buildFileContext(file, mode, maxPerFile, maxTotal - totalTokens);
    if (ctx) {
      fileContexts.push(ctx);
      totalTokens += estimateTokens(ctx);
    }
    if (totalTokens >= maxTotal) break;
  }

  return `Review the following changed files for issues.

${fileContexts.join('\n\n---\n\n')}

Return issues as JSON. If checking dependencies, use Grep/Glob tools.`;
}

export function buildFileContext(
  file: FileInfo,
  mode: string,
  maxTokens: number,
  remainingBudget: number,
): string {
  const budget = Math.min(maxTokens, remainingBudget);
  const useDiff = mode === 'diff' || (mode === 'auto' && file.rawDiff);

  let content: string;
  if (useDiff && file.rawDiff) {
    content = `### Diff\n\`\`\`diff\n${file.rawDiff}\n\`\`\``;
  } else {
    content = formatFileContent(file.content, budget);
  }

  const header = `## ${file.path}${file.framework ? ` (${file.framework})` : ''}`;
  return `${header}\n\n${content}`;
}

export function formatFileContent(content: string, maxTokens: number): string {
  const lines = content.split('\n');
  const maxLines = Math.floor(maxTokens / 10);

  if (lines.length <= maxLines) {
    return addLineNumbers(content);
  }

  const truncated = lines.slice(0, maxLines).join('\n');
  return `${addLineNumbers(truncated)}\n[TRUNCATED: ${lines.length - maxLines} more lines]`;
}

export function addLineNumbers(content: string): string {
  return content
    .split('\n')
    .map((line, i) => `${String(i + 1).padStart(4)} | ${line}`)
    .join('\n');
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
