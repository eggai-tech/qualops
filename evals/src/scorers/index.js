'use strict';

/**
 * Scorer registry.
 *
 * Each scorer entry has:
 *   datasets — '*' (all) or string[] of source names that qualify
 *   fn       — async (issues, ctx) => Score | Score[]
 *
 * ctx shape: { referenceBugs, referenceExpected, source }
 *
 * scoreFor() selects and runs all scorers whose datasets match `source`,
 * then flattens and filters null scores.
 */

const { scoreParser } = require('./parse');
const { scoreLineAccuracy } = require('./line-accuracy');
const { scoreCoverage } = require('./coverage');
const { scoreSeverity } = require('./severity');
const { scoreJudge } = require('./judge');
const { scoreCrb } = require('./crb-pairwise');

const _registry = new Map();

function register(name, { datasets, fn }) {
  _registry.set(name, { datasets, fn });
}

function getRegistry() {
  return new Map(_registry);
}

// Parse: always run — validates output schema
register('parse', {
  datasets: '*',
  fn: async (issues) => {
    const r = scoreParser(issues);
    return { name: 'parse', value: r.score, comment: r.reason };
  },
});

// Line accuracy: line-number datasets only
register('line_accuracy', {
  datasets: ['qualops'],
  fn: async (issues, { referenceBugs }) => {
    const r = scoreLineAccuracy(issues, referenceBugs);
    return { name: 'line_accuracy', value: r.score, comment: r.reason };
  },
});

// Coverage: line-number datasets only
register('coverage', {
  datasets: ['qualops'],
  fn: async (issues, { referenceExpected }) => {
    const r = scoreCoverage(issues, referenceExpected);
    return { name: 'coverage', value: r.score, comment: r.reason };
  },
});

// Severity: all datasets (non-blocking, observability only)
register('severity', {
  datasets: '*',
  fn: async (issues, { referenceExpected }) => {
    const r = scoreSeverity(issues, referenceExpected);
    return { name: 'severity', value: r.score, comment: r.reason };
  },
});

// Averaged judge: line-number datasets only
register('judge', {
  datasets: ['qualops'],
  fn: async (issues, { referenceExpected }) => {
    const r = await scoreJudge(issues, referenceExpected);
    return { name: 'judge', value: r.score, comment: r.reason };
  },
});

// CRB pairwise: crb datasets only
register('crb_pairwise', {
  datasets: ['crb'],
  fn: async (issues, { referenceExpected }) => {
    // Returns array of { name, value, comment }
    return scoreCrb(issues, referenceExpected);
  },
});

/**
 * Run all scorers that apply to the given source dataset.
 *
 * @param {string} source - dataset source ('crb', 'qualops', …)
 * @param {object[]} issues - detected issues
 * @param {object} ctx - { referenceBugs, referenceExpected, skipNames? }
 * @returns {Promise<Array<{name, value, comment}>>} filtered scores (nulls removed)
 */
async function scoreFor(source, issues, ctx) {
  const skipNames = ctx.skipNames instanceof Set ? ctx.skipNames : new Set();
  const applicable = [..._registry.entries()].filter(
    ([name, s]) => !skipNames.has(name) && (s.datasets === '*' || s.datasets.includes(source)),
  ).map(([, s]) => s);

  const results = await Promise.allSettled(
    applicable.map((s) => s.fn(issues, ctx)),
  );

  const scores = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') continue;
    const val = r.value;
    if (Array.isArray(val)) {
      scores.push(...val);
    } else {
      scores.push(val);
    }
  }

  return scores.filter((s) => s.value !== null);
}

async function runAllScorers(issues, { referenceBugs, referenceExpected, source }) {
  return scoreFor(source, issues, { referenceBugs, referenceExpected });
}

module.exports = {
  register,
  getRegistry,
  scoreFor,
  runAllScorers,
  // Individual scorer exports for tests and direct use
  scoreParser,
  scoreLineAccuracy,
  scoreCoverage,
  scoreSeverity,
  scoreJudge,
  scoreCrb,
};
