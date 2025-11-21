import type { FixSuggestion } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

export interface DiffSegment {
  type: 'add' | 'remove' | 'context' | 'modify';
  content: string;
  lineNumber?: number;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface FileDiff {
  filePath: string;
  segments: DiffSegment[];
  stats: {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
    totalLines: number;
  };
}

export interface DiffOptions {
  contextLines?: number;
  ignoreWhitespace?: boolean;
  showLineNumbers?: boolean;
}

export function calculateDiff(originalCode: string, suggestedCode: string, options: DiffOptions = {}): DiffSegment[] {
  const { contextLines = 3, ignoreWhitespace = false, showLineNumbers = true } = options;

  const originalLines = normalizeLines(originalCode, ignoreWhitespace);
  const suggestedLines = normalizeLines(suggestedCode, ignoreWhitespace);

  return calculateMyersDiff(originalLines, suggestedLines, contextLines, showLineNumbers);
}

export function calculateFixDiff(suggestion: FixSuggestion, options: DiffOptions = {}): FileDiff {
  logger.debug(`Calculating diff for ${suggestion.file}:${suggestion.line}`);

  const segments = calculateDiff(suggestion.originalCode, suggestion.suggestedCode || '', options);

  const stats = calculateDiffStats(segments);

  return {
    filePath: suggestion.file,
    segments,
    stats,
  };
}

export function calculateMultiVersionDiff(
  versions: { name: string; content: string }[],
  options: DiffOptions = {},
): Map<string, FileDiff[]> {
  const results = new Map<string, FileDiff[]>();

  for (let i = 0; i < versions.length - 1; i++) {
    const current = versions[i];
    const next = versions[i + 1];

    const segments = calculateDiff(current.content, next.content, options);
    const stats = calculateDiffStats(segments);

    const diff: FileDiff = {
      filePath: `${current.name} → ${next.name}`,
      segments,
      stats,
    };

    const key = `${current.name}-${next.name}`;
    if (!results.has(key)) {
      results.set(key, []);
    }
    const keyResults = results.get(key);
    if (keyResults) {
      keyResults.push(diff);
    }
  }

  return results;
}

function calculateMyersDiff(
  originalLines: string[],
  suggestedLines: string[],
  contextLines: number,
  showLineNumbers: boolean,
): DiffSegment[] {
  const segments: DiffSegment[] = [];
  const m = originalLines.length;
  const n = suggestedLines.length;

  // Create a 2D array for dynamic programming
  const lcs = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  // Calculate longest common subsequence
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (originalLines[i - 1] === suggestedLines[j - 1]) {
        lcs[i][j] = lcs[i - 1][j - 1] + 1;
      } else {
        lcs[i][j] = Math.max(lcs[i - 1][j], lcs[i][j - 1]);
      }
    }
  }

  // Backtrack to build the diff
  let i = m;
  let j = n;
  const diffOps: { type: 'add' | 'remove' | 'keep'; line: string; oldLine?: number; newLine?: number }[] = [];

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && originalLines[i - 1] === suggestedLines[j - 1]) {
      diffOps.unshift({
        type: 'keep',
        line: originalLines[i - 1],
        oldLine: i,
        newLine: j,
      });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || lcs[i][j - 1] >= lcs[i - 1][j])) {
      diffOps.unshift({
        type: 'add',
        line: suggestedLines[j - 1],
        newLine: j,
      });
      j--;
    } else if (i > 0) {
      diffOps.unshift({
        type: 'remove',
        line: originalLines[i - 1],
        oldLine: i,
      });
      i--;
    }
  }

  // Convert diff operations to segments with context
  let currentContext = 0;
  let inChanges = false;

  for (let idx = 0; idx < diffOps.length; idx++) {
    const op = diffOps[idx];

    if (op.type === 'keep') {
      if (inChanges) {
        // Add context after changes
        if (currentContext < contextLines) {
          segments.push({
            type: 'context',
            content: op.line,
            lineNumber: showLineNumbers ? op.oldLine || 0 : undefined,
            oldLineNumber: op.oldLine,
            newLineNumber: op.newLine,
          });
          currentContext++;
        } else {
          inChanges = false;
          currentContext = 0;
        }
      } else {
        // Check if changes are coming up
        const hasChangesAhead = diffOps.slice(idx + 1, idx + 1 + contextLines).some((nextOp) => nextOp.type !== 'keep');

        if (hasChangesAhead) {
          segments.push({
            type: 'context',
            content: op.line,
            lineNumber: showLineNumbers ? op.oldLine || 0 : undefined,
            oldLineNumber: op.oldLine,
            newLineNumber: op.newLine,
          });
        }
      }
    } else {
      if (!inChanges) {
        inChanges = true;
        currentContext = 0;
      }

      segments.push({
        type: op.type,
        content: op.line,
        lineNumber: showLineNumbers ? op.oldLine || op.newLine || 0 : undefined,
        oldLineNumber: op.oldLine,
        newLineNumber: op.newLine,
      });
    }
  }

  return segments;
}

function normalizeLines(code: string, ignoreWhitespace: boolean): string[] {
  let lines = code.split('\n');

  if (ignoreWhitespace) {
    lines = lines.map((line) => line.trim());
  }

  return lines;
}

function calculateDiffStats(segments: DiffSegment[]): FileDiff['stats'] {
  const stats = {
    linesAdded: 0,
    linesRemoved: 0,
    linesModified: 0,
    totalLines: 0,
  };

  let consecutiveRemoves = 0;
  let consecutiveAdds = 0;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];

    switch (segment.type) {
      case 'add':
        stats.linesAdded++;
        consecutiveAdds++;
        consecutiveRemoves = 0;
        break;

      case 'remove':
        stats.linesRemoved++;
        consecutiveRemoves++;
        consecutiveAdds = 0;
        break;

      case 'context': {
        // Check if previous consecutive removes/adds should be counted as modifications
        if (consecutiveRemoves > 0 && consecutiveAdds > 0) {
          const modifications = Math.min(consecutiveRemoves, consecutiveAdds);
          stats.linesModified += modifications;
          stats.linesAdded -= modifications;
          stats.linesRemoved -= modifications;
        }
        consecutiveRemoves = 0;
        consecutiveAdds = 0;
        break;
      }

      case 'modify':
        stats.linesModified++;
        break;
    }

    stats.totalLines++;
  }

  // Handle remaining consecutive removes/adds at the end
  if (consecutiveRemoves > 0 && consecutiveAdds > 0) {
    const modifications = Math.min(consecutiveRemoves, consecutiveAdds);
    stats.linesModified += modifications;
    stats.linesAdded -= modifications;
    stats.linesRemoved -= modifications;
  }

  return stats;
}

export function formatUnifiedDiff(
  fileDiff: FileDiff,
  originalFileName = 'original',
  suggestedFileName = 'suggested',
): string {
  const lines: string[] = [];

  // Add header
  lines.push(`--- ${originalFileName}`);
  lines.push(`+++ ${suggestedFileName}`);

  // Group segments into hunks
  const hunks = groupSegmentsIntoHunks(fileDiff.segments);

  for (const hunk of hunks) {
    // Add hunk header
    const oldStart = hunk.oldStart;
    const oldCount = hunk.oldCount;
    const newStart = hunk.newStart;
    const newCount = hunk.newCount;

    lines.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    // Add hunk content
    for (const segment of hunk.segments) {
      let prefix = ' ';
      switch (segment.type) {
        case 'add':
          prefix = '+';
          break;
        case 'remove':
          prefix = '-';
          break;
        case 'context':
          prefix = ' ';
          break;
        case 'modify':
          prefix = '!';
          break;
      }

      lines.push(`${prefix}${segment.content}`);
    }
  }

  return lines.join('\n');
}

function groupSegmentsIntoHunks(segments: DiffSegment[]): Array<{
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  segments: DiffSegment[];
}> {
  const hunks: Array<{
    oldStart: number;
    oldCount: number;
    newStart: number;
    newCount: number;
    segments: DiffSegment[];
  }> = [];

  if (segments.length === 0) {
    return hunks;
  }

  const currentHunk = {
    oldStart: segments[0].oldLineNumber || 1,
    oldCount: 0,
    newStart: segments[0].newLineNumber || 1,
    newCount: 0,
    segments: [] as DiffSegment[],
  };

  for (const segment of segments) {
    currentHunk.segments.push(segment);

    switch (segment.type) {
      case 'add':
        currentHunk.newCount++;
        break;
      case 'remove':
        currentHunk.oldCount++;
        break;
      case 'context':
        currentHunk.oldCount++;
        currentHunk.newCount++;
        break;
      case 'modify':
        currentHunk.oldCount++;
        currentHunk.newCount++;
        break;
    }
  }

  hunks.push(currentHunk);
  return hunks;
}

export function formatSideBySideDiff(fileDiff: FileDiff): string {
  const lines: string[] = [];
  const maxLineLength = 60;

  lines.push('Original'.padEnd(maxLineLength) + ' | ' + 'Suggested'.padEnd(maxLineLength));
  lines.push('-'.repeat(maxLineLength) + ' | ' + '-'.repeat(maxLineLength));

  for (const segment of fileDiff.segments) {
    const leftSide = segment.type === 'add' ? '' : segment.content;
    const rightSide = segment.type === 'remove' ? '' : segment.content;

    const leftFormatted = leftSide.padEnd(maxLineLength).substring(0, maxLineLength);
    const rightFormatted = rightSide.padEnd(maxLineLength).substring(0, maxLineLength);

    let marker = ' ';
    switch (segment.type) {
      case 'add':
        marker = '+';
        break;
      case 'remove':
        marker = '-';
        break;
      case 'modify':
        marker = '!';
        break;
    }

    lines.push(`${leftFormatted} ${marker} ${rightFormatted}`);
  }

  return lines.join('\n');
}

export function calculateSimilarity(str1: string, str2: string): number {
  if (str1 === str2) return 100;
  if (str1.length === 0 && str2.length === 0) return 100;
  if (str1.length === 0 || str2.length === 0) return 0;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  const distance = levenshteinDistance(longer, shorter);
  const similarity = ((longer.length - distance) / longer.length) * 100;

  return Math.round(similarity);
}

function levenshteinDistance(str1: string, str2: string): number {
  const matrix = Array(str2.length + 1)
    .fill(null)
    .map(() => Array(str1.length + 1).fill(null));

  for (let i = 0; i <= str1.length; i++) {
    matrix[0][i] = i;
  }

  for (let j = 0; j <= str2.length; j++) {
    matrix[j][0] = j;
  }

  for (let j = 1; j <= str2.length; j++) {
    for (let i = 1; i <= str1.length; i++) {
      const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
      matrix[j][i] = Math.min(
        matrix[j][i - 1] + 1, // deletion
        matrix[j - 1][i] + 1, // insertion
        matrix[j - 1][i - 1] + indicator, // substitution
      );
    }
  }

  return matrix[str2.length][str1.length];
}
