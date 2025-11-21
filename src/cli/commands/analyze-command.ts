import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import { writeMetadataFile } from '../../shared/utils/file-utils';
import { analyzeProjects } from '../../stages/analyze';
import { parseFilePatterns } from '../parsers/file-parser';
import type { QualOpsOptions } from '../parsers/option-parser';

export async function executeAnalyzeStage(options: QualOpsOptions): Promise<void> {
  const files = options.files ? await parseFilePatterns(options.files) : undefined;

  const analyzeResult = await analyzeProjects(options.base, options.head, files);

  await writeMetadataFile(getCurrentSessionPaths().analysis(), analyzeResult);
}
