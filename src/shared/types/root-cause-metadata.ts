/** Taxonomy and classification shapes for the root-cause-extract stage. */

export interface RootCauseTaxonomy {
  key: string;
  label: string;
  description: string;
  patterns: string[];
}

export interface RootCauseClassification {
  issueId: string;
  rootCause: string;
  confidence: number;
}

export interface RootCauseMetadata {
  timestamp: string;
  totalIssues: number;
  classifications: Record<string, RootCauseClassification>;
  taxonomy: RootCauseTaxonomy[];
  distribution?: Record<string, number>;
}
