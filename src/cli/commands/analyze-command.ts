import { getCurrentSessionPaths } from '../../shared/runtime/session-context.ts';
import { writeMetadataFile } from '../../shared/utils/file-utils.ts';
import { analyzeProjects } from '../../stages/analyze/index.ts';
import { parseFilePatterns } from '../parsers/file-parser.ts';
import type { QualOpsOptions } from '../parsers/option-parser.ts';

export async function executeAnalyzeStage(options: QualOpsOptions): Promise<void> {
  const files = options.files ? await parseFilePatterns(options.files) : undefined;

  const analyzeResult = await analyzeProjects(options.base, options.head, files);

  await writeMetadataFile(getCurrentSessionPaths().analysis(), analyzeResult);
}
