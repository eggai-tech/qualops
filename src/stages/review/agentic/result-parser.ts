import { normalize, isAbsolute, relative } from 'node:path';

import { escapeUnescapedControlChars, extractJsonText } from '../../../ai/shared/structured';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

type RawAgentIssue = {
  type?: ReviewIssue['type'] | string;
  severity?: ReviewIssue['severity'] | string;
  description?: string;
  location?: string;
  file?: string;
  reasoning?: string;
  suggestion?: string;
  context?: string;
  confidence?: number;
  impact?: string;
  cwe?: string;
  threat_model?: string;
};

export function parseIssuesFromResult(
  result: string,
  files: FileInfo[],
  jobName: string,
  cwd: string,
): ReviewIssue[] {
  const extracted = extractJsonText(result);
  if (!extracted) {
    logger.warn('[Agentic] No JSON found in result');
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(extracted.text);
  } catch {
    try {
      parsed = JSON.parse(escapeUnescapedControlChars(extracted.text));
    } catch (error) {
      logger.warn(`[Agentic] Failed to parse JSON: ${(error as Error).message}`);
      logger.warn(`[Agentic] JSON preview: ${extracted.text.slice(0, 300)}...`);
      return [];
    }
  }

  if (!Array.isArray(parsed)) {
    logger.warn('[Agentic] Parsed result is not an array');
    return [];
  }

  return (parsed as RawAgentIssue[])
    .filter((issue) => (issue?.confidence ?? 0) >= 7)
    .map((issue, index) => normalizeIssue(issue, index, files, jobName, cwd));
}

export function normalizeIssue(
  issue: RawAgentIssue,
  index: number,
  files: FileInfo[],
  jobName: string,
  cwd: string,
): ReviewIssue {
  const location = parseLocation(issue.location || issue.file || '', cwd);
  const file = location.file || files[0]?.path || 'unknown';

  return {
    id: `agentic-${jobName}-${Date.now()}-${index}`,
    file,
    type: (issue.type as ReviewIssue['type']) || 'maintainability',
    severity: (issue.severity as ReviewIssue['severity']) || 'medium',
    description: issue.description || 'No description',
    location: location.line ? `${location.line}` : '1',
    reasoning: issue.reasoning || '',
    suggestion: issue.suggestion || '',
    context: issue.context || '',
    confidence: issue.confidence ?? 7,
    knowledge_source: `agentic:${jobName}`,
    priority: calculatePriority(issue.severity ?? 'medium'),
    estimatedEffort: 'medium',
    tags: [issue.type, issue.severity, 'agentic'].filter((t): t is string => typeof t === 'string'),
    ...(issue.impact ? { impact: issue.impact } : {}),
    ...(issue.cwe ? { cwe: issue.cwe } : {}),
    ...(issue.threat_model ? { threat_model: issue.threat_model } : {}),
  };
}

export function parseLocation(location: string, cwd: string): { file?: string; line?: number } {
  if (!location) return {};

  const match = location.match(/^(.+?):(\d+)/);
  if (match) {
    const normalized = normalize(match[1]);
    if (isAbsolute(normalized)) {
      const rel = relative(cwd, normalized);
      if (rel.startsWith('..')) return {};
      return { file: rel, line: parseInt(match[2], 10) };
    }
    if (normalized.startsWith('..')) return {};
    return { file: normalized, line: parseInt(match[2], 10) };
  }

  const lineMatch = location.match(/line:?\s*(\d+)/i);
  if (lineMatch) {
    return { line: parseInt(lineMatch[1], 10) };
  }

  return {};
}

export function calculatePriority(severity: string): number {
  const priorities: Record<string, number> = {
    critical: 1,
    high: 2,
    medium: 3,
    low: 4,
  };
  return priorities[severity] || 3;
}
