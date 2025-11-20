import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import { writeMetadataFile } from '../../shared/utils/file-utils';
import { generateFixes } from '../../stages/fix';
import type { QualOpsOptions } from '../parsers/option-parser';

export async function executeFixStage(options: QualOpsOptions): Promise<void> {
  const fixResult = await generateFixes({
    apply: options.fixApply || false,
    includeMedium: options.includeMedium !== false,
    dryRun: !options.fixApply,
  });

  await writeMetadataFile(getCurrentSessionPaths().fixSummary(), fixResult);
}
