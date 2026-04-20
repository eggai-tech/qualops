import { fixMalformedJson } from '../../../ai/shared/parsers/json-parser';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo } from '../../../shared/types/config';
import { logger } from '../../../shared/utils/logger';

export function parseIssuesFromResult(
  result: string,
  files: FileInfo[],
  jobName: string,
): ReviewIssue[] {
  const jsonMatch = result.match(/```(?:json)?\s*([\s\S]*?)```/) || result.match(/\[[\s\S]*\]/);

  if (!jsonMatch) {
    logger.warn('[Agentic] No JSON found in result');
    return [];
  }

  const jsonStr = fixMalformedJson(jsonMatch[1] || jsonMatch[0]);

  try {
    const parsed = JSON.parse(jsonStr);
    const issueArray = Array.isArray(parsed) ? parsed : [];

    return issueArray
      .filter((issue: any) => issue.confidence >= 7)
      .map((issue: any, index: number) => normalizeIssue(issue, index, files, jobName));
  } catch (error) {
    logger.warn(`[Agentic] Failed to parse issues: ${(error as Error).message}`);
    logger.warn(`[Agentic] JSON preview: ${jsonStr.slice(0, 300)}...`);
    return [];
  }
}

export function normalizeIssue(
  issue: any,
  index: number,
  files: FileInfo[],
  jobName: string,
): ReviewIssue {
  const location = parseLocation(issue.location || issue.file || '');
  const file = location.file || files[0]?.path || 'unknown';

  return {
    id: `agentic-${jobName}-${Date.now()}-${index}`,
    file,
    type: issue.type || 'maintainability',
    severity: issue.severity || 'medium',
    description: issue.description || 'No description',
    location: location.line ? `${location.line}` : '1',
    reasoning: issue.reasoning || '',
    suggestion: issue.suggestion || '',
    context: issue.context || '',
    confidence: issue.confidence || 7,
    knowledge_source: `agentic:${jobName}`,
    priority: calculatePriority(issue.severity),
    estimatedEffort: 'medium',
    tags: [issue.type, issue.severity, 'agentic'].filter(Boolean),
  };
}

export function parseLocation(location: string): { file?: string; line?: number } {
  if (!location) return {};

  // Handle "file:line" format
  const match = location.match(/^(.+?):(\d+)/);
  if (match) {
    const file = match[1].replace(/\.\.[/\\]/g, '').replace(/^[/\\]+/, '');
    return { file, line: parseInt(match[2], 10) };
  }

  // Handle "line:N" format
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
