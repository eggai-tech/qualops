import type { ReportMetadata } from '../../../shared/types/index.ts';
import { logger } from '../../../shared/utils/logger.ts';
import { getQualityStatus } from '../utils/formatters.ts';

export function generateConsoleOutput(report: ReportMetadata): void {
  const { summary } = report;

  logger.summary('Report Summary:');

  const status = getQualityStatus({
    critical: summary.critical || 0,
    high: summary.high || 0,
    medium: summary.medium || 0,
    low: summary.low || 0,
  });

  logger.info(`  - Quality Status: ${status.status}`);
  logger.info(`  - Total Issues: ${summary.totalIssues}`);
  logger.info(`  - Critical Issues: ${summary.critical}`);
  logger.info(`  - High Issues: ${summary.high}`);
  logger.info(`  - Medium Issues: ${summary.medium}`);
  logger.info(`  - Low Issues: ${summary.low}`);
  logger.info(`  - Files Analyzed: ${summary.filesAnalyzed}`);
  logger.info(`  - Fix Suggestions: ${summary.fixSuggestions}`);

  // Log warnings for critical issues
  if (summary.critical > 0) {
    logger.warn(`[URGENT] ${summary.critical} critical issues require immediate attention`);
  }

  if (summary.high > 5) {
    logger.warn(`[WARNING] ${summary.high} high-priority issues detected`);
  }
}

export function generateDetailedConsoleOutput(report: ReportMetadata): void {
  logger.start('Detailed Report Breakdown:');

  report.sections.forEach((section, index) => {
    logger.info(`\n[${index + 1}] ${section.title}`);

    // Extract key metrics from content for console display
    const lines = section.content.split('\n');
    const keyLines = lines.filter(
      (line) =>
        line.includes('Total:') ||
        line.includes('Issues:') ||
        line.includes('Files:') ||
        line.includes('Critical:') ||
        line.includes('High:'),
    );

    keyLines.forEach((line) => {
      if (line.trim()) {
        logger.info(`    ${line.trim()}`);
      }
    });
  });
}

export function logProgress(stage: string, current: number, total: number): void {
  const percentage = Math.round((current / total) * 100);
  const progressBar = '█'.repeat(Math.floor(percentage / 5)) + '░'.repeat(20 - Math.floor(percentage / 5));
  logger.info(`[${stage}] ${progressBar} ${percentage}% (${current}/${total})`);
}
