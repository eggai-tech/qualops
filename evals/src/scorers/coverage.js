'use strict';

/**
 * Coverage scorer — measures what fraction of expected issues were detected
 * using greedy 1:1 matching by category + line overlap.
 *
 * Skipped for datasets with no line numbers (e.g. CRB).
 * Applies to: qualops
 */

const LINE_TOLERANCE = 3;

function lineOverlap(detected, expected) {
  const dStart = detected.line || 0;
  const dEnd = detected.lineEnd != null ? detected.lineEnd : dStart;
  const eStart = (expected.line || 0) - LINE_TOLERANCE;
  const eEnd = (expected.lineEnd != null ? expected.lineEnd : expected.line || 0) + LINE_TOLERANCE;
  return Math.max(0, Math.min(dEnd, eEnd) - Math.max(dStart, eStart) + 1);
}

function isCategoryCompatible(detectedType, expectedCategory) {
  const d = (detectedType || '').toLowerCase();
  const e = (expectedCategory || '').toLowerCase();
  return d.includes(e) || e.includes(d);
}

function matchIssues(detected, expected) {
  const candidates = [];
  for (let di = 0; di < detected.length; di++) {
    for (let ei = 0; ei < expected.length; ei++) {
      if (!isCategoryCompatible(detected[di].type, expected[ei].category)) continue;
      const overlap = lineOverlap(detected[di], expected[ei]);
      if (overlap > 0) candidates.push({ di, ei, overlap });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);

  const usedD = new Set();
  const usedE = new Set();
  const matched = [];
  for (const { di, ei } of candidates) {
    if (usedD.has(di) || usedE.has(ei)) continue;
    usedD.add(di);
    usedE.add(ei);
    matched.push({ detected: detected[di], expected: expected[ei] });
  }
  return matched;
}

function scoreCoverage(issues, referenceExpected) {
  if (referenceExpected.length === 0) {
    return { pass: true, score: 1, reason: 'COVERAGE: coverage=1.000 (0 expected issues)' };
  }

  // CRB golden comments have no line numbers — line-overlap matching is meaningless
  const allNull = referenceExpected.every((e) => e.line == null);
  if (allNull) {
    return { pass: true, score: null, reason: 'COVERAGE: skipped (dataset has no line numbers, use crb_recall instead)' };
  }

  const matched = matchIssues(issues, referenceExpected);
  const coverage = matched.length / referenceExpected.length;

  return {
    pass: coverage >= 0.5,
    score: coverage,
    reason: `COVERAGE: coverage=${coverage.toFixed(3)} matched=${matched.length}/${referenceExpected.length}`,
  };
}

module.exports = { scoreCoverage, matchIssues, lineOverlap, isCategoryCompatible };
