import { getCurrentSessionPaths } from '../../../shared/runtime/session-context.ts';
import type { AnalysisMetadata, ExtractLog, FixMetadata, ReviewMetadata } from '../../../shared/types/index.ts';
import { readMetadataFile } from '../../../shared/utils/file-utils.ts';

export interface CollectedData {
  analysis: AnalysisMetadata | null;
  review: ReviewMetadata | null;
  fix: FixMetadata | null;
  extractLog: ExtractLog | null;
}

export async function collectAllStageData(): Promise<CollectedData> {
  const [analysis, review, fix, extractLog] = await Promise.all([
    readMetadataFile<AnalysisMetadata>(getCurrentSessionPaths().analysis()),
    readMetadataFile<ReviewMetadata>(getCurrentSessionPaths().reviewSummary()),
    readMetadataFile<FixMetadata>(getCurrentSessionPaths().fixSummary()),
    readMetadataFile<ExtractLog>(getCurrentSessionPaths().extractLog()),
  ]);

  return {
    analysis,
    review,
    fix,
    extractLog,
  };
}

export function getStageResults(data: CollectedData) {
  return {
    analyze: !!data.analysis,
    review: !!data.review,
    fix: !!data.fix,
  };
}
