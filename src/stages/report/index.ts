// Main exports
export type { ReportMetadata, ReportSection } from '../../shared/types/index.ts';
export { generateHTMLReport } from './html-report.ts';
export { generateReport } from './main.ts';

// Collectors
export { collectAllStageData, getStageResults } from './collectors/data-collector.ts';
export { collectIssues, collectLintIssues, collectReviewIssues } from './collectors/issue-collector.ts';
export { collectIncrementalStats, collectMetadata } from './collectors/metadata-collector.ts';

// Generators
export { generateConsoleOutput, generateDetailedConsoleOutput, logProgress } from './generators/console-generator.ts';
export {
  generateIssuesCSV,
  generateMetricsCSV,
  generateProjectBreakdownCSV,
  generateSummaryCSV,
} from './generators/csv-generator.ts';
export { generateCIReport, generateJSONReport } from './generators/json-generator.ts';
export {
  generateAnalysisSection,
  generateFixSection,
  generateLintSection,
  generateMarkdownSummary,
  generateRecommendations,
  generateReviewSection,
} from './generators/markdown-generator.ts';
export {
  generateTokenConsoleOutput,
  generateTokenUsageHTML,
  generateTokenUsageJSON,
  generateTokenUsageSection,
} from './generators/token-generator.ts';

// Formatters
export {
  generateBarChart,
  generatePieChart,
  generateProjectComparisonChart,
  generateSeverityChart,
  generateSparkline,
  generateTypeChart,
} from './formatters/chart-formatter.ts';
export {
  formatExecutiveSummary,
  formatHealthScore,
  formatIssueDistribution,
  formatMetricsSummary,
  formatQuickStatus,
  formatRecommendations,
} from './formatters/summary-formatter.ts';
export {
  formatIssuesTable,
  formatProjectTable,
  formatSummaryTable,
  formatTable,
} from './formatters/table-formatter.ts';

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
} from './utils/file-writer.ts';
export { escapeHtml, extractProblem, formatSource, getConfidenceBadge, getQualityStatus } from './utils/formatters.ts';
export {
  defaultTemplateEngine,
  processTemplate,
  reportTemplates,
  TemplateEngine,
  templateHelpers,
} from './utils/template-engine.ts';

// Types
export type { CollectedData } from './collectors/data-collector.ts';
export type { AggregatedIssues } from './collectors/issue-collector.ts';
export type { ReportSummary } from './collectors/metadata-collector.ts';
export type { ChartData, ChartOptions } from './formatters/chart-formatter.ts';
export type { TableColumn, TableOptions } from './formatters/table-formatter.ts';
export type { JSONReport } from './generators/json-generator.ts';
export type { FileWriteOptions } from './utils/file-writer.ts';
export type { TemplateOptions, TemplateVariables } from './utils/template-engine.ts';
