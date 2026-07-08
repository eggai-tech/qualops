'use strict';

export interface ParseResult {
  pass: boolean;
  score: number;
  reason: string;
}

export function scoreParser(issues: unknown): ParseResult {
  if (!Array.isArray(issues)) {
    return { pass: false, score: 0, reason: 'PARSE_FAIL: Output is not a JSON array' };
  }

  if (issues.length === 0) {
    return { pass: true, score: 0.5, reason: 'PARSE_OK: 0 issues returned (empty array)' };
  }

  const errors: string[] = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i] as Record<string, unknown>;
    if (!issue.type) errors.push(`issue[${i}]: missing type`);
    if (!issue.severity) errors.push(`issue[${i}]: missing severity`);
    if (!issue.description) errors.push(`issue[${i}]: missing description`);
    if (issue.line === undefined || issue.line === null) errors.push(`issue[${i}]: missing line`);
  }

  if (errors.length > 0) {
    return { pass: false, score: 0.5, reason: 'PARSE_PARTIAL: Schema errors: ' + errors.join('; ') };
  }

  return { pass: true, score: 1, reason: `PARSE_OK: ${issues.length} issues parsed and validated` };
}
