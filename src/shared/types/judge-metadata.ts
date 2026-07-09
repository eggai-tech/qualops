export interface QualityThresholds {
  minQualityScore?: number;
  maxCriticalIssues: number;
  maxHighIssues: number;
  maxMediumIssues?: number;
  maxLowIssues?: number;
  requireAllStages?: boolean;
  failOnMedium?: boolean;
  failOnLow?: boolean;
}

export interface JudgeMetadata {
  timestamp: string;
  passed: boolean;
  qualityScore?: number;
  qualityStatus: 'PASSED' | 'FAILED';
  summary: {
    totalIssues: number;
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  thresholds: QualityThresholds;
  reasons: string[];
  warnings?: string[];
  details?: string;
  detailedReport?: string;
  executionTime?: number;
}
