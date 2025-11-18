import type { TokenStats } from '../providers/index.ts';

export function createEmptyTokenStats(): TokenStats {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalTokens: 0,
    invocationCount: 0,
    startTime: new Date(),
    estimatedCost: 0,
  };
}

export function addTokenStats(base: TokenStats, addition: TokenStats | null | undefined): TokenStats {
  if (!addition) {
    return base;
  }

  return {
    totalInputTokens: base.totalInputTokens + (addition.totalInputTokens || 0),
    totalOutputTokens: base.totalOutputTokens + (addition.totalOutputTokens || 0),
    totalTokens: base.totalTokens + (addition.totalTokens || 0),
    invocationCount: base.invocationCount + (addition.invocationCount || 0),
    estimatedCost: base.estimatedCost + (addition.estimatedCost || 0),
    startTime: base.startTime,
  };
}

export function aggregateTokenStats(stats: (TokenStats | null | undefined)[]): TokenStats {
  let result = createEmptyTokenStats();

  for (const stat of stats) {
    if (stat) {
      result = addTokenStats(result, stat);
    }
  }

  return result;
}

export function formatTokenStats(stats: TokenStats): string {
  const runtime = (Date.now() - stats.startTime.getTime()) / 1000 / 60; // minutes

  return `
[TOKEN USAGE] AI Provider Statistics:
   Invocations: ${stats.invocationCount}
   Input tokens: ${stats.totalInputTokens.toLocaleString()}
   Output tokens: ${stats.totalOutputTokens.toLocaleString()}
   Total tokens: ${stats.totalTokens.toLocaleString()}
   Estimated cost: $${stats.estimatedCost.toFixed(4)}
   Runtime: ${runtime.toFixed(1)} minutes
   Avg tokens/call: ${stats.invocationCount > 0 ? Math.round(stats.totalTokens / stats.invocationCount) : 0}
`;
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
