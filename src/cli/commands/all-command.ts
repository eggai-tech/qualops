import { join } from 'node:path';

import { getCurrentSessionPaths, getTotalTokenStats } from '../../shared/runtime/session-context.ts';
import { ensureDirectory, writeMetadataFile } from '../../shared/utils/file-utils.ts';
import { logger } from '../../shared/utils/logger.ts';
import { judgeQuality } from '../../stages/judge/index.ts';
import { generateReport } from '../../stages/report/main.ts';
import { reviewProjects } from '../../stages/review/index.ts';
import { mergeConfiguration } from '../parsers/config-merger.ts';
import type { QualOpsOptions } from '../parsers/option-parser.ts';
import { handleStageError } from '../utils/error-handler.ts';
import { ProgressReporter } from '../utils/progress-reporter.ts';
import { executeAnalyzeStage } from './analyze-command.ts';
import { executeFixStage } from './fix-command.ts';

export async function executeAllStages(options: QualOpsOptions): Promise<void> {
  const config = await mergeConfiguration(options);
  const progressReporter = new ProgressReporter();

  await ensureDirectory(config.sessionPath.base());

  progressReporter.reportSessionInfo({
    files: config.metadata.files,
  });

  await writeMetadataFile(join(getCurrentSessionPaths().base(), 'metadata.json'), config.metadata);

  progressReporter.startStages(config.stages);

  for (const stage of config.stages) {
    progressReporter.startStage(stage);

    try {
      switch (stage) {
        case 'analyze':
          await executeAnalyzeStage(options);
          break;
        case 'review': {
          const reviewResult = await reviewProjects();
          await writeMetadataFile(getCurrentSessionPaths().reviewSummary(), reviewResult);
          break;
        }
        case 'fix':
          await executeFixStage(options);
          break;
        case 'report': {
          const reportResult = await generateReport();
          await writeMetadataFile(getCurrentSessionPaths().overallReport(), reportResult);
          break;
        }
        case 'judge': {
          const judgeResult = await judgeQuality();
          await writeMetadataFile(getCurrentSessionPaths().judgeDecision(), judgeResult);
          if (!judgeResult.passed) {
            logger.error(`\n[QUALITY GATE FAILED] ${judgeResult.reasons.join('; ')}`);
          }
          break;
        }
        default:
          throw new Error(`Unknown stage: ${stage}`);
      }

      progressReporter.completeStage();
    } catch (error) {
      progressReporter.failStage(error);
      handleStageError(stage, error);
    }
  }

  const totalStats = getTotalTokenStats();
  await writeMetadataFile(getCurrentSessionPaths().tokenStats(), totalStats);

  if (totalStats.totalCost > 0) {
    logger.info('\n[TOTAL TOKEN USAGE]');
    logger.info(`Total Cost: $${totalStats.totalCost.toFixed(4)}`);
    logger.info(`Total Invocations: ${totalStats.totalInvocations}`);
    logger.info(`Input Tokens: ${totalStats.totalInputTokens.toLocaleString()}`);
    logger.info(`Output Tokens: ${totalStats.totalOutputTokens.toLocaleString()}`);
    if (totalStats.totalCachedTokens > 0) {
      logger.info(`Cached Tokens: ${totalStats.totalCachedTokens.toLocaleString()}`);
      const savings = (totalStats.totalCachedTokens / 1_000_000) * 1.25;
      logger.info(`Cache Savings: $${savings.toFixed(4)}`);
    }
    logger.info('\nBy Stage:');
    totalStats.stages.forEach((stage) => {
      logger.info(`  ${stage.stage}: ${stage.invocations} calls, $${stage.cost.toFixed(4)}`);
    });
  }

  progressReporter.reportCompletion(config.sessionPath.sessionReport());
}
