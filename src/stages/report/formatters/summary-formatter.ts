import type { ReportSummary } from '../collectors/metadata-collector';
import { getQualityStatus } from '../utils/formatters';

export function formatExecutiveSummary(summary: ReportSummary, executionTime: number): string {
  const qualityStatus = getQualityStatus({
    critical: summary.critical,
    high: summary.high,
    medium: summary.medium,
    low: summary.low,
  });

  return `## Executive Summary

**Quality Status:** ${qualityStatus.status}
**Execution Time:** ${executionTime}ms

### Analysis Overview
- **Files Analyzed:** ${summary.filesAnalyzed}
- **Total Issues Found:** ${summary.totalIssues}

### Issue Breakdown
- **Critical:** ${summary.critical}
- **High:** ${summary.high}
- **Medium:** ${summary.medium}
- **Low:** ${summary.low}

### Automation
- **Fix Suggestions Generated:** ${summary.fixSuggestions}`;
}

export function formatQuickStatus(summary: ReportSummary): string {
  const qualityStatus = getQualityStatus({
    critical: summary.critical,
    high: summary.high,
    medium: summary.medium,
    low: summary.low,
  });

  const criticalText = summary.critical > 0 ? `${summary.critical} CRITICAL` : '';
  const highText = summary.high > 0 ? `${summary.high} HIGH` : '';
  const mediumText = summary.medium > 0 ? `${summary.medium} MEDIUM` : '';
  const lowText = summary.low > 0 ? `${summary.low} LOW` : '';

  const issueTexts = [criticalText, highText, mediumText, lowText].filter(Boolean);

  return `**${qualityStatus.status}** | ${issueTexts.join(' | ') || 'No issues found'}`;
}

export function formatRecommendations(summary: ReportSummary): string {
  const recommendations: string[] = [];

  // Critical issues
  if (summary.critical > 0) {
    recommendations.push(
      `**URGENT:** Address ${summary.critical} critical issue${summary.critical > 1 ? 's' : ''} immediately before deployment`,
    );
  }

  // High issues
  if (summary.high > 0) {
    recommendations.push(
      `**HIGH PRIORITY:** Review and fix ${summary.high} high-severity issue${summary.high > 1 ? 's' : ''}`,
    );
  }

  // Medium issues
  if (summary.medium > 5) {
    recommendations.push(
      `**MEDIUM PRIORITY:** Consider addressing ${summary.medium} medium-severity issues to improve code quality`,
    );
  }

  // Fix suggestions
  if (summary.fixSuggestions > 0) {
    recommendations.push(
      `**AUTOMATION:** ${summary.fixSuggestions} automated fix suggestion${summary.fixSuggestions > 1 ? 's' : ''} available`,
    );
  }

  // General recommendations
  if (summary.totalIssues === 0) {
    recommendations.push(
      `**EXCELLENT:** No issues found. Consider adding more comprehensive analysis rules.`,
    );
  } else if (summary.critical === 0 && summary.high === 0) {
    recommendations.push(`**GOOD:** No critical or high-priority issues found.`);
  }

  return recommendations.length > 0
    ? `### Recommendations\n\n${recommendations.map((rec) => `- ${rec}`).join('\n')}`
    : '';
}

export function formatMetricsSummary(
  summary: ReportSummary,
  previousSummary?: ReportSummary,
): string {
  const lines: string[] = [];

  lines.push('### Key Metrics');
  lines.push('');

  // Issues per file ratio
  const issuesPerFile =
    summary.filesAnalyzed > 0 ? (summary.totalIssues / summary.filesAnalyzed).toFixed(2) : '0.00';

  lines.push(`- **Issues per File:** ${issuesPerFile}`);

  // Issue severity ratio
  const criticalRatio =
    summary.totalIssues > 0 ? ((summary.critical / summary.totalIssues) * 100).toFixed(1) : '0.0';

  lines.push(`- **Critical Issue Ratio:** ${criticalRatio}%`);

  // Fix automation ratio
  const fixRatio =
    summary.totalIssues > 0
      ? ((summary.fixSuggestions / summary.totalIssues) * 100).toFixed(1)
      : '0.0';

  lines.push(`- **Fixable Issues:** ${fixRatio}%`);

  // Comparison with previous run (if available)
  if (previousSummary) {
    lines.push('');
    lines.push('### Trend Analysis');

    const totalChange = summary.totalIssues - previousSummary.totalIssues;
    const criticalChange = summary.critical - previousSummary.critical;

    const totalTrend =
      totalChange === 0 ? 'unchanged' : totalChange > 0 ? 'increased' : 'decreased';
    const criticalTrend =
      criticalChange === 0 ? 'unchanged' : criticalChange > 0 ? 'increased' : 'decreased';

    lines.push(`- **Total Issues:** ${totalTrend} (${totalChange >= 0 ? '+' : ''}${totalChange})`);
    lines.push(
      `- **Critical Issues:** ${criticalTrend} (${criticalChange >= 0 ? '+' : ''}${criticalChange})`,
    );
  }

  return lines.join('\n');
}

export function formatHealthScore(summary: ReportSummary): string {
  // Calculate health score (0-100)
  let score = 100;

  // Deduct points for issues (weighted by severity)
  score -= summary.critical * 25;
  score -= summary.high * 10;
  score -= summary.medium * 3;
  score -= summary.low * 1;

  // Minimum score is 0
  score = Math.max(0, score);

  // Determine grade
  let grade: string;

  if (score >= 90) {
    grade = 'A';
  } else if (score >= 80) {
    grade = 'B';
  } else if (score >= 70) {
    grade = 'C';
  } else if (score >= 60) {
    grade = 'D';
  } else {
    grade = 'F';
  }

  return `### Code Health Score

**Score:** ${score}/100 (Grade ${grade})

${getHealthScoreDescription(score)}`;
}

function getHealthScoreDescription(score: number): string {
  if (score >= 90) {
    return 'Excellent code quality.';
  } else if (score >= 80) {
    return 'Good code quality with minor issues to address.';
  } else if (score >= 70) {
    return 'Acceptable code quality, but improvement recommended.';
  } else if (score >= 60) {
    return 'Below average code quality. Significant improvement needed.';
  } else {
    return 'Poor code quality. Immediate attention required.';
  }
}

export function formatIssueDistribution(summary: ReportSummary): string {
  if (summary.totalIssues === 0) {
    return '### Issue Distribution\n\nNo issues found.';
  }

  const criticalPercent = ((summary.critical / summary.totalIssues) * 100).toFixed(1);
  const highPercent = ((summary.high / summary.totalIssues) * 100).toFixed(1);
  const mediumPercent = ((summary.medium / summary.totalIssues) * 100).toFixed(1);
  const lowPercent = ((summary.low / summary.totalIssues) * 100).toFixed(1);

  return `### Issue Distribution

| Severity | Count | Percentage |
|----------|-------|------------|
| Critical | ${summary.critical} | ${criticalPercent}% |
| High     | ${summary.high} | ${highPercent}% |
| Medium   | ${summary.medium} | ${mediumPercent}% |
| Low      | ${summary.low} | ${lowPercent}% |

**Total Issues:** ${summary.totalIssues}`;
}
