import type { FileInfo } from '../../../shared/types/config';

/**
 * Build the MR diff-context block that is inserted above file content.
 * Returns an empty string when no diff information is available.
 */
export function buildDiffContext(file: FileInfo): string {
  if (!file.diff) return '';

  const addedLines = Array.from(file.diff.additions).sort((a, b) => a - b);
  const deletedLines = Array.from(file.diff.deletions).sort((a, b) => a - b);
  if (addedLines.length === 0 && deletedLines.length === 0) return '';

  return `
**THIS IS A MERGE REQUEST REVIEW**
Changes in this MR:
- Lines added: ${addedLines.length > 0 ? addedLines.join(', ') : 'none'}
- Lines deleted: ${deletedLines.length > 0 ? deletedLines.join(', ') : 'none'}

IMPORTANT: Focus your review ONLY on the changed lines above. The rest of the file is shown for context.
Do NOT report issues in unchanged code unless they are directly related to the changes in this MR.`;
}

export function addLineNumbers(content: string): string {
  const lines = content.split('\n');
  return lines
    .map((line, index) => {
      const lineNumber = (index + 1).toString().padStart(5, ' ');
      return `${lineNumber} | ${line}`;
    })
    .join('\n');
}

export function extractLineNumber(location: string): number | null {
  const match = location.match(/(?:line[s]?\s+)?(\d+)/i);
  return match ? parseInt(match[1], 10) : null;
}

export function removeLineNumbers(numberedContent: string): string {
  const lines = numberedContent.split('\n');
  return lines
    .map((line) => {
      const match = line.match(/^\s*\d+\s*\|\s?(.*)/);
      return match ? match[1] : line;
    })
    .join('\n');
}

export function getLineRange(numberedContent: string, startLine: number, endLine: number): string {
  const lines = numberedContent.split('\n');
  const start = Math.max(0, startLine - 1);
  const end = Math.min(lines.length, endLine);
  return lines.slice(start, end).join('\n');
}

export function findCodePatternLine(content: string, codePattern: string): number | null {
  const lines = content.split('\n');
  const cleanPattern = codePattern.trim();

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(cleanPattern)) {
      return i + 1;
    }
  }

  const normalizedPattern = cleanPattern.replace(/\s+/g, ' ');
  for (let i = 0; i < lines.length; i++) {
    const normalizedLine = lines[i].replace(/\s+/g, ' ').trim();
    if (normalizedLine.includes(normalizedPattern)) {
      return i + 1;
    }
  }

  return null;
}
