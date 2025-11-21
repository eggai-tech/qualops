// Main exports
export type { ReportMetadata, ReportSection } from '../../shared/types';
export { generateHTMLReport } from './html-report';
export { generateReport } from './main';

// Collectors
export { collectAllStageData, getStageResults } from './collectors/data-collector';
export { collectIssues, collectReviewIssues } from './collectors/issue-collector';
export { collectIncrementalStats, collectMetadata } from './collectors/metadata-collector';

// Generators
export { generateConsoleOutput, generateDetailedConsoleOutput, logProgress } from './generators/console-generator';
export { generateCIReport, generateJSONReport } from './generators/json-generator';
export {
  generateAnalysisSection,
  generateFixSection,
  generateMarkdownSummary,
  generateRecommendations,
  generateReviewSection,
} from './generators/markdown-generator';
export {
  generateTokenConsoleOutput,
  generateTokenUsageHTML,
  generateTokenUsageJSON,
  generateTokenUsageSection,
} from './generators/token-generator';

// Formatters
export {
  generateBarChart,
  generatePieChart,
  generateProjectComparisonChart,
  generateSeverityChart,
  generateSparkline,
  generateTypeChart,
} from './formatters/chart-formatter';
export {
  formatExecutiveSummary,
  formatHealthScore,
  formatIssueDistribution,
  formatMetricsSummary,
  formatQuickStatus,
  formatRecommendations,
} from './formatters/summary-formatter';

// Utils
export {
  getFileSizeSummary,
  validateContent,
  writeCIReport,
  writeCSVReport,
  writeHTMLReport,
  writeJSONReport,
  writeMarkdownReport,
  writeMultipleReports,
  writeReportFile,
} from './utils/file-writer';
export { escapeHtml, extractProblem, formatSource, getConfidenceBadge, getQualityStatus } from './utils/formatters';

// Types
export type { CollectedData } from './collectors/data-collector';
export type { AggregatedIssues } from './collectors/issue-collector';
export type { ReportSummary } from './collectors/metadata-collector';
export type { ChartData, ChartOptions } from './formatters/chart-formatter';
export type { JSONReport } from './generators/json-generator';
export type { FileWriteOptions } from './utils/file-writer';
