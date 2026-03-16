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

module.exports = (output, context) => {
  let expected;
  try {
    expected = JSON.parse(context.vars.referenceExpected || '[]');
  } catch {
    return { pass: true, score: 0, reason: 'SEVERITY: could not parse referenceExpected' };
  }

  let detected;
  try {
    detected = JSON.parse(output);
    if (!Array.isArray(detected)) throw new Error('not array');
  } catch {
    return { pass: true, score: 0, reason: 'SEVERITY: severity_acc=0.000 (parse error)' };
  }

  const matched = matchIssues(detected, expected);

  if (matched.length === 0) {
    return {
      pass: true,
      score: 0,
      reason: 'SEVERITY: severity_acc=0.000 (no matched pairs)',
    };
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
};
