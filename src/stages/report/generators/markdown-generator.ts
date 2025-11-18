import type {
  AnalysisMetadata,
  ExtractLog,
  FixMetadata,
  ReportMetadata,
  ReportSection,
  ReviewMetadata,
} from '../../../shared/types/index.ts';
import { collectIncrementalStats } from '../collectors/metadata-collector.ts';
import { getQualityStatus } from '../utils/formatters.ts';

export function generateMarkdownSummary(report: ReportMetadata): string {
  const { summary, sections } = report;

  const qualityStatus = getQualityStatus({
    critical: summary.critical || 0,
    high: summary.high || 0,
    medium: summary.medium || 0,
    low: summary.low || 0,
  });

  const sectionsMarkdown = sections.map((section) => `## ${section.title}\n\n${section.content}`).join('\n\n');

  return `# QualOps Analysis Report

**Generated:** ${new Date(report.timestamp).toLocaleString()}
**Duration:** ${report.executionTime}ms

## Executive Summary

- **Files Analyzed:** ${summary.filesAnalyzed}
- **Total Issues:** ${summary.totalIssues}
  - [CRITICAL] Critical: ${summary.critical}
  - [HIGH] High: ${summary.high}
  - [MEDIUM] Medium: ${summary.medium}
  - [LOW] Low: ${summary.low}
- **Fix Suggestions:** ${summary.fixSuggestions}
- **Quality Status:** ${qualityStatus.status}

${sectionsMarkdown}

`;
}

export function generateAnalysisSection(
  analysis: AnalysisMetadata | null,
  extractLog: ExtractLog | null,
): ReportSection {
  if (!analysis) {
    return {
      title: 'Analysis Stage',
      content: '[WARN] Analysis data not available',
    };
  }


  let incrementalProcessing = '';
  const incrementalStats = collectIncrementalStats(extractLog);
  if (incrementalStats) {
    incrementalProcessing = `

### Incremental Processing
- Total files tracked: ${incrementalStats.totalFiles}
- Files processed: ${incrementalStats.processedFiles}
- Files skipped (unchanged): ${incrementalStats.savedFiles}${
      incrementalStats.savedFiles > 0
        ? `
- Processing saved: ${incrementalStats.savedPercent}%`
        : ''
    }`;
  }

  const content = `### Affected Projects
${projectsList}

### Files to Analyze
Total: ${analysis.filePaths.length} TypeScript files${incrementalProcessing}`;

  return {
    title: 'Analysis Stage',
    content,
  };
}

export function generateReviewSection(review: ReviewMetadata | null): ReportSection {
  if (!review) {
    return {
      title: 'AI Review Stage',
      content: '[WARN] Review data not available',
    };
  }

  let tokenUsageSection = '';
  if (review.tokenUsage) {
    tokenUsageSection = `

### Token Usage (Review Stage)
- Input Tokens: ${review.tokenUsage.input.toLocaleString()}
- Output Tokens: ${review.tokenUsage.output.toLocaleString()}
- Total Tokens: ${review.tokenUsage.total.toLocaleString()}`;
  }

  const topIssues = review.issues.filter((i) => i.severity === 'critical' || i.severity === 'high').slice(0, 5);
  let topIssuesSection = '';
  if (topIssues.length > 0) {
    const issuesList = topIssues
      .map(
        (issue, index) => `
${index + 1}. **${issue.description}**
   - Location: \`${issue.location}\`
   - Severity: ${issue.severity}
   - Type: ${issue.type}
   - Suggestion: ${issue.suggestion}`,
      )
      .join('');

    topIssuesSection = `

### Top Priority Issues${issuesList}`;
  }

  const content = `### AI Review Results
- Files Reviewed: ${review.filesReviewed}
- Total Issues: ${review.summary.totalIssues}

### Issue Breakdown
- [CRITICAL] Critical: ${review.summary.critical}
- [HIGH] High: ${review.summary.high}
- [MEDIUM] Medium: ${review.summary.medium}
- [LOW] Low: ${review.summary.low}

### Issue Types
- Bugs: ${review.summary.byType?.bug || 0}
- Security: ${review.summary.byType?.security || 0}
- Performance: ${review.summary.byType?.performance || 0}
- Maintainability: ${review.summary.byType?.maintainability || 0}${tokenUsageSection}${topIssuesSection}`;

  return {
    title: 'AI-Powered Code Review',
    content,
  };
}

export function generateFixSection(fix: FixMetadata | null): ReportSection {
  if (!fix) {
    return {
      title: 'Fix Suggestions',
      content: '[WARN] Fix data not available',
    };
  }

  const breakingChangesWarning =
    fix.summary.breaking > 0
      ? `\n[WARN] **Breaking Changes:** ${fix.summary.breaking} suggestions may introduce breaking changes`
      : '';

  const sampleFixes = fix.suggestions.filter((s) => s.confidence === 'high').slice(0, 3);
  let sampleFixesSection = '';
  if (sampleFixes.length > 0) {
    const fixesList = sampleFixes
      .map(
        (suggestion, index) => `
${index + 1}. **${suggestion.file}:${suggestion.line}**
   - ${suggestion.explanation}
   - Confidence: ${suggestion.confidence}
   - Breaking: ${suggestion.breaking ? 'Yes' : 'No'}`,
      )
      .join('');

    sampleFixesSection = `

### Sample Fix Suggestions${fixesList}`;
  }

  const content = `### Fix Generation Results
- Issues Processed: ${fix.issuesProcessed}
- Suggestions Generated: ${fix.summary.totalSuggestions}
- High Confidence: ${fix.summary.highConfidence}
- Applied: ${fix.summary.applied}${breakingChangesWarning}${sampleFixesSection}`;

  return {
    title: 'AI-Generated Fixes',
    content,
  };
}

export function generateRecommendations(report: ReportMetadata): ReportSection {
  const { summary } = report;

  const urgentSection =
    summary.critical > 0
      ? `### [URGENT] Immediate Action Required
- Fix ${summary.critical} critical issues before deployment
- Review all security vulnerabilities

`
      : '';

  const highPrioritySection =
    summary.high > 5
      ? `### [WARN] High Priority
- Address ${summary.high} high-severity issues
- Consider implementing automated fixes

`
      : '';

  const qualityStatus = getQualityStatus({
    critical: summary.critical || 0,
    high: summary.high || 0,
    medium: summary.medium || 0,
    low: summary.low || 0,
  });

  const qualitySection =
    qualityStatus.status !== 'PASSED'
      ? `### [QUALITY] Code Quality Status: ${qualityStatus.emoji} ${qualityStatus.status}
${
  qualityStatus.status === 'FAILED'
    ? '- URGENT: High/Critical issues must be resolved before deployment\n- Review security and bug fixes immediately'
    : '- Address medium priority issues to improve quality'
}
- Consider refactoring high-issue areas
- Implement stricter linting rules

`
      : '';

  const content = `${urgentSection}${highPrioritySection}${qualitySection}### [TIP] General Recommendations
- Review and apply ${summary.fixSuggestions} automated fix suggestions
- Add unit tests for fixed issues
- Update coding standards documentation`;

  return {
    title: 'Recommendations',
    content,
  };
}
