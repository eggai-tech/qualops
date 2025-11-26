import { basename } from 'node:path';

/**
 * Security utilities for input validation and sanitization in qualops
 * This file contains only the security functions actively used in the codebase
 */

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
