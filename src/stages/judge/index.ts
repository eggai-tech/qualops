import { envConfig } from '../../config/env';
import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { JudgeMetadata, QualityThresholds, ReportMetadata } from '../../shared/types';
import { readMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';

const DEFAULT_THRESHOLDS: QualityThresholds = {
  maxCriticalIssues: 0,
  maxHighIssues: 0,
  maxMediumIssues: 20,
  maxLowIssues: 50,
  requireAllStages: true,
  failOnMedium: false,
  failOnLow: false,
};

function loadThresholds(): QualityThresholds {
  const thresholds = { ...DEFAULT_THRESHOLDS };

  const maxCritical = envConfig.get('maxCritical');
  if (maxCritical !== undefined && !isNaN(maxCritical)) {
    thresholds.maxCriticalIssues = maxCritical;
  }

  const maxHigh = envConfig.get('maxHigh');
  if (maxHigh !== undefined && !isNaN(maxHigh)) {
    thresholds.maxHighIssues = maxHigh;
  }

  const maxMedium = envConfig.get('maxMedium');
  if (maxMedium !== undefined && !isNaN(maxMedium)) {
    thresholds.maxMediumIssues = maxMedium;
  }

  const maxLow = envConfig.get('maxLow');
  if (maxLow !== undefined && !isNaN(maxLow)) {
    thresholds.maxLowIssues = maxLow;
  }

  const failOnMedium = envConfig.get('failOnMedium');
  if (failOnMedium !== undefined) {
    thresholds.failOnMedium = failOnMedium;
  }

  const failOnLow = envConfig.get('failOnLow');
  if (failOnLow !== undefined) {
    thresholds.failOnLow = failOnLow;
  }

  return thresholds;
}

function evaluateQuality(
  report: ReportMetadata,
  thresholds: QualityThresholds,
): {
  passed: boolean;
  reasons: string[];
  warnings: string[];
} {
  const reasons: string[] = [];
  const warnings: string[] = [];
  let passed = true;

  if (!report?.summary || !report?.stageResults) {
    return {
      passed: false,
      reasons: ['Invalid or incomplete report data'],
      warnings: [],
    };
  }

  const { summary, stageResults } = report;

  if (summary.critical > thresholds.maxCriticalIssues) {
    passed = false;
    reasons.push(`Found ${summary.critical} critical issues (max allowed: ${thresholds.maxCriticalIssues})`);
  }

  if (summary.high > thresholds.maxHighIssues) {
    passed = false;
    reasons.push(`Found ${summary.high} high severity issues (max allowed: ${thresholds.maxHighIssues})`);
  }

  if (thresholds.maxMediumIssues !== undefined && summary.medium > thresholds.maxMediumIssues) {
    if (thresholds.failOnMedium) {
      passed = false;
      reasons.push(`Found ${summary.medium} medium severity issues (max allowed: ${thresholds.maxMediumIssues})`);
    } else {
      warnings.push(`Found ${summary.medium} medium severity issues (threshold: ${thresholds.maxMediumIssues})`);
    }
  }

  if (thresholds.maxLowIssues !== undefined && summary.low > thresholds.maxLowIssues) {
    if (thresholds.failOnLow) {
      passed = false;
      reasons.push(`Found ${summary.low} low severity issues (max allowed: ${thresholds.maxLowIssues})`);
    } else {
      warnings.push(`Found ${summary.low} low severity issues (threshold: ${thresholds.maxLowIssues})`);
    }
  }

  if (thresholds.requireAllStages) {
    const missingStages = Object.entries(stageResults)
      .filter(([_stage, completed]) => !completed)
      .map(([stage]) => stage);

    if (missingStages.length > 0) {
      passed = false;
      reasons.push(`Missing required stages: ${missingStages.join(', ')}`);
    }
  }

  if (passed && reasons.length === 0) {
    reasons.push('All quality checks passed');

    if (summary.critical === 0 && summary.high === 0 && summary.medium === 0) {
      reasons.push('No critical, high, or medium severity issues');
    } else if (summary.critical === 0 && summary.high === 0) {
      reasons.push('No critical or high severity issues');
    }
  }

  return { passed, reasons, warnings };
}

function generateJudgeReport(
  evaluation: { passed: boolean; reasons: string[]; warnings: string[] },
  report: ReportMetadata,
  thresholds: QualityThresholds,
): string {
  let output = '# QualOps Quality Gate Decision\n\n';

  output += `## Verdict: ${evaluation.passed ? '[OK] PASSED' : '[ERROR] FAILED'}\n\n`;

  if (!report?.summary) {
    output += '## Quality Metrics\n\n';
    output += 'Unable to display metrics: Report data is invalid or incomplete\n\n';
  } else {
    output += '## Quality Metrics\n\n';
    output += `- **Critical Issues:** ${report.summary.critical}\n`;
    output += `- **High Issues:** ${report.summary.high}\n`;
    output += `- **Medium Issues:** ${report.summary.medium}\n`;
    output += `- **Low Issues:** ${report.summary.low}\n\n`;
  }

  if (evaluation.reasons.length > 0) {
    output += '## Evaluation Results\n\n';
    evaluation.reasons.forEach((reason) => {
      output += `${reason}\n`;
    });
    output += '\n';
  }

  if (evaluation.warnings.length > 0) {
    output += '## Warnings\n\n';
    evaluation.warnings.forEach((warning) => {
      output += `${warning}\n`;
    });
    output += '\n';
  }

  if (!evaluation.passed) {
    output += '## Required Actions\n\n';

    if (report?.summary) {
      if (report.summary.critical > 0) {
        output += '1. **Fix all critical issues**\n';
        output += '   - Security vulnerabilities or crash risks\n';
        output += '   - Review detailed report for specifics\n\n';
      }

      if (report.summary.high > thresholds.maxHighIssues) {
        output += '2. **Reduce high severity issues**\n';
        output += `   - Current: ${report.summary.high}, Target: ${thresholds.maxHighIssues}\n`;
        output += '   - Focus on null reference and error handling\n\n';
      }

      if (thresholds.maxMediumIssues !== undefined && report.summary.medium > thresholds.maxMediumIssues) {
        output += '3. **Reduce medium severity issues**\n';
        output += `   - Current: ${report.summary.medium}, Target: ${thresholds.maxMediumIssues}\n`;
        output += '   - Apply suggested fixes and improve error handling\n\n';
      }

      output += 'Run `npm run qualops:fix --apply` to automatically fix some issues\n';
    } else {
      output += 'Review the report data and ensure all pipeline stages completed successfully\n';
    }
  } else {
    output += '## Recommendations\n\n';
    output += '- Monitor code quality in future commits\n';
    output += '- Consider raising quality thresholds for improvement\n';

    if (report?.summary?.fixSuggestions && report.summary.fixSuggestions > 0) {
      output += `- ${report.summary.fixSuggestions} automated fixes available\n`;
    }
  }

  output += '\n## Active Thresholds\n\n';
  output += `- Max Critical Issues: ${thresholds.maxCriticalIssues}\n`;
  output += `- Max High Issues: ${thresholds.maxHighIssues}\n`;
  output += `- Max Medium Issues: ${thresholds.maxMediumIssues}${thresholds.failOnMedium ? ' (fail)' : ' (warn)'}\n`;
  output += `- Max Low Issues: ${thresholds.maxLowIssues}${thresholds.failOnLow ? ' (fail)' : ' (warn)'}\n`;
  output += `- Require All Stages: ${thresholds.requireAllStages}\n`;

  return output;
}

export async function judgeQuality(
  options: {
    reportPath?: string;
    thresholds?: Partial<QualityThresholds>;
  } = {},
): Promise<JudgeMetadata> {
  const existingJudge = await readMetadataFile<JudgeMetadata>(getCurrentSessionPaths().judgeDecision());
  if (existingJudge) {
    logger.info('Judge stage already completed - using existing results');
    return existingJudge;
  }

  logger.info('[JUDGE] Starting quality gate evaluation');
  const reportPath = options.reportPath || getCurrentSessionPaths().overallReport();

  let report: ReportMetadata | null;
  try {
    report = await readMetadataFile<ReportMetadata>(reportPath);
    if (!report) {
      throw new Error(`No report found at ${reportPath}. Run report stage first.`);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to read report from ${reportPath}: ${errorMessage}`);
  }

  const thresholds = {
    ...loadThresholds(),
    ...options.thresholds,
  };

  const evaluation = evaluateQuality(report, thresholds);

  const detailedReport = generateJudgeReport(evaluation, report, thresholds);

  const judgeMetadata: JudgeMetadata = {
    timestamp: new Date().toISOString(),
    passed: evaluation.passed,
    qualityStatus: evaluation.passed ? 'PASSED' : 'FAILED',
    summary: report?.summary
      ? {
          totalIssues: report.summary.totalIssues,
          critical: report.summary.critical,
          high: report.summary.high,
          medium: report.summary.medium,
          low: report.summary.low,
        }
      : {
          totalIssues: 0,
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        },
    thresholds,
    reasons: evaluation.reasons,
    warnings: evaluation.warnings,
    detailedReport,
  };

  return judgeMetadata;
}
