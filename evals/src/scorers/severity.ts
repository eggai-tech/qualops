'use strict';

import type { Issue } from './types';
import { matchIssues } from './coverage';

interface ExpectedIssue {
  line?: number | null;
  lineEnd?: number | null;
  category?: string;
  severity?: string;
}

export function scoreSeverity(issues: Issue[], referenceExpected: ExpectedIssue[]): { pass: boolean; score: number; reason: string } {
  if (referenceExpected.length === 0) {
    return { pass: true, score: 0, reason: 'SEVERITY: severity_acc=0.000 (no matched pairs)' };
  }

  const matched = matchIssues(issues, referenceExpected);
  if (matched.length === 0) {
    return { pass: true, score: 0, reason: 'SEVERITY: severity_acc=0.000 (no matched pairs)' };
  }

  const correct = matched.filter(
    ({ detected: d, expected: e }) =>
      (d.severity || '').toLowerCase() === (e.severity || '').toLowerCase(),
  ).length;

  const severityAcc = correct / matched.length;
  return {
    pass: true,
    score: severityAcc,
    reason: `SEVERITY: severity_acc=${severityAcc.toFixed(3)} correct=${correct}/${matched.length}`,
  };
}
