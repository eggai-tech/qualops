import type { FixSuggestion } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

export interface PatchMetadata {
  file: string;
  startLine: number;
  endLine: number;
  originalLines: string[];
  suggestedLines: string[];
  context: {
    before: string[];
    after: string[];
  };
}

export interface GeneratedPatch {
  id: string;
  type: 'unified' | 'context' | 'simple';
  header: string;
  hunks: PatchHunk[];
  metadata: PatchMetadata;
}

export interface PatchHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: PatchLine[];
}

export interface PatchLine {
  type: 'context' | 'delete' | 'add';
  content: string;
  lineNumber?: number;
}

export function generateUnifiedPatch(suggestion: FixSuggestion): GeneratedPatch {
  const originalLines = suggestion.originalCode.split('\n');
  const suggestedLines = suggestion.suggestedCode.split('\n');

  const startLine = suggestion.line || 1;
  const endLine = startLine + originalLines.length - 1;

  const timestamp = new Date().toISOString();
  const header = `--- a/${suggestion.file}\t${timestamp}
+++ b/${suggestion.file}\t${timestamp}`;

  const contextLines = 3;
  const hunkStart = Math.max(1, startLine - contextLines);
  const _hunkEnd = endLine + contextLines;

  const patchLines: PatchLine[] = [];

  for (let i = 0; i < contextLines && startLine - contextLines + i > 0; i++) {
    patchLines.push({
      type: 'context',
      content: ` [context line ${startLine - contextLines + i}]`,
      lineNumber: startLine - contextLines + i,
    });
  }

  originalLines.forEach((line, index) => {
    patchLines.push({
      type: 'delete',
      content: `-${line}`,
      lineNumber: startLine + index,
    });
  });

  suggestedLines.forEach((line, index) => {
    patchLines.push({
      type: 'add',
      content: `+${line}`,
      lineNumber: startLine + index,
    });
  });

  for (let i = 0; i < contextLines; i++) {
    patchLines.push({
      type: 'context',
      content: ` [context line ${endLine + i + 1}]`,
      lineNumber: endLine + i + 1,
    });
  }

  const hunk: PatchHunk = {
    oldStart: hunkStart,
    oldCount: originalLines.length + contextLines * 2,
    newStart: hunkStart,
    newCount: suggestedLines.length + contextLines * 2,
    lines: patchLines,
  };

  return {
    id: `patch-${suggestion.issueId}-${Date.now()}`,
    type: 'unified',
    header,
    hunks: [hunk],
    metadata: {
      file: suggestion.file,
      startLine,
      endLine,
      originalLines,
      suggestedLines,
      context: {
        before: [],
        after: [],
      },
    },
  };
}

export function generateSimplePatch(suggestion: FixSuggestion): GeneratedPatch {
  const originalLines = suggestion.originalCode.split('\n');
  const suggestedLines = suggestion.suggestedCode.split('\n');

  const startLine = suggestion.line || 1;
  const endLine = startLine + originalLines.length - 1;

  const header = `File: ${suggestion.file}
Lines: ${startLine}-${endLine}
Confidence: ${suggestion.confidence}
Breaking: ${suggestion.breaking}
`;

  const patchLines: PatchLine[] = [];

  patchLines.push({
    type: 'context',
    content: '--- Original ---',
  });

  originalLines.forEach((line, index) => {
    patchLines.push({
      type: 'delete',
      content: line,
      lineNumber: startLine + index,
    });
  });

  patchLines.push({
    type: 'context',
    content: '--- Suggested ---',
  });

  suggestedLines.forEach((line, index) => {
    patchLines.push({
      type: 'add',
      content: line,
      lineNumber: startLine + index,
    });
  });

  const hunk: PatchHunk = {
    oldStart: startLine,
    oldCount: originalLines.length,
    newStart: startLine,
    newCount: suggestedLines.length,
    lines: patchLines,
  };

  return {
    id: `simple-patch-${suggestion.issueId}-${Date.now()}`,
    type: 'simple',
    header,
    hunks: [hunk],
    metadata: {
      file: suggestion.file,
      startLine,
      endLine,
      originalLines,
      suggestedLines,
      context: {
        before: [],
        after: [],
      },
    },
  };
}

export function patchToString(patch: GeneratedPatch): string {
  let result = patch.header + '\n';

  for (const hunk of patch.hunks) {
    if (patch.type === 'unified') {
      result += `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@\n`;
    }

    for (const line of hunk.lines) {
      result += line.content + '\n';
    }
  }

  return result;
}

export function generatePatches(suggestion: FixSuggestion): {
  unified: GeneratedPatch;
  simple: GeneratedPatch;
} {
  logger.info(`Generating patches for ${suggestion.file}:${suggestion.line}`);

  const unified = generateUnifiedPatch(suggestion);
  const simple = generateSimplePatch(suggestion);

  return { unified, simple };
}

export function validatePatch(
  patch: GeneratedPatch,
  fileContent: string,
): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const lines = fileContent.split('\n');

  if (lines.length < patch.metadata.endLine) {
    errors.push(`File has ${lines.length} lines but patch expects at least ${patch.metadata.endLine}`);
  }

  const startIdx = (patch.metadata.startLine || 1) - 1;
  for (let i = 0; i < patch.metadata.originalLines.length; i++) {
    const fileLineIndex = startIdx + i;
    if (fileLineIndex >= lines.length) {
      errors.push(`Line ${fileLineIndex + 1} is beyond file length`);
      continue;
    }

    const fileLine = lines[fileLineIndex].trim();
    const patchLine = patch.metadata.originalLines[i].trim();

    if (fileLine !== patchLine) {
      errors.push(`Line ${fileLineIndex + 1} mismatch: expected "${patchLine}", found "${fileLine}"`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
