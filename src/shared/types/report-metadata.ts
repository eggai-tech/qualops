export interface ReportSection {
  title: string;
  content: string;
}

export interface ReportMetadata {
  timestamp: string;
  summary: {
    filesAnalyzed: number;
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
    fixSuggestions: number;
    qualityStatus: 'FAILED' | 'WARNING' | 'PASSED';
  };
  sections: ReportSection[];
  executionTime: number;
  stageResults: {
    analyze: boolean;
    review: boolean;
    filter?: boolean;
    fix: boolean;
  };
  markdownReport?: string;
  htmlReport?: string;
}
