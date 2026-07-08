import { getChangedFiles } from './git/changed-files';
import { processBatchForAnalysis } from './processors/batch-processor';
import { getFilesToProcess, loadExtractLog, saveExtractLog } from './utils/extract-log';
import { getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { AnalysisMetadata } from '../../shared/types';
import { readMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';

export { getChangedFiles } from './git/changed-files';

export async function analyzeProjects(
  base = 'main',
  head?: string,
  files?: string[],
): Promise<AnalysisMetadata> {
  const existingAnalysis = await readMetadataFile<AnalysisMetadata>(
    getCurrentSessionPaths().analysis(),
  );
  if (existingAnalysis) {
    logger.info('Analysis stage already completed - using existing results');
    return existingAnalysis;
  }

  const startTime = Date.now();
  logger.start('Starting project analysis...');

  const extractLog = await loadExtractLog();
  logger.extract('Loaded extract log with', Object.keys(extractLog.files).length, 'entries');

  let changedFiles: string[];
  let analysisMode: 'files' | 'git';

  if (files && files.length > 0) {
    analysisMode = 'files';
    changedFiles = files;
    logger.info(`[FILES] Analyzing specific file(s): ${files.join(', ')}`);
  } else {
    analysisMode = 'git';
    changedFiles = await getChangedFiles(base, head);
  }

  const { validFiles, skippedCount } = await processBatchForAnalysis(
    changedFiles,
    extractLog,
    analysisMode,
  );

  if (validFiles.length === 0) {
    return {
      timestamp: new Date().toISOString(),
      filePaths: [],
      executionTime: Date.now() - startTime,
    };
  }

  logger.summary('Analysis Summary:');
  logger.info(`Changed files: ${validFiles.length}`);

  if (skippedCount > 0) {
    logger.info(`Skipped ${skippedCount} non-existent files`);
  }

  const filesToProcess = await getFilesToProcess(validFiles, extractLog);

  await saveExtractLog(extractLog);
  logger.extract('Updated extract log');

  logger.info(`Will analyze ${filesToProcess.length} files`);

  return {
    timestamp: new Date().toISOString(),
    filePaths: filesToProcess,
    executionTime: Date.now() - startTime,
    gitRefs: analysisMode === 'git' ? { base, head: head || 'HEAD' } : undefined,
  };
}
