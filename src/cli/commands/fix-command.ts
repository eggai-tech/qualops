import { getCurrentSessionPaths } from '../../shared/runtime/session-context.ts';
import { writeMetadataFile } from '../../shared/utils/file-utils.ts';
import { generateFixes } from '../../stages/fix/index.ts';
import type { QualOpsOptions } from '../parsers/option-parser.ts';

export async function executeFixStage(options: QualOpsOptions): Promise<void> {
  const fixResult = await generateFixes({
    apply: options.fixApply || false,
    includeMedium: options.includeMedium !== false,
    dryRun: !options.fixApply,
  });

  await writeMetadataFile(getCurrentSessionPaths().fixSummary(), fixResult);
}
