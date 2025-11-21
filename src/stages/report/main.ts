import { ConfigService } from '../../config/config';
import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { ReportMetadata, ReviewMetadata } from '../../shared/types';
import { readMetadataFile, writeMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';
import { extractRootCauses } from '../root-cause-extract';
import { collectAllStageData, getStageResults } from './collectors/data-collector';
import { collectMetadata } from './collectors/metadata-collector';
import { generateConsoleOutput } from './generators/console-generator';
import {
  generateAnalysisSection,
  generateFixSection,
  generateMarkdownSummary,
  generateRecommendations,
  generateReviewSection,
} from './generators/markdown-generator';
import { generateTokenUsageSection } from './generators/token-generator';
import { generateHTMLReport } from './html-report';
import { IssueManager } from './issue-manager';
import { writeHTMLReport } from './utils/file-writer';

export async function generateReport(): Promise<ReportMetadata> {
  const existingReport = await readMetadataFile<ReportMetadata>(getCurrentSessionPaths().overallReport());
  if (existingReport) {
    logger.info('Report stage already completed - using existing results');
    return existingReport;
  }

  const startTime = Date.now();
  logger.start('Generating comprehensive QualOps report...');

  const sessionPaths = getCurrentSessionPaths();
  const data = await collectAllStageData();

  // Filter issues by configured severities
  const config = ConfigService.getInstance().getAll() as Record<string, unknown> & {
    report: { includedSeverities?: string[] };
  };
  const includedSeverities = config.report?.includedSeverities || ['critical', 'high', 'medium', 'low'];

  let filteredReviewData = data.review;
  if (data.review?.issues && data.review.issues.length > 0) {
    const originalCount = data.review.issues.length;
    const filteredIssues = data.review.issues.filter((issue) => includedSeverities.includes(issue.severity));

    if (filteredIssues.length < originalCount) {
      const excluded = originalCount - filteredIssues.length;
      logger.info(`[REPORT] Filtered ${excluded} issues by severity (showing: ${includedSeverities.join(', ')})`);
    }

    filteredReviewData = {
      ...data.review,
      issues: filteredIssues,
    } as ReviewMetadata;
  }

  let issueIdMap = new Map<string, number>();
  if (filteredReviewData?.issues && filteredReviewData.issues.length > 0) {
    logger.info('Generating issue markdown files...');
    const issueManager = new IssueManager(sessionPaths.issuesDir());
    const issueMap = await issueManager.writeAllIssues(filteredReviewData.issues);
    issueIdMap = new Map(Array.from(issueMap.entries()).map(([issue, id]) => [issue.id, id]));

    logger.info('Extracting root causes and organizing issues...');
    const rootCauseMetadata = await extractRootCauses();
    await writeMetadataFile(sessionPaths.rootCauseMetadata(), rootCauseMetadata);
  }

  const summary = collectMetadata(data.analysis, filteredReviewData, data.fix);

  const sections = [
    generateAnalysisSection(data.analysis, data.extractLog),
    generateReviewSection(filteredReviewData),
    generateFixSection(data.fix),
    generateTokenUsageSection(),
  ];

  const report: ReportMetadata = {
    timestamp: new Date().toISOString(),
    summary,
    sections,
    executionTime: Date.now() - startTime,
    stageResults: getStageResults(data),
  };

  sections.push(generateRecommendations(report));

  const markdown = generateMarkdownSummary(report);
  report.markdownReport = markdown;

  const htmlReport = await generateHTMLReport(issueIdMap);
  report.htmlReport = htmlReport;
  await writeHTMLReport(htmlReport);

  generateConsoleOutput(report);

  return report;
}
