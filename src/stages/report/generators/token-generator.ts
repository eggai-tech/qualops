import { getGlobalTokenStats } from '../../../ai/providers';
import { formatTokenStats } from '../../../ai/shared/token-utils';
import type { ReportSection } from '../../../shared/types';

export function generateTokenUsageSection(): ReportSection {
  const tokenStats = getGlobalTokenStats();

  const averageTokensPerCall =
    tokenStats.invocationCount > 0
      ? Math.round(tokenStats.totalTokens / tokenStats.invocationCount)
      : 0;

  const content = `### AI Token Usage
${formatTokenStats(tokenStats)}

### Token Breakdown
- Input Tokens: ${tokenStats.totalInputTokens.toLocaleString()}
- Output Tokens: ${tokenStats.totalOutputTokens.toLocaleString()}
- API Calls: ${tokenStats.invocationCount}
- Average Tokens/Call: ${averageTokensPerCall}
- Estimated Cost: $${tokenStats.estimatedCost.toFixed(4)}`;

  return {
    title: 'Resource Usage',
    content,
  };
}

export function generateTokenUsageHTML(): string {
  const tokenStats = getGlobalTokenStats();

  const averageTokensPerCall =
    tokenStats.invocationCount > 0
      ? Math.round(tokenStats.totalTokens / tokenStats.invocationCount)
      : 0;

  const efficiencyRating = getEfficiencyRating(averageTokensPerCall);

  return `
<div class="token-usage-section">
  <h3>🤖 AI Token Usage Analysis</h3>

  <div class="token-overview">
    <div class="token-stat">
      <span class="token-number">${tokenStats.totalTokens.toLocaleString()}</span>
      <span class="token-label">Total Tokens</span>
    </div>
    <div class="token-stat">
      <span class="token-number">${tokenStats.invocationCount}</span>
      <span class="token-label">API Calls</span>
    </div>
    <div class="token-stat">
      <span class="token-number">$${tokenStats.estimatedCost.toFixed(4)}</span>
      <span class="token-label">Estimated Cost</span>
    </div>
  </div>

  <div class="token-breakdown">
    <h4>Token Distribution</h4>
    <div class="token-bar">
      <div class="token-input" style="width: ${((tokenStats.totalInputTokens / tokenStats.totalTokens) * 100).toFixed(1)}%">
        Input: ${tokenStats.totalInputTokens.toLocaleString()}
      </div>
      <div class="token-output" style="width: ${((tokenStats.totalOutputTokens / tokenStats.totalTokens) * 100).toFixed(1)}%">
        Output: ${tokenStats.totalOutputTokens.toLocaleString()}
      </div>
    </div>
  </div>

  <div class="efficiency-metrics">
    <h4>Efficiency Metrics</h4>
    <p><strong>Average Tokens per Call:</strong> ${averageTokensPerCall} ${efficiencyRating.emoji}</p>
    <p><strong>Efficiency Rating:</strong> ${efficiencyRating.rating}</p>
    <p><strong>Input/Output Ratio:</strong> ${(tokenStats.totalInputTokens / Math.max(tokenStats.totalOutputTokens, 1)).toFixed(2)}:1</p>
  </div>
</div>
  `;
}

function getEfficiencyRating(averageTokens: number): { rating: string; emoji: string } {
  if (averageTokens < 1000) {
    return { rating: 'Excellent - Very efficient token usage', emoji: '🟢' };
  } else if (averageTokens < 2000) {
    return { rating: 'Good - Reasonable token usage', emoji: '🟡' };
  } else if (averageTokens < 5000) {
    return { rating: 'Fair - Consider optimizing prompts', emoji: '🟠' };
  } else {
    return { rating: 'Poor - High token usage, optimization needed', emoji: '🔴' };
  }
}

export function generateTokenUsageJSON() {
  const tokenStats = getGlobalTokenStats();

  return {
    totalTokens: tokenStats.totalTokens,
    inputTokens: tokenStats.totalInputTokens,
    outputTokens: tokenStats.totalOutputTokens,
    apiCalls: tokenStats.invocationCount,
    averageTokensPerCall:
      tokenStats.invocationCount > 0
        ? Math.round(tokenStats.totalTokens / tokenStats.invocationCount)
        : 0,
    estimatedCost: tokenStats.estimatedCost,
    costBreakdown: {
      inputCost: tokenStats.totalInputTokens * 0.00001, // Approximate cost
      outputCost: tokenStats.totalOutputTokens * 0.00003, // Approximate cost
    },
  };
}

export function generateTokenConsoleOutput(): string {
  const tokenStats = getGlobalTokenStats();

  const lines = [
    '=== Token Usage Summary ===',
    `Total Tokens: ${tokenStats.totalTokens.toLocaleString()}`,
    `API Calls: ${tokenStats.invocationCount}`,
    `Estimated Cost: $${tokenStats.estimatedCost.toFixed(4)}`,
    '============================',
  ];

  return lines.join('\n');
}
