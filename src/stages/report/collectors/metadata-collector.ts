import type { AnalysisMetadata, ExtractLog, FixMetadata, ReviewMetadata } from '../../../shared/types/index.ts';
import { getQualityStatus } from '../utils/formatters.ts';

export interface ReportSummary {
  filesAnalyzed: number;
  totalIssues: number;
  critical: number;
  high: number;
  medium: number;
  low: number;
  fixSuggestions: number;
  qualityStatus: 'FAILED' | 'WARNING' | 'PASSED';
}

export function collectMetadata(
  analysis: AnalysisMetadata | null,
  review: ReviewMetadata | null,
  fix: FixMetadata | null,
): ReportSummary {
  const issues = review?.issues || [];
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const high = issues.filter((i) => i.severity === 'high').length;
  const medium = issues.filter((i) => i.severity === 'medium').length;
  const low = issues.filter((i) => i.severity === 'low').length;

  return {
    filesAnalyzed: analysis?.filePaths.length || 0,
    totalIssues: critical + high + medium + low,
    critical,
    high,
    medium,
    low,
    fixSuggestions: fix?.summary.totalSuggestions || 0,
    qualityStatus: getQualityStatus({ critical, high, medium, low }).status,
  };
}

export function collectIncrementalStats(extractLog: ExtractLog | null) {
  if (!extractLog) {
    return null;
  }

  const processedFiles = Object.values(extractLog.files).filter((f) => f.processed).length;
  const totalFiles = Object.keys(extractLog.files).length;
  const savedFiles = totalFiles - processedFiles;
  const savedPercent = totalFiles > 0 ? ((savedFiles / totalFiles) * 100).toFixed(1) : '0.0';

  return {
    totalFiles,
    processedFiles,
    savedFiles,
    savedPercent,
  };
}
