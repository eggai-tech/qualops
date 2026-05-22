'use strict';

import type { Issue, ExpectedIssue } from './types';

const LINE_TOLERANCE = 3;

interface MatchedPair {
  detected: Issue;
  expected: ExpectedIssue;
}

export function lineOverlap(detected: Issue, expected: ExpectedIssue): number {
  const dStart = detected.line || 0;
  const dEnd = detected.lineEnd != null ? detected.lineEnd : dStart;
  const eStart = (expected.line || 0) - LINE_TOLERANCE;
  const eEnd = (expected.lineEnd != null ? expected.lineEnd : expected.line || 0) + LINE_TOLERANCE;
  return Math.max(0, Math.min(dEnd, eEnd) - Math.max(dStart, eStart) + 1);
}

export function isCategoryCompatible(detectedType: string | undefined, expectedCategory: string | undefined): boolean {
  const d = (detectedType || '').toLowerCase();
  const e = (expectedCategory || '').toLowerCase();
  return d.includes(e) || e.includes(d);
}

export function matchIssues(detected: Issue[], expected: ExpectedIssue[]): MatchedPair[] {
  const candidates: { di: number; ei: number; overlap: number }[] = [];
  for (let di = 0; di < detected.length; di++) {
    for (let ei = 0; ei < expected.length; ei++) {
      if (!isCategoryCompatible(detected[di].type, expected[ei].category)) continue;
      const overlap = lineOverlap(detected[di], expected[ei]);
      if (overlap > 0) candidates.push({ di, ei, overlap });
    }
  }
  candidates.sort((a, b) => b.overlap - a.overlap);

  const usedD = new Set<number>();
  const usedE = new Set<number>();
  const matched: MatchedPair[] = [];
  for (const { di, ei } of candidates) {
    if (usedD.has(di) || usedE.has(ei)) continue;
    usedD.add(di);
    usedE.add(ei);
    matched.push({ detected: detected[di], expected: expected[ei] });
  }
  return matched;
}

export function scoreCoverage(issues: Issue[], referenceExpected: ExpectedIssue[]): { pass: boolean; score: number | null; reason: string } {
  if (referenceExpected.length === 0) {
    return { pass: true, score: 1, reason: 'COVERAGE: coverage=1.000 (0 expected issues)' };
  }

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
