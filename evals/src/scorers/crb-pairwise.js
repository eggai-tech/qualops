'use strict';

/**
 * CRB-compatible pairwise precision/recall scorer.
 * Uses the exact methodology from withmartian/code-review-benchmark step3_judge_comments.py.
 *
 * For each (golden, candidate) pair, an LLM judge decides if they describe the same issue.
 * Results in crb_precision, crb_recall, crb_f1 scores.
 *
 * Applies to: crb
 */

const { callJudgeLLM, hasJudgeKeys } = require('./llm-client');

function buildPairwiseJudgePrompt(goldenComment, candidate) {
  return `You are evaluating AI code review tools.
Determine if the candidate issue matches the golden (expected) comment.

Golden Comment (the issue we're looking for):
${goldenComment}

Candidate Issue (from the tool's review):
${candidate}

Instructions:
- Determine if the candidate identifies the SAME underlying issue as the golden comment
- Accept semantic matches - different wording is fine if it's the same problem
- Focus on whether they point to the same bug, concern, or code issue

Respond with ONLY a JSON object:
{"reasoning": "brief explanation", "match": true/false, "confidence": 0.0-1.0}`;
}

function parsePairwiseResult(text) {
  try {
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const obj = JSON.parse(m[0]);
    if (typeof obj.match === 'boolean' && typeof obj.confidence === 'number') return obj;
  } catch { /* fall through */ }
  return null;
}

async function judgeOnePair(goldenComment, candidate) {
  const prompt = buildPairwiseJudgePrompt(goldenComment, candidate);
  const text = await callJudgeLLM(prompt);
  if (!text) return null;
  return parsePairwiseResult(text);
}

function truncate(str, len = 120) {
  if (!str || str.length <= len) return str || '';
  return str.slice(0, len - 1) + '…';
}

function buildCrbGoldenCommentDetails(referenceExpected, goldenMatched) {
  return referenceExpected.map((entry, idx) => {
    const desc = entry.description || '';
    const match = goldenMatched ? goldenMatched.get(desc) : null;
    return {
      goldenIndex: idx,
      description: truncate(desc),
      type: entry.type || null,
      severity: entry.severity || null,
      matched: match ? match.matched : false,
      confidence: match ? match.confidence : 0,
      matchedCandidate: match && match.candidate ? truncate(match.candidate) : null,
    };
  });
}

async function scoreCrb(issues, referenceExpected) {
  if (!hasJudgeKeys()) {
    const goldenDetails = buildCrbGoldenCommentDetails(referenceExpected, null);
    return [
      { name: 'crb_precision', value: 0, comment: 'CRB_SKIP: No judge API keys configured' },
      { name: 'crb_recall', value: 0, comment: 'CRB_SKIP: No judge API keys configured', metadata: { goldenDetails } },
      { name: 'crb_f1', value: 0, comment: 'CRB_SKIP: No judge API keys configured' },
    ];
  }

  const goldenComments = referenceExpected.map((e) => e.description).filter(Boolean);
  const candidates = issues.map((i) => i.description || i.summary || '').filter(Boolean);

  if (candidates.length === 0) {
    const goldenDetails = buildCrbGoldenCommentDetails(referenceExpected, null);
    return [
      { name: 'crb_precision', value: 0, comment: 'CRB: precision=0.000 (no candidates)' },
      { name: 'crb_recall', value: 0, comment: 'CRB: recall=0.000 tp=0/' + goldenComments.length, metadata: { goldenDetails } },
      { name: 'crb_f1', value: 0, comment: 'CRB: f1=0.000' },
    ];
  }

  if (goldenComments.length === 0) {
    return [
      { name: 'crb_precision', value: null, comment: 'CRB: skipped (no golden comments)' },
      { name: 'crb_recall', value: null, comment: 'CRB: skipped (no golden comments)', metadata: { goldenDetails: [] } },
      { name: 'crb_f1', value: null, comment: 'CRB: skipped (no golden comments)' },
    ];
  }

  const pairs = [];
  for (const golden of goldenComments) {
    for (const candidate of candidates) {
      pairs.push({ golden, candidate });
    }
  }

  const results = await Promise.all(
    pairs.map(async ({ golden, candidate }) => {
      try {
        return await judgeOnePair(golden, candidate);
      } catch {
        return null;
      }
    }),
  );

  const goldenMatched = new Map();
  for (const g of goldenComments) {
    goldenMatched.set(g, { matched: false, candidate: null, confidence: 0 });
  }

  for (let pi = 0; pi < pairs.length; pi++) {
    const result = results[pi];
    if (!result || !result.match) continue;
    const { golden, candidate } = pairs[pi];
    const current = goldenMatched.get(golden);
    if (result.confidence > current.confidence) {
      goldenMatched.set(golden, { matched: true, candidate, confidence: result.confidence });
    }
  }

  const tp = [...goldenMatched.values()].filter((v) => v.matched).length;
  const fn = goldenComments.length - tp;

  const matchedCandidates = new Set(
    [...goldenMatched.values()].filter((v) => v.matched).map((v) => v.candidate),
  );
  const fp = candidates.filter((c) => !matchedCandidates.has(c)).length;

  const precision = tp / (tp + fp) || 0;
  const recall = tp / (tp + fn) || 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  const goldenDetails = buildCrbGoldenCommentDetails(referenceExpected, goldenMatched);

  return [
    { name: 'crb_precision', value: precision, comment: `CRB: precision=${precision.toFixed(3)} tp=${tp} fp=${fp}` },
    { name: 'crb_recall', value: recall, comment: `CRB: recall=${recall.toFixed(3)} tp=${tp} fn=${fn}`, metadata: { goldenDetails } },
    { name: 'crb_f1', value: f1, comment: `CRB: f1=${f1.toFixed(3)} precision=${precision.toFixed(3)} recall=${recall.toFixed(3)}` },
  ];
}

module.exports = { scoreCrb, buildCrbGoldenCommentDetails, buildPairwiseJudgePrompt, parsePairwiseResult };
