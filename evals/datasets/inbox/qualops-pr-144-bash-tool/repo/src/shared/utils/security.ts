import { basename, resolve, join } from 'node:path';

/**
 * Security utilities for input validation and sanitization in qualops
 * This file contains only the security functions actively used in the codebase
 */

/**
 * Resolves `filePath` relative to `cwd` and returns the absolute path only if
 * it stays within `cwd`. Returns null if the path escapes the project root.
 *
 * Handles the prefix-bypass edge case: `/project/repo-evil` is NOT within
 * `/project/repo` even though it starts with the same string.
 */
export function resolveWithinCwd(cwd: string, filePath: string): string | null {
  const full = filePath.startsWith('/') ? filePath : join(cwd, filePath);
  const resolved = resolve(full);
  const cwdResolved = resolve(cwd);
  const cwdPrefix = cwdResolved.replace(/\/?$/, '/');
  if (resolved !== cwdResolved && !resolved.startsWith(cwdPrefix)) return null;
  return resolved;
}

/**
 * Returns true if the string is a safe git ref — non-empty and not starting
 * with '-', which would otherwise be interpreted as a flag by git.
 */
export function isSafeGitRef(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith('-');
}

/**
 * Validates that a filename doesn't contain path traversal sequences
 */
export function isPathTraversalSafe(filename: string): boolean {
  if (!filename) return false;
  return (
    !filename.includes('..') &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('\0')
  );
}

/**
 * Sanitizes a filename by removing dangerous characters
 */
export function sanitizeFilename(filename: string): string {
  if (!filename) return '';
  return basename(filename).replace(/[^a-zA-Z0-9_.-]/g, '_');
}

/**
 * Validates a Git SHA-1 or SHA-256 hash format
 */
export function isValidGitSha(sha: string): boolean {
  if (!sha) return false;
  return /^[a-f0-9]{40}$/i.test(sha) || /^[a-f0-9]{64}$/i.test(sha);
}

/**
 * Validates URL scheme to prevent javascript: and data: URLs
 */
export function hasValidUrlScheme(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

/**
 * Escapes HTML special characters for safe embedding in HTML reports
 */
export function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

// Shared pattern source — used for both inline redaction (with /g) and full-value matching (with ^...$).
export const SENSITIVE_VALUE_PATTERN_SOURCE =
  'Bearer\\s+\\S+|Basic\\s+\\S+' +
  '|sk-[A-Za-z0-9]{10,}|pk-[A-Za-z0-9]{10,}' +
  '|gh[a-z]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+' +
  '|glpat-[A-Za-z0-9_-]+|glcbt-[A-Za-z0-9_-]+' +
  '|AKIA[A-Z0-9]{16}';

export const REDACTED = '[REDACTED]';

/**
 * Redacts known credential patterns from a string.
 * Pass additional known token values to also redact those by exact match.
 */
export function redactTokens(text: string, knownTokens: string[] = []): string {
  if (!text) return text;

  // Recreate with /g each call to avoid stateful lastIndex issues
  let redacted = text.replace(new RegExp(SENSITIVE_VALUE_PATTERN_SOURCE, 'g'), REDACTED);

  for (const token of knownTokens) {
    if (token && token.length > 0) {
      const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      redacted = redacted.replace(new RegExp(escaped, 'g'), REDACTED);
    }
  }

  return redacted;
}

/**
 * Type guard for ClassificationResult array used in root cause extraction
 */
export function isClassificationResultArray(
  data: unknown,
): data is Array<{ issueId: string; rootCause: string; confidence: number }> {
  if (!Array.isArray(data)) return false;
  return data.every(
    (item) =>
      item &&
      typeof item === 'object' &&
      'issueId' in item &&
      'rootCause' in item &&
      'confidence' in item &&
      typeof item.issueId === 'string' &&
      typeof item.rootCause === 'string' &&
      typeof item.confidence === 'number',
  );
}
