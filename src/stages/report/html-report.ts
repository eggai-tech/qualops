import { generateIssuesSection } from './generators/issues-generator';
import { generateSummary } from './generators/summary-generator';
import { type BaseTemplateData, generateBaseTemplate } from './templates/base-template';
import { type FilterData, generateFiltersSection } from './templates/components';
import { aggregateIssues } from './utils/data-transformer';
import { ConfigService } from '../../config/config';
import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { AnalysisMetadata, FixMetadata, ReviewIssue, ReviewMetadata } from '../../shared/types';
import { readMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';

function extractKnowledgeSourceFromIssue(issue: ReviewIssue): string {
  if (!issue.knowledge_source || issue.knowledge_source.trim() === '') {
    return 'none';
  }

  const source = issue.knowledge_source.toLowerCase();

  if (source.includes('architecture decision records') || source.includes('adr')) {
    return 'adr';
  }
  if (source.includes('owasp')) {
    return 'owasp';
  }
  if (source.includes('angular') && !source.includes('material')) {
    return 'angular';
  }
  if (source.includes('ngrx') || source.includes('state management')) {
    return 'ngrx';
  }
  if (source.includes('rxjs') || source.includes('observable')) {
    return 'rxjs';
  }
  if (source.includes('material') || source.includes('cdk')) {
    return 'material';
  }

  return 'other';
}

export async function generateHTMLReport(issueIdMap: Map<string, number> = new Map()): Promise<string> {
  // Load all metadata in parallel
  const [analysis, review, fix, fixSuggestions, metadata] = await Promise.all([
    readMetadataFile<AnalysisMetadata>(getCurrentSessionPaths().analysis()),
    readMetadataFile<ReviewMetadata>(getCurrentSessionPaths().reviewSummary()),
    readMetadataFile<FixMetadata>(getCurrentSessionPaths().fixSummary()),
    readMetadataFile<{
      suggestions: Array<{
        issueId: string;
        file: string;
        line: number;
        originalCode: string;
        suggestedCode: string;
        explanation: string;
        confidence: string;
        breaking: boolean;
        applied: boolean;
      }>;
    }>(getCurrentSessionPaths().base() + '/fix-suggestions.json'),
    readMetadataFile<{ projects?: string[] }>(getCurrentSessionPaths().base() + '/metadata.json'),
  ]);

  if (!review) {
    throw new Error('Required metadata not found. Run analysis and review stages first.');
  }

  // Filter issues by configured severities
  const config = ConfigService.getInstance().getAll() as Record<string, unknown> & {
    report: { includedSeverities?: string[] };
  };
  const includedSeverities = config.report?.includedSeverities || ['critical', 'high', 'medium', 'low'];

  const originalIssueCount = review.issues.length;
  const filteredIssues = review.issues.filter((issue) => includedSeverities.includes(issue.severity));

  if (filteredIssues.length < originalIssueCount) {
    const excluded = originalIssueCount - filteredIssues.length;
    logger.info(`[REPORT] Filtered ${excluded} issues by severity (showing: ${includedSeverities.join(', ')})`);
  }

  // Create filtered review metadata
  const filteredReview: ReviewMetadata = {
    ...review,
    issues: filteredIssues,
  };

  // Generate summary data
  const summaryData = generateSummary(analysis, filteredReview, fix, metadata, getCurrentSessionPaths().base());

  // Aggregate issues for filtering
  const { byType: issuesByType } = aggregateIssues(filteredReview);

  // Group issues by knowledge source
  const issuesByKnowledgeSource = {
    adr: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'adr'),
    owasp: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'owasp'),
    angular: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'angular'),
    ngrx: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'ngrx'),
    rxjs: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'rxjs'),
    material: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'material'),
    other: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'other'),
    none: filteredIssues.filter((i) => extractKnowledgeSourceFromIssue(i) === 'none'),
  };

  // Generate filter data
  const filterData: FilterData = {
    totalIssues: summaryData.summary.totalIssues,
    issuesByType,
    summary: {
      critical: summaryData.summary.critical,
      high: summaryData.summary.high,
      medium: summaryData.summary.medium,
      low: summaryData.summary.low,
    },
    issuesByKnowledgeSource,
  };

  // Generate content sections
  const filtersSection = generateFiltersSection(filterData);
  const directoriesSection = await generateIssuesSection(filteredIssues, fixSuggestions, issueIdMap);

  // Prepare base template data
  const baseTemplateData: BaseTemplateData = {
    sessionName: summaryData.sessionName,
    projectsList: summaryData.projectsList,
    statusClass: summaryData.statusClass,
    totalIssues: summaryData.summary.totalIssues,
    critical: summaryData.summary.critical,
    high: summaryData.summary.high,
    medium: summaryData.summary.medium,
    low: summaryData.summary.low,
    filtersSection,
    directoriesSection,
  };

  // Generate and return the complete HTML report
  return generateBaseTemplate(baseTemplateData);
}
