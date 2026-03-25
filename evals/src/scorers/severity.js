'use strict';

/**
 * Severity scorer — measures how accurately the tool labels severity.
 * Always passes (non-blocking) — recorded for observability only.
 * Applies to all datasets.
 */

const { matchIssues } = require('./coverage');

function scoreSeverity(issues, referenceExpected) {
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

module.exports = { scoreSeverity };
