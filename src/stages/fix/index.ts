import { applySafeFixes } from './appliers/fix-applier';
import { generateFix } from './generators/fix-generator';
import { generateDiffHTML } from './utils/diff-visualizer';
import { createFixBatchRollbackPoint } from './utils/rollback-manager';
import { AIFactory } from '../../ai/providers';
import type { AIProvider } from '../../ai/providers/provider';
import { ConfigService } from '../../config/config';
import { addStageTokenStats, getCurrentSessionPaths } from '../../shared/runtime/session-context';
import type { FixMetadata, FixSuggestion, ReviewIssue, ReviewMetadata } from '../../shared/types';
import { processConcurrently } from '../../shared/utils/concurrency';
import { readMetadataFile, writeMetadataFile } from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';

function filterAndPrioritizeIssues(issues: ReviewIssue[]): ReviewIssue[] {
  const priorityIssues = issues.filter((i) => {
    return i.severity.toLowerCase() === 'high' && i.confidence >= 7 && !i.context.startsWith('[ESLint]');
  });

  logger.info(`Filtered ${priorityIssues.length} HIGH severity issues with confidence >= 7`);
  return priorityIssues;
}

async function generateFixSuggestions(
  issues: ReviewIssue[],
  aiProvider: AIProvider,
): Promise<FixSuggestion[]> {
  const issuesToProcess = filterAndPrioritizeIssues(issues);

  logger.info(`Generating fixes for ${issuesToProcess.length} HIGH severity issues (confidence >= 7)`);

  const config = ConfigService.getInstance().getAll();
  const maxConcurrent = config.fix?.maxConcurrentFixes ?? 3;

  const results = await processConcurrently(issuesToProcess, maxConcurrent, async (issue, index) => {
    const taskName = `[${index + 1}/${issuesToProcess.length}] ${issue.file}:${issue.location}`;
    logger.info(`${taskName} START FIX`);
    const startTime = Date.now();

    try {
      const fix = await generateFix(issue, aiProvider);
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      logger.info(`${taskName} FIX DONE IN ${duration}s`);
      return fix;
    } catch (error) {
      logger.error(`${taskName} FIX FAILED: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  });

  const suggestions = results.filter((fix): fix is FixSuggestion => fix != null);
  const failed = issuesToProcess.length - suggestions.length;

  logger.info(
    `Successfully generated ${suggestions.length} fixes from ${issuesToProcess.length} issues${failed > 0 ? ` (${failed} failed)` : ''}`,
  );
  return suggestions;
}

export async function generateFixes(
  options: {
    dryRun?: boolean;
    apply?: boolean;
    includeMedium?: boolean;
    validate?: boolean;
    merge?: boolean;
    createRollback?: boolean;
  } = {},
): Promise<FixMetadata> {
  const {
    dryRun = true,
    apply = false,
    includeMedium = true,
    validate: _validate = true,
    merge: _merge = true,
    createRollback = true,
  } = options;

  const sessionPaths = getCurrentSessionPaths();
  const existingFix = await readMetadataFile<FixMetadata>(sessionPaths.fixSummary());
  if (existingFix) {
    logger.info('Fix stage already completed - using existing results');
    return existingFix;
  }

  logger.info(`Starting fix generation (dry-run: ${dryRun}, apply: ${apply}, include-medium: ${includeMedium})`);
  const startTime = Date.now();

  const reviewData = await readMetadataFile<ReviewMetadata>(sessionPaths.reviewSummary());
  if (!reviewData) {
    throw new Error('No review metadata found. Run review stage first.');
  }

  if (!reviewData.issues || reviewData.issues.length === 0) {
    logger.info('No issues to fix - skipping fix generation');
    const metadata: FixMetadata = {
      timestamp: new Date().toISOString(),
      issuesProcessed: 0,
      suggestions: [],
      summary: {
        totalSuggestions: 0,
        highConfidence: 0,
        mediumConfidence: 0,
        lowConfidence: 0,
        breaking: 0,
        applied: 0,
      },
    };
    await writeMetadataFile(sessionPaths.fixSummary(), metadata);
    logger.info('Fix stage completed - no issues to fix');
    return metadata;
  }

  const aiProvider = await AIFactory.createForStage('fix');
  logger.info(`Using AI provider: ${aiProvider.name}`);
  logger.info(`Model: Claude Opus 4.1 for accurate fix generation`);

  const suggestions = await generateFixSuggestions(reviewData.issues, aiProvider, includeMedium);

  let appliedCount = 0;
  const appliedFiles: string[] = [];
  let rollbackPoint;

  if (apply && !dryRun) {
    if (createRollback) {
      const filesToModify = [...new Set(suggestions.map((s) => s.file))];
      try {
        rollbackPoint = await createFixBatchRollbackPoint(filesToModify);
        logger.info(`Created rollback point: ${rollbackPoint.id}`);
      } catch (error) {
        logger.warn(`Failed to create rollback point: ${error}`);
      }
    }

    const applyResults = await applySafeFixes(suggestions, {
      dryRun: false,
      createBackup: !createRollback,
      validateSyntax: true,
    });

    appliedCount = applyResults.filter((r) => r.success).length;
    appliedFiles.push(...applyResults.filter((r) => r.success).map((r) => r.filePath));

    suggestions.forEach((suggestion) => {
      const result = applyResults.find((r) => r.filePath === suggestion.file);
      if (result?.success) {
        suggestion.applied = true;
      }
    });
  }

  const validSuggestions = suggestions.filter((s) => s !== null);
  const summary = {
    totalSuggestions: validSuggestions.length,
    highConfidence: validSuggestions.filter((s) => s.confidence === 'high').length,
    mediumConfidence: validSuggestions.filter((s) => s.confidence === 'medium').length,
    lowConfidence: validSuggestions.filter((s) => s.confidence === 'low').length,
    breaking: validSuggestions.filter((s) => s.breaking).length,
    applied: appliedCount,
  };

  logger.info(`Fix Summary:`);
  logger.info(`  - Total Suggestions: ${summary.totalSuggestions}`);
  logger.info(`  - High Confidence: ${summary.highConfidence}`);
  logger.info(`  - Applied: ${summary.applied}`);
  if (rollbackPoint) {
    logger.info(`  - Rollback Point: ${rollbackPoint.id}`);
  }

  const metadata: FixMetadata = {
    timestamp: new Date().toISOString(),
    issuesProcessed: reviewData.issues.length,
    suggestions,
    summary,
  };

  try {
    await generateDiffHTML(suggestions, getCurrentSessionPaths().diffReport());
    logger.info(`Diff report generated: ${getCurrentSessionPaths().diffReport()}`);
  } catch (error) {
    logger.warn(`Failed to generate diff report: ${error}`);
  }

  const tokenStats = aiProvider.getTokenStats?.() as
    | { invocationCount: number; totalInputTokens: number; totalOutputTokens: number; estimatedCost: number }
    | undefined;
  if (tokenStats) {
    const cachedTokens = (aiProvider as { cachedTokens?: number }).cachedTokens || 0;
    addStageTokenStats(
      'fix',
      tokenStats.invocationCount,
      tokenStats.totalInputTokens,
      tokenStats.totalOutputTokens,
      cachedTokens,
      tokenStats.estimatedCost,
    );
  }

  const duration = Date.now() - startTime;
  logger.info(`Fix generation completed in ${(duration / 1000).toFixed(2)}s`);

  await writeMetadataFile(sessionPaths.fixSummary(), metadata);
  logger.info('Fix metadata saved successfully');

  return metadata;
}
