#!/usr/bin/env node
'use strict';

// ─── Parse scorer ────────────────────────────────────────────────────────────

function scoreParser(issues) {
  if (!Array.isArray(issues)) {
    return { pass: false, score: 0, reason: 'PARSE_FAIL: Output is not a JSON array' };
  }

  if (issues.length === 0) {
    return { pass: true, score: 0.5, reason: 'PARSE_OK: 0 issues returned (empty array)' };
  }

  const errors = [];
  for (let i = 0; i < issues.length; i++) {
    const issue = issues[i];
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

// ─── Line accuracy scorer ─────────────────────────────────────────────────────

function normalizeFile(f) {
  return (f || '').replace(/^\.\//, '');
}

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
    for (const g of groups) merged.push({ file, start: g.start, end: g.end });
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

function scoreLineAccuracy(issues, referenceBugs) {
  if (referenceBugs.length === 0) {
    return { pass: true, score: 1, reason: 'LINE_METRICS: line_acc=1.000 avg_iou=1.000 within3=1.000 matched=0/0' };
  }

  const refBugs = mergeRefBugs(referenceBugs);
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

// ─── Coverage scorer ──────────────────────────────────────────────────────────

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

  const matched = matchIssues(issues, referenceExpected);
  const coverage = matched.length / referenceExpected.length;

  return {
    pass: coverage >= 0.5,
    score: coverage,
    reason: `COVERAGE: coverage=${coverage.toFixed(3)} matched=${matched.length}/${referenceExpected.length}`,
  };
}

// ─── Severity scorer ──────────────────────────────────────────────────────────

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

// ─── Judge scorer ─────────────────────────────────────────────────────────────

async function callAnthropic(prompt) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8192,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Anthropic API ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.content?.[0]?.text || '';
}

async function callOpenAI(prompt) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
    }),
    signal: AbortSignal.timeout(180000),
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`OpenAI API ${resp.status}: ${text.slice(0, 300)}`);
  }

  const data = await resp.json();
  return data.choices?.[0]?.message?.content || '';
}

function parseScores(text) {
  const jsonMatch = text.match(/\[[\d\s,.]+\]/);
  if (jsonMatch) {
    try {
      const arr = JSON.parse(jsonMatch[0]);
      if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) return arr;
    } catch {
      // fall through
    }
  }
  return null;
}

function buildJudgePrompt(referenceExpected, detectedIssues) {
  return `You are a code review quality judge. You are evaluating whether a set of detected issues are valid and useful.

## Reference issues (ground truth):
${JSON.stringify(referenceExpected, null, 2)}

## Detected issues to evaluate:
${JSON.stringify(detectedIssues, null, 2)}

## Instructions

For each detected issue, score it from 1 to 10:
- 10: Perfectly identifies a real, important issue from the reference set
- 8-9: Identifies a real issue, good description, correct location
- 6-7: Identifies a real issue but location or description is imprecise
- 4-5: Partially related to a real issue, vague or misleading
- 2-3: Not a real issue or extremely vague
- 1: Completely wrong, hallucinated, or noise

Consider:
1. Does the detected issue correspond to any reference issue?
2. Is the description accurate and actionable?
3. Is the severity reasonable?
4. Is the location correct (within ±5 lines)?

Respond with ONLY a JSON array of numbers, one score per detected issue.
Example: [8, 6, 9]

If there are no detected issues, respond with: []`;
}

async function scoreJudge(issues, referenceExpected) {
  if (issues.length === 0) {
    return { pass: false, score: 0, reason: 'JUDGE_SKIP: No issues to judge (empty array)' };
  }

  const judgePrompt = buildJudgePrompt(referenceExpected, issues);

  const judges = [];
  if (process.env.ANTHROPIC_API_KEY) judges.push({ name: 'anthropic', call: () => callAnthropic(judgePrompt) });
  if (process.env.OPENAI_API_KEY) judges.push({ name: 'openai', call: () => callOpenAI(judgePrompt) });

  if (judges.length === 0) {
    return { pass: false, score: 0, reason: 'JUDGE_SKIP: No judge API keys configured' };
  }

  const results = await Promise.allSettled(judges.map((j) => j.call()));
  const scoreArrays = [];
  let judgeDetails = '';

  for (let i = 0; i < judges.length; i++) {
    const { name } = judges[i];
    const result = results[i];
    if (result.status === 'fulfilled') {
      const scores = parseScores(result.value);
      if (scores) scoreArrays.push(scores);
      judgeDetails += `\n--- ${name.toUpperCase()} JUDGE ---\n${result.value.slice(-500)}`;
    } else {
      judgeDetails += `\n--- ${name.toUpperCase()} JUDGE ---\nERROR: ${result.reason?.message || result.reason}`;
    }
  }

  if (scoreArrays.length === 0) {
    return { pass: false, score: 0, reason: 'JUDGE_ERROR: All judges failed' + judgeDetails };
  }

  const maxLen = Math.max(...scoreArrays.map((a) => a.length));
  if (maxLen === 0) {
    return { pass: false, score: 0, reason: 'JUDGE_ERROR: All judges returned empty score arrays' + judgeDetails };
  }

  const perIssueAvg = [];
  for (let i = 0; i < maxLen; i++) {
    const vals = scoreArrays.map((a) => a[i]).filter((v) => v != null);
    perIssueAvg.push(vals.reduce((a, b) => a + b, 0) / vals.length);
  }

  const overallAvg = perIssueAvg.reduce((a, b) => a + b, 0) / perIssueAvg.length;
  const normalizedScore = overallAvg / 10;
  const mode = judges.length === 2 ? 'dual' : `${judges[0].name}-only`;
  const reason = `JUDGE_METRICS mode=${mode} avg=${overallAvg.toFixed(1)}/10 scores=[${perIssueAvg.map((s) => s.toFixed(1)).join(',')}]${judgeDetails}`;

  return { pass: normalizedScore >= 0.6, score: normalizedScore, reason };
}

// ─── Run all scorers ──────────────────────────────────────────────────────────

/**
 * Run all scorers against detected issues and reference data.
 * Returns an array of { name, value, comment } for Langfuse scores.
 */
async function runAllScorers(issues, { referenceBugs, referenceExpected }) {
  const parseResult = scoreParser(issues);
  const lineResult = scoreLineAccuracy(issues, referenceBugs);
  const coverageResult = scoreCoverage(issues, referenceExpected);
  const severityResult = scoreSeverity(issues, referenceExpected);

  let judgeResult;
  try {
    judgeResult = await scoreJudge(issues, referenceExpected);
  } catch (err) {
    judgeResult = { score: 0, reason: `JUDGE_ERROR: ${err.message}` };
  }

  return [
    { name: 'parse', value: parseResult.score, comment: parseResult.reason },
    { name: 'line_accuracy', value: lineResult.score, comment: lineResult.reason },
    { name: 'coverage', value: coverageResult.score, comment: coverageResult.reason },
    { name: 'severity', value: severityResult.score, comment: severityResult.reason },
    { name: 'judge', value: judgeResult.score, comment: judgeResult.reason },
  ];
}

module.exports = { runAllScorers, scoreParser, scoreLineAccuracy, scoreCoverage, scoreSeverity, scoreJudge };
