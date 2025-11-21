import { readFile, writeFile } from 'node:fs/promises';

import { createBackup } from './backup-manager';
import type { FixSuggestion } from '../../../shared/types';
import { logger } from '../../../shared/utils/logger';

export interface ApplyResult {
  success: boolean;
  filePath: string;
  backupPath?: string;
  error?: string;
  appliedChanges: {
    linesAdded: number;
    linesRemoved: number;
    linesModified: number;
  };
}

export interface ApplyOptions {
  dryRun?: boolean;
  createBackup?: boolean;
  validateSyntax?: boolean;
  force?: boolean;
}

function normalizeLineEndings(str: string): string {
  return str.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function calculateChanges(
  original: string,
  modified: string,
): {
  linesAdded: number;
  linesRemoved: number;
  linesModified: number;
} {
  const originalLines = original.split('\n');
  const modifiedLines = modified.split('\n');

  const linesAdded = Math.max(0, modifiedLines.length - originalLines.length);
  const linesRemoved = Math.max(0, originalLines.length - modifiedLines.length);

  // Count modified lines (simple heuristic)
  const minLength = Math.min(originalLines.length, modifiedLines.length);
  let linesModified = 0;
  for (let i = 0; i < minLength; i++) {
    if (originalLines[i] !== modifiedLines[i]) {
      linesModified++;
    }
  }

  return { linesAdded, linesRemoved, linesModified };
}

async function applyExactMatch(
  content: string,
  suggestion: FixSuggestion,
): Promise<{ newContent: string; applied: boolean }> {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedOriginal = normalizeLineEndings(suggestion.originalCode);
  const normalizedSuggested = normalizeLineEndings(suggestion.suggestedCode || '');

  if (normalizedContent.includes(normalizedOriginal)) {
    // Use position-based replacement for the first occurrence to avoid unintended replacements
    const index = normalizedContent.indexOf(normalizedOriginal);
    const newContent =
      normalizedContent.substring(0, index) +
      normalizedSuggested +
      normalizedContent.substring(index + normalizedOriginal.length);

    return { newContent, applied: true };
  }

  return { newContent: content, applied: false };
}

async function applyFuzzyMatch(
  content: string,
  suggestion: FixSuggestion,
): Promise<{ newContent: string; applied: boolean }> {
  const normalizedContent = normalizeLineEndings(content);
  const normalizedOriginal = normalizeLineEndings(suggestion.originalCode);
  const normalizedSuggested = normalizeLineEndings(suggestion.suggestedCode || '');

  const trimmedOriginal = normalizedOriginal.trim();
  const trimmedSuggested = normalizedSuggested.trim();

  const index = normalizedContent.indexOf(trimmedOriginal);
  if (index !== -1) {
    let startIndex = index;
    const endIndex = index + trimmedOriginal.length;

    // Find the start of the line to preserve indentation
    while (
      startIndex > 0 &&
      (normalizedContent[startIndex - 1] === ' ' || normalizedContent[startIndex - 1] === '\t')
    ) {
      startIndex--;
    }

    const actualOriginal = normalizedContent.substring(startIndex, endIndex);

    // Preserve leading whitespace
    const leadingWhitespace = actualOriginal.match(/^[\s]*/)?.[0] || '';
    const indentedSuggested = trimmedSuggested
      .split('\n')
      .map((line, idx) => (idx === 0 ? leadingWhitespace + line : line))
      .join('\n');

    const newContent =
      normalizedContent.substring(0, startIndex) + indentedSuggested + normalizedContent.substring(endIndex);

    return { newContent, applied: true };
  }

  return { newContent: content, applied: false };
}

export async function applySingleFix(suggestion: FixSuggestion, options: ApplyOptions = {}): Promise<ApplyResult> {
  const { dryRun = false, createBackup: shouldCreateBackup = true, force = false } = options;

  logger.info(`${dryRun ? 'Dry-run' : 'Applying'} fix to ${suggestion.file}`);

  if (!suggestion.suggestedCode && !force) {
    return {
      success: false,
      filePath: suggestion.file,
      error: 'No suggested code provided',
      appliedChanges: { linesAdded: 0, linesRemoved: 0, linesModified: 0 },
    };
  }

  if (dryRun) {
    return {
      success: true,
      filePath: suggestion.file,
      appliedChanges: calculateChanges(suggestion.originalCode, suggestion.suggestedCode || ''),
    };
  }

  try {
    const content = await readFile(suggestion.file, 'utf-8');

    let result = await applyExactMatch(content, suggestion);

    if (!result.applied) {
      result = await applyFuzzyMatch(content, suggestion);
    }

    if (!result.applied) {
      return {
        success: false,
        filePath: suggestion.file,
        error: 'Could not locate original code in file for replacement',
        appliedChanges: { linesAdded: 0, linesRemoved: 0, linesModified: 0 },
      };
    }

    let backupPath: string | undefined;
    if (shouldCreateBackup) {
      backupPath = await createBackup(suggestion.file, content);
    }

    await writeFile(suggestion.file, result.newContent);

    const appliedChanges = calculateChanges(content, result.newContent);

    logger.info(`Applied fix to ${suggestion.file}${backupPath ? ` (backup: ${backupPath})` : ''}`);

    return {
      success: true,
      filePath: suggestion.file,
      backupPath,
      appliedChanges,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to apply fix to ${suggestion.file}: ${errorMessage}`);

    return {
      success: false,
      filePath: suggestion.file,
      error: errorMessage,
      appliedChanges: { linesAdded: 0, linesRemoved: 0, linesModified: 0 },
    };
  }
}

export async function applyMultipleFixes(
  suggestions: FixSuggestion[],
  options: ApplyOptions = {},
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];

  logger.info(`Applying ${suggestions.length} fixes`);

  for (const suggestion of suggestions) {
    const result = await applySingleFix(suggestion, options);
    results.push(result);

    if (result.success) {
      suggestion.applied = true;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failureCount = results.length - successCount;

  logger.info(`Apply batch complete: ${successCount} successful, ${failureCount} failed`);

  return results;
}

export async function applySafeFixes(suggestions: FixSuggestion[], options: ApplyOptions = {}): Promise<ApplyResult[]> {
  const safeSuggestions = suggestions.filter((s) => s.confidence === 'high' && !s.breaking && s.suggestedCode);

  logger.info(`Applying ${safeSuggestions.length} safe fixes out of ${suggestions.length} total`);

  return applyMultipleFixes(safeSuggestions, options);
}

export async function canApplyFix(suggestion: FixSuggestion): Promise<{
  canApply: boolean;
  reason?: string;
}> {
  try {
    const content = await readFile(suggestion.file, 'utf-8');

    const normalizedContent = normalizeLineEndings(content);
    const normalizedOriginal = normalizeLineEndings(suggestion.originalCode);

    // Check for exact match
    if (normalizedContent.includes(normalizedOriginal)) {
      return { canApply: true };
    }

    // Check for fuzzy match
    const trimmedOriginal = normalizedOriginal.trim();
    if (normalizedContent.includes(trimmedOriginal)) {
      return { canApply: true };
    }

    return {
      canApply: false,
      reason: 'Original code not found in file (file may have been modified)',
    };
  } catch (error) {
    return {
      canApply: false,
      reason: `File access error: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
