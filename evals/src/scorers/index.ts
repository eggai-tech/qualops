'use strict';

import type { Issue, Score, ScorerContext, ScorerFn } from './types';
import { scoreParser } from './parse';
import { scoreLineAccuracy } from './line-accuracy';
import { scoreCoverage } from './coverage';
import { scoreSeverity } from './severity';
import { scoreJudge } from './judge';
import { scoreCrb } from './crb-pairwise';

interface RegistryEntry {
  datasets: '*' | string[];
  fn: (...args: unknown[]) => Promise<Score | Score[]>;
}

const _registry = new Map<string, RegistryEntry>();

export function register(name: string, entry: { datasets: '*' | string[]; fn: ScorerFn | ((...args: unknown[]) => Promise<Score | Score[]>) }): void {
  _registry.set(name, entry as RegistryEntry);
}

export function getRegistry(): Map<string, RegistryEntry> {
  return new Map(_registry);
}

register('parse', {
  datasets: '*',
  fn: async (issues: unknown) => {
    const r = scoreParser(issues);
    return { name: 'parse', value: r.score, comment: r.reason };
  },
});

register('line_accuracy', {
  datasets: ['qualops'],
  fn: async (issues: unknown, ctx: unknown) => {
    const { referenceBugs } = ctx as { referenceBugs: Issue[] };
    const r = scoreLineAccuracy(issues as Issue[], referenceBugs);
    return { name: 'line_accuracy', value: r.score, comment: r.reason };
  },
});

register('coverage', {
  datasets: ['qualops'],
  fn: async (issues: unknown, ctx: unknown) => {
    const { referenceExpected } = ctx as { referenceExpected: Issue[] };
    const r = scoreCoverage(issues as Issue[], referenceExpected);
    return { name: 'coverage', value: r.score, comment: r.reason };
  },
});

register('severity', {
  datasets: '*',
  fn: async (issues: unknown, ctx: unknown) => {
    const { referenceExpected } = ctx as { referenceExpected: Issue[] };
    const r = scoreSeverity(issues as Issue[], referenceExpected);
    return { name: 'severity', value: r.score, comment: r.reason };
  },
});

register('judge', {
  datasets: ['qualops'],
  fn: async (issues: unknown, ctx: unknown) => {
    const { referenceExpected } = ctx as { referenceExpected: Issue[] };
    const r = await scoreJudge(issues as Issue[], referenceExpected);
    return { name: 'judge', value: r.score, comment: r.reason };
  },
});

register('crb_pairwise', {
  datasets: ['crb'],
  fn: async (issues: unknown, ctx: unknown) => {
    const { referenceExpected } = ctx as { referenceExpected: Issue[] };
    return scoreCrb(issues as Issue[], referenceExpected);
  },
});

export async function scoreFor(source: string, issues: Issue[], ctx: ScorerContext): Promise<Score[]> {
  const skipNames = ctx.skipNames instanceof Set ? ctx.skipNames : new Set<string>();
  const applicable = [..._registry.entries()].filter(
    ([name, s]) => !skipNames.has(name) && (s.datasets === '*' || s.datasets.includes(source)),
  );

  const results = await Promise.allSettled(
    applicable.map(([, s]) => s.fn(issues, ctx)),
  );

  const scores: Score[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'rejected') {
      const scorerName = applicable[i][0];
      console.error(`[scoreFor] Scorer "${scorerName}" failed: ${r.reason}`);
      continue;
    }
    const val = r.value;
    if (Array.isArray(val)) {
      scores.push(...val);
    } else {
      scores.push(val);
    }
  }

  return scores.filter((s) => s.value !== null);
}

export async function runAllScorers(
  issues: Issue[],
  { referenceBugs, referenceExpected, source, skipNames }: { referenceBugs?: Issue[]; referenceExpected?: Issue[]; source: string; skipNames?: Set<string> },
): Promise<Score[]> {
  return scoreFor(source, issues, { referenceBugs, referenceExpected, source, skipNames });
}

export { scoreParser, scoreLineAccuracy, scoreCoverage, scoreSeverity, scoreJudge, scoreCrb };
