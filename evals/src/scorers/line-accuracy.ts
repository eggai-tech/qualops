'use strict';

import type { Issue } from './types';

interface RefBugInput {
  relevantFile?: string;
  file?: string;
  relevantLinesStart?: number | null;
  relevantLinesEnd?: number | null;
  line?: number | null;
  lineEnd?: number | null;
}

interface RefBugMerged {
  file: string;
  start: number;
  end: number;
}

interface Range {
  start: number;
  end: number;
}

export function normalizeFile(f: string | undefined): string {
  return (f || '').replace(/^\.\//, '');
}

export function mergeRefBugs(refBugs: RefBugInput[]): RefBugMerged[] {
  const byFile: Record<string, Range[]> = {};
  for (const bug of refBugs) {
    const key = normalizeFile(bug.relevantFile || bug.file || '');
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push({
      start: bug.relevantLinesStart || bug.line || 0,
      end: bug.relevantLinesEnd || bug.lineEnd || bug.line || 0,
    });
  }

  const merged: RefBugMerged[] = [];
  for (const [file, ranges] of Object.entries(byFile)) {
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    const groups: Range[] = [];
    let cur = { ...ranges[0] };
    for (let i = 1; i < ranges.length; i++) {
      const r = ranges[i];
      if (r.start <= cur.end + 1) {
        cur.end = Math.max(cur.end, r.end);
      } else {
        groups.push(cur);
        cur = { ...r };
      }
    }
    groups.push(cur);
    for (const g of groups) merged.push({ file, start: g.start, end: g.end });
  }
  return merged;
}

export function lineIoU(ref: Range, pred: Range): number {
  const intStart = Math.max(ref.start, pred.start);
  const intEnd = Math.min(ref.end, pred.end);
  const intersection = Math.max(0, intEnd - intStart + 1);
  const unionStart = Math.min(ref.start, pred.start);
  const unionEnd = Math.max(ref.end, pred.end);
  const union = unionEnd - unionStart + 1;
  return union > 0 ? intersection / union : 0;
}

export function scoreLineAccuracy(issues: Issue[], referenceBugs: RefBugInput[]): { pass: boolean; score: number | null; reason: string } {
  if (referenceBugs.length === 0) {
    return { pass: true, score: 1, reason: 'LINE_METRICS: line_acc=1.000 avg_iou=1.000 within3=1.000 matched=0/0' };
  }

  const allNull = referenceBugs.every((b) => b.relevantLinesStart == null && b.line == null);
  if (allNull) {
    return { pass: true, score: null, reason: 'LINE_METRICS: skipped (dataset has no line numbers)' };
  }

  const refBugs = mergeRefBugs(referenceBugs);
  const ious: number[] = [];
  const matchedIssues: (Issue | null)[] = [];

  for (const ref of refBugs) {
    let bestIoU = 0;
    let bestIssue: Issue | null = null;
    for (const issue of issues) {
      const issueFile = normalizeFile(issue.file);
      if (ref.file && issueFile && ref.file !== issueFile) continue;
      const issueLine = issue.line || 0;
      const issueLineEnd = issue.lineEnd || issueLine;
      const iou = lineIoU({ start: ref.start, end: ref.end }, { start: issueLine, end: issueLineEnd });
      if (iou > bestIoU) { bestIoU = iou; bestIssue = issue; }
    }
    matchedIssues.push(bestIssue);
    ious.push(bestIoU);
  }

  const matchedIoUs = ious.filter((v) => v > 0);
  const lineAcc = ious.reduce((a, b) => a + b, 0) / ious.length;
  const avgIoU = matchedIoUs.length > 0 ? matchedIoUs.reduce((a, b) => a + b, 0) / matchedIoUs.length : 0;

  let within3 = 0;
  for (let i = 0; i < refBugs.length; i++) {
    const matched = matchedIssues[i];
    if (!matched) continue;
    const ref = refBugs[i];
    const startDiff = Math.abs((matched.line || 0) - ref.start);
    const endDiff = Math.abs((matched.lineEnd || matched.line || 0) - ref.end);
    if (startDiff <= 3 && endDiff <= 3) within3++;
  }

  const within3Rate = within3 / refBugs.length;
  const matchedCount = matchedIoUs.length;
  const reason = `LINE_METRICS: line_acc=${lineAcc.toFixed(3)} avg_iou=${avgIoU.toFixed(3)} within3=${within3Rate.toFixed(3)} matched=${matchedCount}/${refBugs.length}`;

  return { pass: lineAcc >= 0.15, score: lineAcc, reason };
}
