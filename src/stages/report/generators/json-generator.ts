import type { ReportMetadata } from '../../../shared/types';
import type { CollectedData } from '../collectors/data-collector';

export interface JSONReport {
  metadata: {
    timestamp: string;
    executionTime: number;
    version: string;
  };
  summary: {
    filesAnalyzed: number;
    totalIssues: number;
    issueBreakdown: {
      critical: number;
      high: number;
      medium: number;
      low: number;
    };
    fixSuggestions: number;
    qualityStatus: string;
  };
  stages: {
    analysis?: {
      filePaths: number;
      totalFiles: number;
    };
    review?: {
      filesReviewed: number;
      summary: unknown;
      tokenUsage: unknown;
    };
    fix?: {
      issuesProcessed: number;
      summary: unknown;
    };
  };
  issues: unknown[];
  recommendations: string[];
}

export function generateJSONReport(report: ReportMetadata, data: CollectedData): JSONReport {
  return {
    metadata: {
      timestamp: report.timestamp,
      executionTime: report.executionTime,
      version: '1.0.0',
    },
    summary: {
      filesAnalyzed: report.summary.filesAnalyzed,
      totalIssues: report.summary.totalIssues,
      issueBreakdown: {
        critical: report.summary.critical || 0,
        high: report.summary.high || 0,
        medium: report.summary.medium || 0,
        low: report.summary.low || 0,
      },
      fixSuggestions: report.summary.fixSuggestions,
      qualityStatus: report.summary.qualityStatus,
    },
    stages: {
      analysis: data.analysis
        ? {
            filePaths: data.analysis.filePaths.length,
            totalFiles: data.analysis.filePaths.length,
          }
        : undefined,
      review: data.review
        ? {
            filesReviewed: data.review.filesReviewed,
            summary: data.review.summary,
            tokenUsage: data.review.tokenUsage,
          }
        : undefined,
      fix: data.fix
        ? {
            issuesProcessed: data.fix.issuesProcessed,
            summary: data.fix.summary,
          }
        : undefined,
    },
    issues: data.review?.issues || [],
    recommendations: extractRecommendations(report),
  };
}

function extractRecommendations(report: ReportMetadata): string[] {
  const recommendationsSection = report.sections.find((section) =>
    section.title.toLowerCase().includes('recommendation'),
  );

  if (!recommendationsSection) {
    return [];
  }

  // Extract bullet points and recommendations from content
  const lines = recommendationsSection.content.split('\n');
  const recommendations: string[] = [];

  lines.forEach((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      recommendations.push(trimmed.substring(2).trim());
    }
  });

  return recommendations;
}

export interface CIReport {
  success: boolean;
  qualityStatus: string;
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  metadata: {
    filesAnalyzed: number;
    timestamp: string;
  };
  thresholds: {
    criticalFailed: boolean;
    highFailed: boolean;
  };
}

export function generateCIReport(report: ReportMetadata): CIReport {
  const { summary } = report;
  const hasCriticalIssues = summary.critical > 0;
  const hasHighIssues = summary.high > 0;

  return {
    success: !hasCriticalIssues && !hasHighIssues,
    qualityStatus: summary.qualityStatus,
    summary: {
      totalIssues: summary.totalIssues,
      critical: summary.critical,
      high: summary.high,
      medium: summary.medium,
      low: summary.low,
    },
    metadata: {
      filesAnalyzed: summary.filesAnalyzed,
      timestamp: report.timestamp,
    },
    thresholds: {
      criticalFailed: hasCriticalIssues,
      highFailed: hasHighIssues,
    },
  };
}
