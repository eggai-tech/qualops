import type { AnalysisMetadata, FixMetadata, ReviewMetadata } from '../../../shared/types';
import { getQualityStatus } from '../utils/formatters';

export interface ReportSummary {
  filesAnalyzed: number;
  totalIssues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  fixSuggestions: number;
  qualityStatus: {
    status: 'FAILED' | 'WARNING' | 'PASSED';
    color: string;
    emoji: string;
  };
}

export interface SummaryData {
  sessionName: string;
  projectsList: string[];
  summary: ReportSummary;
  statusClass: string;
}

export function generateSummary(
  analysis: AnalysisMetadata | null,
  review: ReviewMetadata,
  fix: FixMetadata | null,
  _metadata: unknown,
  sessionBasePath: string,
): SummaryData {
  const sessionName = sessionBasePath.split('/').pop() || 'Unknown';
  const issues = review?.issues || [];
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const high = issues.filter((i) => i.severity === 'high').length;
  const medium = issues.filter((i) => i.severity === 'medium').length;
  const low = issues.filter((i) => i.severity === 'low').length;

  const summary: ReportSummary = {
    filesAnalyzed: analysis?.filePaths.length || 0,
    totalIssues: critical + high + medium + low,
    critical,
    high,
    medium,
    low,
    fixSuggestions: fix?.summary.totalSuggestions || 0,
    qualityStatus: getQualityStatus({ critical, high, medium, low }),
  };

  return {
    sessionName,
    projectsList: ['All Projects'],
    summary,
    statusClass: summary.critical > 0 || summary.high > 0 ? 'failed' : 'passed',
  };
}
