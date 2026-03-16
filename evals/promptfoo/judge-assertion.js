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
      if (Array.isArray(arr) && arr.every((n) => typeof n === 'number')) {
        return arr;
      }
    } catch {
      // fall through
    }
  }
  return null;
}

function buildJudgePrompt(referenceExpected, detectedIssues) {
  return `You are a code review quality judge. You are evaluating whether a set of detected issues are valid and useful.

## Reference issues (ground truth):
${referenceExpected}

## Detected issues to evaluate:
${detectedIssues}

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

module.exports = async (output, context) => {
  let issues;
  try {
    issues = JSON.parse(output);
  } catch {
    return {
      pass: false,
      score: 0,
      reason: 'JUDGE_SKIP: Could not parse provider output as JSON',
    };
  }

  if (!Array.isArray(issues) || issues.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'JUDGE_SKIP: No issues to judge (empty array)',
    };
  }

  const referenceExpected = context.vars.referenceExpected || '[]';
  const issuesStr = JSON.stringify(issues, null, 2);
  const judgePrompt = buildJudgePrompt(referenceExpected, issuesStr);

  const judges = [];
  if (process.env.ANTHROPIC_API_KEY) {
    judges.push({ name: 'anthropic', call: () => callAnthropic(judgePrompt) });
  }
  if (process.env.OPENAI_API_KEY) {
    judges.push({ name: 'openai', call: () => callOpenAI(judgePrompt) });
  }

  if (judges.length === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'JUDGE_SKIP: No judge API keys configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)',
    };
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
    return {
      pass: false,
      score: 0,
      reason: 'JUDGE_ERROR: All judges failed' + judgeDetails,
    };
  }

  const maxLen = Math.max(...scoreArrays.map((a) => a.length));

  if (maxLen === 0) {
    return {
      pass: false,
      score: 0,
      reason: 'JUDGE_ERROR: All judges returned empty score arrays' + judgeDetails,
    };
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

  return {
    pass: normalizedScore >= 0.6,
    score: normalizedScore,
    reason,
  };
};
