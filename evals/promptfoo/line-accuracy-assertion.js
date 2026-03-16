function normalizeFile(f) {
  return (f || '').replace(/^\.\//, '');
}

// Merge overlapping/adjacent reference bugs per file so a single
// detected issue spanning multiple granular refs isn't penalized.
function mergeRefBugs(refBugs) {
  const byFile = {};
  for (const bug of refBugs) {
    const key = normalizeFile(bug.relevantFile || bug.file || '');
    if (!byFile[key]) byFile[key] = [];
    byFile[key].push({
      start: bug.relevantLinesStart || bug.line || 0,
      end: bug.relevantLinesEnd || bug.lineEnd || bug.line || 0,
    });
  }

  const merged = [];
  for (const [file, ranges] of Object.entries(byFile)) {
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);

    const groups = [];
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

    for (const g of groups) {
      merged.push({
        file,
        start: g.start,
        end: g.end,
      });
    }
  }
  return merged;
}

function lineIoU(ref, pred) {
  const intStart = Math.max(ref.start, pred.start);
  const intEnd = Math.min(ref.end, pred.end);
  const intersection = Math.max(0, intEnd - intStart + 1);
  const unionStart = Math.min(ref.start, pred.start);
  const unionEnd = Math.max(ref.end, pred.end);
  const union = unionEnd - unionStart + 1;
  return union > 0 ? intersection / union : 0;
}

module.exports = (output, context) => {
  const rawRefBugs = JSON.parse(context.vars.referenceBugs || '[]');
  if (rawRefBugs.length === 0) {
    return {
      pass: true,
      score: 1,
      reason: 'LINE_METRICS: line_acc=1.000 avg_iou=1.000 within3=1.000 matched=0/0',
    };
  }

  const refBugs = mergeRefBugs(rawRefBugs);

  let issues;
  try {
    issues = JSON.parse(output);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: `LINE_METRICS: line_acc=0.000 avg_iou=0.000 within3=0.000 matched=0/${refBugs.length} (parse error)`,
    };
  }

  if (!Array.isArray(issues)) {
    return {
      pass: false,
      score: 0,
      reason: `LINE_METRICS: line_acc=0.000 avg_iou=0.000 within3=0.000 matched=0/${refBugs.length} (not array)`,
    };
  }

  const ious = [];
  const matchedIssues = [];

  for (const ref of refBugs) {
    let bestIoU = 0;
    let bestIssue = null;

    for (const issue of issues) {
      const issueFile = normalizeFile(issue.file || '');
      if (ref.file && issueFile && ref.file !== issueFile) continue;

      const issueLine = issue.line || 0;
      const issueLineEnd = issue.lineEnd || issueLine;

      const iou = lineIoU(
        { start: ref.start, end: ref.end },
        { start: issueLine, end: issueLineEnd },
      );

      if (iou > bestIoU) {
        bestIoU = iou;
        bestIssue = issue;
      }
    }

    matchedIssues.push(bestIssue);
    ious.push(bestIoU);
  }

  const matchedIoUs = ious.filter((v) => v > 0);
  const lineAcc =
    ious.reduce((a, b) => a + b, 0) / ious.length;
  const avgIoU =
    matchedIoUs.length > 0
      ? matchedIoUs.reduce((a, b) => a + b, 0) / matchedIoUs.length
      : 0;

  let within3 = 0;
  for (let i = 0; i < refBugs.length; i++) {
    const matched = matchedIssues[i];
    if (!matched) continue;
    const ref = refBugs[i];

    const startDiff = Math.abs((matched.line || 0) - ref.start);
    const endDiff = Math.abs((matched.lineEnd || matched.line || 0) - ref.end);
    if (startDiff <= 3 && endDiff <= 3) {
      within3++;
    }
  }

  const within3Rate = within3 / refBugs.length;
  const matchedCount = matchedIoUs.length;

  const reason = `LINE_METRICS: line_acc=${lineAcc.toFixed(3)} avg_iou=${avgIoU.toFixed(3)} within3=${within3Rate.toFixed(3)} matched=${matchedCount}/${refBugs.length}`;

  return {
    pass: lineAcc >= 0.15,
    score: lineAcc,
    reason,
  };
};
