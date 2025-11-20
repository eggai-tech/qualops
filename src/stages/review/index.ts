import { readFileSync } from 'node:fs';

import { PipelineExecutor } from './processors/pipeline-executor';
import { IssueValidator } from './validators/issue-validator';
import { AIFactory } from '../../ai/providers';
import { detectFrameworkContext } from '../../ai/shared/structured-ai';
import { addStageTokenStats, getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { FileInfo } from '../../shared/types/config';
import type { AnalysisMetadata, ReviewMetadata } from '../../shared/types';
import { readMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';
import { getFileDiff } from '../analyze/git/changed-files';
import { loadExtractLog, saveExtractLog, updateFileInExtractLog } from '../analyze/utils/extract-log';

export async function reviewProjects(): Promise<ReviewMetadata> {
  const existingReview = await readMetadataFile<ReviewMetadata>(getCurrentSessionPaths().reviewSummary());
  if (existingReview) {
    logger.info('Review stage already completed - using existing results');
    return existingReview;
  }

  logger.start('Starting AI-powered code review...');
  const startTime = Date.now();

  const aiProvider = await AIFactory.createForStage('review');
  logger.ai(`Using AI provider: ${aiProvider.name}`);

  const analysisData = await readMetadataFile<AnalysisMetadata>(getCurrentSessionPaths().analysis());
  if (!analysisData) {
    throw new Error('No analysis metadata found. Run analysis stage first.');
  }

  const extractLog = await loadExtractLog();
  const tsFiles = analysisData.filePaths.filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'));

  logger.info(`Found ${tsFiles.length} TypeScript files to review`);

  logger.info('Preparing files for review...');
  const files: FileInfo[] = [];

  for (const filePath of tsFiles) {
    try {
      const content = readFileSync(filePath, 'utf-8');
      const frameworkContext = detectFrameworkContext(filePath, content);

      let diff;
      if (analysisData.gitRefs) {
        diff = await getFileDiff(filePath, analysisData.gitRefs.base, analysisData.gitRefs.head);
      }

      files.push({
        path: filePath,
        content,
        framework: frameworkContext.framework,
        diff,
      });
    } catch (error) {
      logger.error(`Failed to read file ${filePath}:`, error);
    }
  }

  logger.info(`Successfully loaded ${files.length} files for review`);

  logger.info('Executing review pipeline...');
  const executor = new PipelineExecutor(aiProvider);
  const reviewIssues = await executor.execute(files);

  logger.extract(`Updating extract log for ${files.length} processed files...`);
  for (const file of files) {
    await updateFileInExtractLog(file.path, extractLog);
  }
  await saveExtractLog(extractLog);

  const allIssues = IssueValidator.validateAndEnrichIssues(reviewIssues);

  const filteredIssues = allIssues.filter((issue) => {
    if (process.env.GITLAB_CI && issue.type.toLowerCase().includes('injection')) {
      logger.debug(`Filtered injection issue in GitLab CI: ${issue.file}:${issue.location}`);
      return false;
    }
    return true;
  });

  const sortedIssues = IssueValidator.sortIssuesByPriority(filteredIssues);

  const summary = sortedIssues.reduce(
    (acc, issue) => {
      acc.totalIssues++;
      if (issue.severity === 'critical') acc.critical++;
      else if (issue.severity === 'high') acc.high++;
      else if (issue.severity === 'medium') acc.medium++;
      else if (issue.severity === 'low') acc.low++;

      if (issue.type === 'bug') acc.byType.bug++;
      else if (issue.type === 'security') acc.byType.security++;
      else if (issue.type === 'performance') acc.byType.performance++;
      else if (issue.type === 'maintainability') acc.byType.maintainability++;

      return acc;
    },
    {
      totalIssues: 0,
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
      byType: { bug: 0, security: 0, performance: 0, maintainability: 0 },
    },
  );

  logger.info('\n[RESULTS] Review Summary:');
  logger.info(`  - Files reviewed: ${tsFiles.length}`);
  logger.info(`  - Total issues: ${summary.totalIssues}`);
  logger.info(`  - Critical: ${summary.critical}`);
  logger.info(`  - High: ${summary.high}`);
  logger.info(`  - Medium: ${summary.medium}`);
  logger.info(`  - Low: ${summary.low}`);

  const metadata: ReviewMetadata = {
    timestamp: new Date().toISOString(),
    filesReviewed: tsFiles.length,
    projectsReviewed: 0,
    issues: sortedIssues,
    summary,
  };

  const tokenStats = aiProvider.getTokenStats();
  if (tokenStats) {
    metadata.tokenUsage = {
      input: tokenStats.totalInputTokens,
      output: tokenStats.totalOutputTokens,
      total: tokenStats.totalTokens,
    };

    const cachedTokens = (aiProvider as unknown as { cachedTokens?: number }).cachedTokens || 0;
    addStageTokenStats(
      'review',
      tokenStats.invocationCount,
      tokenStats.totalInputTokens,
      tokenStats.totalOutputTokens,
      cachedTokens,
      tokenStats.estimatedCost,
    );
  }

  const duration = Date.now() - startTime;
  logger.timing(`Review completed in ${(duration / 1000).toFixed(2)}s`);

  return metadata;
}
