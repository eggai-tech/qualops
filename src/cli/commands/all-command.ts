import { join } from 'node:path';

import type { Span, Tracer } from '@opentelemetry/api';

import { executeAnalyzeStage } from './analyze-command';
import { executeFixStage } from './fix-command';
import { TOKENS_PER_MILLION } from '../../ai/providers/pricing-constants';
import { ConfigService, DEFAULT_CONFIG_PATH } from '../../config/config';
import {
  setupTracing,
  getTracer,
  shutdownTracing,
  extractPRMetadata,
  setTraceMetadataFromPR,
  withAISpan,
} from '../../observability';
import { getCurrentSessionPaths, getTotalTokenStats } from '../../shared/runtime/session-context';
import type { AnalysisMetadata } from '../../shared/types';
import {
  ensureDirectory,
  readMetadataFile,
  writeMetadataFile,
} from '../../shared/utils/file-utils';
import { logger } from '../../shared/utils/logger';
import { judgeQuality } from '../../stages/judge';
import { generateReport } from '../../stages/report/main';
import { reviewProjects } from '../../stages/review';
import { mergeConfiguration } from '../parsers/config-merger';
import type { QualOpsOptions } from '../parsers/option-parser';
import { handleStageError } from '../utils/error-handler';
import { ProgressReporter } from '../utils/progress-reporter';

interface StageConfig {
  stages: string[];
  sessionName: string;
  options: QualOpsOptions;
}

export async function executeAllStages(options: QualOpsOptions): Promise<void> {
  ConfigService.setConfigPath(options.config ?? DEFAULT_CONFIG_PATH);
  const config = await mergeConfiguration(options);
  const progressReporter = new ProgressReporter();

  await ensureDirectory(config.sessionPath.base());

  progressReporter.reportSessionInfo({
    files: config.metadata.files,
  });

  await writeMetadataFile(join(getCurrentSessionPaths().base(), 'metadata.json'), config.metadata);

  progressReporter.startStages(config.stages);

  await setupTracing();
  try {
    await executeAllStagesWithTracing(
      { stages: config.stages, sessionName: config.sessionName, options },
      progressReporter,
    );
  } finally {
    await shutdownTracing();
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
      const savings = (totalStats.totalCachedTokens / TOKENS_PER_MILLION) * 1.25;
      logger.info(`Cache Savings: $${savings.toFixed(4)}`);
    }
    logger.info('\nBy Stage:');
    totalStats.stages.forEach((stage) => {
      logger.info(`  ${stage.stage}: ${stage.invocations} calls, $${stage.cost.toFixed(4)}`);
    });
  }

  progressReporter.reportCompletion(config.sessionPath.sessionReport());
}

async function executeAllStagesWithTracing(
  config: StageConfig,
  progressReporter: ProgressReporter,
): Promise<void> {
  const tracer = getTracer();

  await tracer.startActiveSpan('qualops/run', async (rootSpan) => {
    try {
      const model = ConfigService.getInstance().getResolvedStageConfig('review').model;
      const prMeta = extractPRMetadata(config.sessionName);
      setTraceMetadataFromPR(rootSpan, prMeta, config.sessionName, model);

      for (const stage of config.stages) {
        progressReporter.startStage(stage);

        try {
          await executeStage(tracer, rootSpan, stage, config, model);
          progressReporter.completeStage();
        } catch (error) {
          progressReporter.failStage(error);
          handleStageError(stage, error);
        }
      }
    } finally {
      rootSpan.end();
    }
  });
}

async function executeStage(
  tracer: Tracer,
  rootSpan: Span,
  stage: string,
  config: StageConfig,
  model: string,
): Promise<void> {
  switch (stage) {
    case 'analyze':
      await withAISpan(tracer, 'analyze', model, () => executeAnalyzeStage(config.options));
      break;
    case 'review': {
      const analysisData = await readMetadataFile<AnalysisMetadata>(
        getCurrentSessionPaths().analysis(),
      );
      if (analysisData?.gitRefs) {
        const prMeta = extractPRMetadata(config.sessionName, analysisData.gitRefs);
        setTraceMetadataFromPR(rootSpan, prMeta, config.sessionName, model);
      }

      const reviewResult = await withAISpan(tracer, 'review', model, () => reviewProjects());
      await writeMetadataFile(getCurrentSessionPaths().reviewSummary(), reviewResult);
      break;
    }
    case 'fix':
      await withAISpan(tracer, 'fix', model, () => executeFixStage(config.options));
      break;
    case 'report':
      await withAISpan(tracer, 'report', model, async () => {
        const reportResult = await generateReport();
        await writeMetadataFile(getCurrentSessionPaths().overallReport(), reportResult);
      });
      break;
    case 'judge': {
      const judgeResult = await withAISpan(tracer, 'judge', model, () => judgeQuality());
      await writeMetadataFile(getCurrentSessionPaths().judgeDecision(), judgeResult);
      if (!judgeResult.passed) {
        logger.error(`\n[QUALITY GATE FAILED] ${judgeResult.reasons.join('; ')}`);
      }
      break;
    }
    default:
      throw new Error(`Unknown stage: ${stage}`);
  }
}
